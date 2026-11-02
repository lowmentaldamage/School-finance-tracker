import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import en from './en.json';

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.test.ts') ? [p] : [];
  });
}

function has(key: string): boolean {
  const lookup = (k: string) => k.split('.').reduce<unknown>((o, part) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[part] : undefined), en);
  return typeof lookup(key) === 'string' || typeof lookup(`${key}_other`) === 'string';
}

describe('translations', () => {
  it('defines every static key used in the UI', () => {
    const missing = new Set<string>();
    for (const f of files(join(import.meta.dirname, '..'))) {
      for (const m of readFileSync(f, 'utf8').matchAll(/\bt\(\s*'([a-z_.0-9]+)'/g)) {
        if (!has(m[1]!)) missing.add(m[1]!);
      }
    }
    expect([...missing]).toEqual([]);
  });
});
