// Makes Quackify-Setup.exe: quackify.exe with the NSIS installer appended and a trailer (the
// installer's length, then "QKSETUP1") that setup.rs looks for at the end of its own file.
//
//   node scripts/pack-setup.mjs <quackify.exe> <nsis setup.exe> <out.exe>
//
// Used by release.mjs; by hand, it packs a dev build's installer to try the window out.
import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

const MAGIC = Buffer.from("QKSETUP1", "ascii");

export function packSetup(exe, installer, out) {
  const app = readFileSync(exe);
  const nsis = readFileSync(installer);
  const length = Buffer.alloc(8);
  length.writeBigUInt64LE(BigInt(nsis.length));
  writeFileSync(out, Buffer.concat([app, nsis, length, MAGIC]));
}

// Run as a script, not imported (release.mjs, node -e, the REPL: argv[1] is not this file there).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [exe, installer, out] = process.argv.slice(2);
  if (!out) {
    console.error("usage: node scripts/pack-setup.mjs <quackify.exe> <nsis setup.exe> <out.exe>");
    process.exit(1);
  }
  packSetup(exe, installer, out);
  console.log(`pack-setup: ${out}`);
}
