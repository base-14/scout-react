// Fails the build when dist/ calls a runtime API that the oldest supported
// engines lack (Chrome / Android System WebView 87, Safari 14). esbuild lowers
// *syntax* to the tsconfig target but never shims prototype methods, so a
// dependency or a stray call slips through silently — web-vitals' `.at(-1)`
// threw on Android 8.1 WebViews and was counted as an application error.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = new URL('../dist/', import.meta.url).pathname;
const FORBIDDEN = [
  [/\.at\(/, 'Array/String.prototype.at — Chrome 92'],
  [/\bstructuredClone\(/, 'structuredClone — Chrome 98'],
  [/\bObject\.hasOwn\(/, 'Object.hasOwn — Chrome 93'],
  [/\.findLast(?:Index)?\(/, 'Array.prototype.findLast — Chrome 97'],
  [/\.toSorted\(|\.toReversed\(|\.toSpliced\(/, 'change-array-by-copy — Chrome 110'],
  [/\bArray\.fromAsync\(/, 'Array.fromAsync — Chrome 121'],
  [/\.groupBy\(/, 'Object/Map.groupBy — Chrome 117'],
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(m?js|cjs)$/.test(name)) out.push(p);
  }
  return out;
}

let hits = 0;
for (const file of walk(ROOT)) {
  const lines = readFileSync(file, 'utf8').split('\n');
  lines.forEach((line, i) => {
    for (const [re, why] of FORBIDDEN) {
      if (re.test(line)) {
        hits += 1;
        console.error(`${relative(process.cwd(), file)}:${i + 1}: ${why}\n    ${line.trim().slice(0, 160)}`);
      }
    }
  });
}
if (hits > 0) {
  console.error(`\ncheck-dist-compat: ${hits} call(s) to APIs missing from Chrome/WebView 87. Feature-detect or avoid them.`);
  process.exit(1);
}
console.log('check-dist-compat: dist/ is clean for Chrome/WebView 87');
