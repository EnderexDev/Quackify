// Publishes a Quackify version that the installed apps update to by themselves (state/update.ts):
//
//   npm run release -- 0.2.0 "What changed, one line or more"
//
// From a clean checkout (any branch or worktree, ahead of main): puts the version in package.json, Cargo.toml and tauri.conf.json, builds the
// installer signed with the key in ~/.tauri/quackify.key (TAURI_SIGNING_PRIVATE_KEY overrides it),
// packs Quackify-Setup.exe (pack-setup.mjs), commits and pushes the version, and creates the
// GitHub release vX with Quackify-Setup.exe (what people download), the NSIS installer and its
// signature (what the update window downloads) and latest.json, the file the apps read at
// releases/latest/download/latest.json.
// Without that key no update can be signed: the apps out there only trust its public half.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { packSetup } from "./pack-setup.mjs";

const REPO = "EnderexDev/Quackify";
const root = join(import.meta.dirname, "..");
const [version, ...noteWords] = process.argv.slice(2);
const notes = noteWords.join(" ").trim();

const fail = (why) => {
  console.error(`release: ${why}`);
  process.exit(1);
};
// npm is a .cmd on Windows and needs the shell; git and gh do not, and the notes keep their spaces.
const run = (cmd, args, opts = {}) => execFileSync(cmd, args, { cwd: root, stdio: "inherit", shell: cmd === "npm", ...opts });
const read = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: "utf8" }).trim();

if (!/^\d+\.\d+\.\d+$/.test(version ?? "")) fail('usage: npm run release -- 0.2.0 "notes"');
// The public main has to be the code the installer is built from: the push at the end only goes
// through as a fast-forward, and checking it here saves a build that could not be published.
run("git", ["fetch", "origin", "main"]);
try {
  read("git", ["merge-base", "--is-ancestor", "origin/main", "HEAD"]);
} catch {
  fail("main on GitHub has commits this checkout lacks: merge them first");
}
if (read("git", ["status", "--porcelain"])) fail("the tree has changes: commit or drop them first");
const key = process.env.TAURI_SIGNING_PRIVATE_KEY ?? join(homedir(), ".tauri", "quackify.key");
if (!process.env.TAURI_SIGNING_PRIVATE_KEY && !existsSync(key)) fail(`no signing key at ${key}`);
const tag = `v${version}`;
if (read("git", ["tag", "--list", tag])) fail(`${tag} already exists`);

// The version, in the three files that carry it.
const edit = (file, change) => {
  const path = join(root, file);
  writeFileSync(path, change(readFileSync(path, "utf8")));
};
edit("package.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/tauri.conf.json", (s) => s.replace(/"version": "[^"]+"/, `"version": "${version}"`));
edit("src-tauri/Cargo.toml", (s) => s.replace(/^version = "[^"]+"/m, `version = "${version}"`));

const VERSION_FILES = ["package.json", "src-tauri/tauri.conf.json", "src-tauri/Cargo.toml", "src-tauri/Cargo.lock"];
/** Puts the old version back, so the next try does not stop at "the tree has changes". */
const undo = (why) => {
  run("git", ["checkout", "--", ...VERSION_FILES]);
  fail(`${why}; the version files are back as they were`);
};

try {
  run("npm", ["run", "app:build"], {
    env: { ...process.env, TAURI_SIGNING_PRIVATE_KEY: key, TAURI_SIGNING_PRIVATE_KEY_PASSWORD: process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ?? "" },
  });
} catch {
  undo("the build failed");
}

const bundle = join(root, "src-tauri", "target", "release", "bundle", "nsis");
const setup = `Quackify_${version}_x64-setup.exe`;
const exe = join(bundle, setup);
if (!existsSync(exe) || !existsSync(`${exe}.sig`)) undo(`the build left no ${setup} with its .sig in ${bundle}`);
// The same name every version: the README links releases/latest/download/Quackify-Setup.exe.
const friendly = join(bundle, "Quackify-Setup.exe");
packSetup(join(root, "src-tauri", "target", "release", "quackify.exe"), exe, friendly);
const latest = join(bundle, "latest.json");
writeFileSync(
  latest,
  JSON.stringify(
    {
      version,
      notes,
      pub_date: new Date().toISOString(),
      platforms: {
        "windows-x86_64": {
          signature: readFileSync(`${exe}.sig`, "utf8").trim(),
          url: `https://github.com/${REPO}/releases/download/${tag}/${setup}`,
        },
      },
    },
    null,
    2,
  ) + "\n",
);

// Cargo.lock carries the version too: the build has just written it.
run("git", ["add", ...VERSION_FILES]);
// A second try after a failed push or release finds the version already committed.
try {
  read("git", ["diff", "--cached", "--quiet"]);
} catch {
  try {
    run("git", ["commit", "-m", `Quackify ${version}`]);
  } catch {
    // A missing Git identity or a hook: unstaged too, so the next try starts from a clean tree.
    run("git", ["reset", "-q", "--", ...VERSION_FILES]);
    undo("the commit failed");
  }
}
run("git", ["push", "origin", "HEAD:main"]);
// Neither draft nor prerelease: releases/latest skips both, and the apps would not see it.
run("gh", ["release", "create", tag, friendly, exe, `${exe}.sig`, latest, "-R", REPO, "--target", read("git", ["rev-parse", "HEAD"]), "--title", `Quackify ${version}`, "--notes", notes || `Quackify ${version}`]);
console.log(`release: ${tag} is out, the installed apps get it within 6 hours or from Settings > About`);
