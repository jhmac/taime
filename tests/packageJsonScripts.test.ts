import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const PACKAGE_JSON_PATH = resolve(__dirname, '..', 'package.json');

const HUSKY_V9_MIGRATION_HINT = [
  '',
  'The `prepare` script must be exactly "husky" on husky v9+.',
  'The legacy "husky install" form was deprecated in v9 and is removed in v10.',
  'See CAPACITOR_NOTES.md → "Pre-commit Security Hook" → "Husky version policy"',
  'and project task #429 / #430 for context. If you have a real reason to change',
  'this script, update this test along with it so the next person knows the new',
  'value is intentional.',
].join('\n');

describe('package.json scripts policy', () => {
  const pkg = JSON.parse(readFileSync(PACKAGE_JSON_PATH, 'utf8'));

  describe('scripts.prepare (husky activation)', () => {
    it('exists', () => {
      expect(
        pkg.scripts?.prepare,
        `package.json is missing a "prepare" script.${HUSKY_V9_MIGRATION_HINT}`,
      ).toBeDefined();
    });

    it('is exactly "husky" (v9+ form, not the deprecated "husky install")', () => {
      expect(
        pkg.scripts.prepare,
        `package.json scripts.prepare must be exactly "husky", got: ${JSON.stringify(pkg.scripts.prepare)}.${HUSKY_V9_MIGRATION_HINT}`,
      ).toBe('husky');
    });

    it('does not contain the deprecated "husky install" command', () => {
      expect(
        pkg.scripts.prepare.includes('husky install'),
        `package.json scripts.prepare contains the deprecated "husky install" command. This was removed in husky v10 and prints a deprecation warning in v9.${HUSKY_V9_MIGRATION_HINT}`,
      ).toBe(false);
    });
  });

  // Note: this assertion belongs to task #429 (the v9 pin) and is co-located
  // here on purpose. Husky v10 will require a deliberate, reviewed upgrade
  // pass — when that happens, update both this test and CAPACITOR_NOTES.md
  // → "Husky version policy" together so the next person sees a coherent
  // story instead of a stale guard.
  describe('devDependencies.husky (version pin)', () => {
    it('is pinned to a v9 range (no automatic v10 upgrade)', () => {
      const range = pkg.devDependencies?.husky;
      expect(
        range,
        `package.json devDependencies.husky is missing.${HUSKY_V9_MIGRATION_HINT}`,
      ).toBeDefined();
      expect(
        /^[~^]?9\./.test(range),
        `package.json devDependencies.husky must stay on a v9 range until husky v10 is explicitly validated against this repo. Current value: ${JSON.stringify(range)}.${HUSKY_V9_MIGRATION_HINT}`,
      ).toBe(true);
    });
  });
});
