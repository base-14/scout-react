import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { SCOPE_NAME, SCOPE_VERSION } from './scope';
const SRC_ROOT = join(__dirname, '..');
const SCOPE_API_RE = /\b(getTracer|getMeter|getLogger)\s*\(([^)]*)\)/g;
function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...walk(path));
    } else if (name.endsWith('.ts') || name.endsWith('.tsx')) {
      out.push(path);
    }
  }
  return out;
}
describe('SCOPE contract — every span/metric/log must use the SDK scope', () => {
  it('exposes the canonical scope name', () => {
    expect(SCOPE_NAME).toBe('base14.scout.react');
    expect(SCOPE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });
  it('pins SCOPE_VERSION to the package version', () => {
    // SCOPE_VERSION is the scope version on every signal AND the value of the
    // `scout.react.version` resource attribute, so a drift from package.json
    // mislabels which SDK build produced the telemetry. Bump both together.
    const pkg = JSON.parse(
      readFileSync(join(SRC_ROOT, '..', 'package.json'), 'utf8'),
    ) as { version: string };
    expect(SCOPE_VERSION).toBe(pkg.version);
  });
  it('forbids any other InstrumentationScope name anywhere in src/', () => {
    const violations: Array<{
      file: string;
      line: number;
      match: string;
    }> = [];
    for (const file of walk(SRC_ROOT)) {
      if (file.endsWith('scope.ts') || file.endsWith('scope.contract.test.ts')) continue;
      const content = readFileSync(file, 'utf8');
      const lines = content.split('\n');
      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const stripped = line.replace(/\/\/.*$/, '').replace(/\/\*[\s\S]*?\*\//g, '');
        SCOPE_API_RE.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = SCOPE_API_RE.exec(stripped)) !== null) {
          const args = m[2].trim();
          const firstArg = args.split(',')[0].trim();
          if (firstArg !== 'SCOPE_NAME') {
            violations.push({
              file: file.replace(SRC_ROOT + '/', ''),
              line: i + 1,
              match: `${m[1]}(${args})`,
            });
          }
        }
      }
    }
    if (violations.length > 0) {
      const detail = violations
        .map((v) => `  ${v.file}:${v.line}  ${v.match}`)
        .join('\n');
      throw new Error(
        `Every span/metric/log MUST be emitted under the SCOPE_NAME constant ` +
          `(from src/core/scope.ts). Found ${violations.length} violation(s):\n${detail}`,
      );
    }
    expect(violations).toEqual([]);
  });
});
