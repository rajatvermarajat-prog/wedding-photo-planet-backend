import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { PERMISSION_KEYS } from '../../src/types/permissions';

const ROUTES_DIR = path.resolve(__dirname, '../../src/routes');

function routeFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return routeFiles(full);
    return entry.isFile() && entry.name.endsWith('.ts') ? [full] : [];
  });
}

function enforcedPermissionKeys(): string[] {
  const keys = new Set<string>();
  const callPattern = /require(?:Any)?Permission\(([^)]*)\)/g;
  const keyPattern = /['"]([A-Z][A-Z0-9_]+)['"]/g;

  for (const file of routeFiles(ROUTES_DIR)) {
    const text = fs.readFileSync(file, 'utf8');
    for (const call of text.matchAll(callPattern)) {
      for (const key of call[1].matchAll(keyPattern)) keys.add(key[1]);
    }
  }

  return [...keys].sort();
}

describe('permission catalogue', () => {
  it('contains every permission enforced by route middleware', () => {
    const catalogue = new Set(PERMISSION_KEYS);
    const missing = enforcedPermissionKeys().filter((key) => !catalogue.has(key));
    expect(missing).toEqual([]);
  });
});
