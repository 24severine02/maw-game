import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/** Enforces the CLAUDE.md rule: the engine is pure — no I/O, clocks, global randomness or deps. */
const SRC = join(import.meta.dirname, '..', 'src');
const FORBIDDEN: [RegExp, string][] = [
  [/\bMath\.random\b/, 'use the seeded RNG in rng.ts'],
  [/\bDate\b/, 'time comes in via action.now'],
  [/\bperformance\.now\b/, 'time comes in via action.now'],
  [/\b(setTimeout|setInterval|queueMicrotask)\b/, 'no timers'],
  [/\bconsole\./, 'no logging'],
  [/\bprocess\./, 'no environment access'],
  [/\bfetch\(/, 'no network'],
  [/\b(async|await)\b/, 'the engine is synchronous'],
  [/from\s+['"](?!\.\/)/, 'only relative imports (no node: or npm deps)'],
];

describe('engine purity', () => {
  const files = readdirSync(SRC).filter((f) => f.endsWith('.ts'));

  it.each(files)('%s has no I/O, clocks, randomness or external imports', (file) => {
    const code = readFileSync(join(SRC, file), 'utf8').replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, '');
    for (const [pattern, why] of FORBIDDEN) {
      expect(pattern.test(code), `${file} matches ${pattern}: ${why}`).toBe(false);
    }
  });
});
