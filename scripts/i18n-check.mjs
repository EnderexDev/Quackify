// npm run i18n:check : every t("...") in src has a Portuguese entry, no entry is left unused, and
// the {placeholders} match. Also lists JSX text and label/title strings not passed through t(),
// the likely leftovers. Exits 1 when something is missing.
import fs from "fs";
import path from "path";
import { parseSync } from "oxc-parser";

const root = path.resolve(import.meta.dirname, "../src");
const files = [];
const walk = (d) => {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p);
    else if (/\.(tsx?|ts)$/.test(e.name) && !p.includes(`${path.sep}i18n${path.sep}`)) files.push(p);
  }
};
walk(root);

// The Portuguese dictionaries: `"English": "Português",` lines.
const pt = new Map();
for (const f of fs.readdirSync(path.join(root, "i18n/pt"))) {
  const text = fs.readFileSync(path.join(root, "i18n/pt", f), "utf8");
  for (const m of text.matchAll(/^\s*("(?:[^"\\]|\\.)*")\s*:\s*("(?:[^"\\]|\\.)*"),?\s*$/gm)) {
    const [k, v] = [JSON.parse(m[1]), JSON.parse(m[2])];
    if (pt.has(k) && pt.get(k).v !== v) console.log(`DIFFERENT in ${f} and ${pt.get(k).f}: ${k}`);
    pt.set(k, { v, f });
  }
}

const used = new Map();
const leftovers = [];
for (const f of files) {
  const src = fs.readFileSync(f, "utf8");
  const rel = path.relative(root, f);
  // Every call t(<string literal>, ...) as the parser reads it: comments skipped, any quotes and
  // spacing, escapes decoded the way the app sees them. oxc-parser, since TypeScript 7 has no JS API.
  const visit = (node) => {
    if (Array.isArray(node)) return node.forEach(visit);
    if (!node || typeof node !== "object") return;
    if (node.type === "CallExpression" && node.callee.type === "Identifier" && node.callee.name === "t") {
      const arg = node.arguments[0];
      if (arg?.type === "Literal" && typeof arg.value === "string") used.set(arg.value, rel);
      else if (arg?.type === "TemplateLiteral" && arg.expressions.length === 0) used.set(arg.quasis[0].value.cooked, rel);
    }
    for (const k in node) if (k !== "parent") visit(node[k]);
  };
  const { program, errors } = parseSync(f, src);
  if (errors.length) { console.log(`PARSE ERROR in ${rel}: ${errors[0].message}`); process.exit(1); }
  visit(program);
  // Likely leftovers: JSX text with letters, and label/title/aria-label/placeholder literals.
  src.split("\n").forEach((line, i) => {
    if (/\/\/|^\s*\*|^\s*\/\*/.test(line.trim().slice(0, 2))) return;
    const jsx = line.match(/>\s*([A-Z][A-Za-z' ,.!?…:-]{2,})\s*</);
    const attr = line.match(/\b(?:label|title|aria-label|placeholder|note|text)[=:]\s*"([A-Z][^"]{2,})"/);
    const hit = jsx?.[1] ?? attr?.[1];
    if (hit && !line.includes("t(")) leftovers.push(`${rel}:${i + 1}  ${hit.trim()}`);
  });
}

const vars = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
const missing = [...used].filter(([k]) => !pt.has(k));
const unused = [...pt].filter(([k]) => !used.has(k));
const badVars = [...used].filter(([k]) => pt.has(k) && vars(k) !== vars(pt.get(k).v));

console.log(`${used.size} texts in t(), ${pt.size} Portuguese entries`);
for (const [k, f] of missing) console.log(`MISSING  ${f}  ${k}`);
for (const [k, f] of badVars) console.log(`VARS     ${f}  ${k}  ->  ${pt.get(k).v}`);
for (const [k, { f }] of unused) console.log(`UNUSED   ${f}  ${k}`);
for (const l of leftovers) console.log(`LEFTOVER ${l}`);
process.exit(missing.length || badVars.length ? 1 : 0);
