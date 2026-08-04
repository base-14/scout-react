// The root package is `"type": "module"`, but `tsconfig.native.json` emits
// CommonJS into dist/native/ on purpose — Metro has to see literal `require()`
// calls to statically resolve the optional peer deps (react-native,
// async-storage, expo-modules-core) that soft-load.ts guards.
//
// Without this marker Node reads those .js files as ESM and every `require`
// throws, so the ./native subpath is unusable from Node (Jest, SSR, tooling)
// even though Metro handles it fine. A directory-scoped package.json is the
// supported way to say "this subtree is CommonJS" without renaming a single
// file that Metro resolves.
// Both directories have to be marked, not just dist/native/: the native entry's
// declarations re-export from dist/core/, and tsc writes extensionless relative
// specifiers there. Those are legal in CommonJS but not in ESM, so leaving
// dist/core/ ESM-scoped makes every `./types`-style import in the .d.ts files
// fail to resolve — which is what attw reports as an internal resolution error.
//
// The marker deliberately stops at these two subtrees. dist/ itself must stay
// ESM: tsup emits the web build's shared chunks there, and dist/web/index.js
// imports them with ESM syntax.
import { writeFileSync } from 'node:fs';

for (const dir of ['native', 'core']) {
  const target = new URL(`../dist/${dir}/package.json`, import.meta.url);
  writeFileSync(target, JSON.stringify({ type: 'commonjs' }, null, 2) + '\n');
  console.log(`wrote dist/${dir}/package.json ({"type":"commonjs"})`);
}
