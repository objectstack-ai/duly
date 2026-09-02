// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { describe, expect, it, vi } from 'vitest';

/**
 * `scripts/demo.mjs` and the fixture have to agree about one string, and
 * nothing in the type system can hold them to it.
 *
 * The script is plain `.mjs` that runs BEFORE anything is compiled — it
 * sequences two `objectstack dev` boots — and the fixture is TypeScript baked
 * into the artifact the second boot compiles. So `ADMIN` in
 * `src/data/demo-org.ts` and `ADMIN_NAME_BY_LOCALE` in the script are two
 * copies of the same fact, and this file is what keeps them equal.
 *
 * ── What their drifting looks like, which is why it is worth a test ──────
 * The seed's `sys_user` dataset is keyed on `name`. The script renames the
 * live admin account in its priming step; the seed then matches that row and
 * skips it. Change one spelling and not the other and the loader matches
 * nothing, INSERTS a second admin, and hands the demo account's duties, tasks,
 * assignment and work log to a person nobody can log in as. Nothing errors:
 * the seed reports success, the app boots, and My week / My duties / Sent by
 * me / Work log are empty on the first screen an evaluator opens.
 *
 * `package.json` is read the same way, for the same reason: `pnpm demo:zh` is
 * the documented entry point and it is a string in a JSON file, so nothing
 * else would notice it being renamed or losing its variable.
 */

const read = (file: string): string => readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');

const demoScript = read('scripts/demo.mjs');
const packageJson = JSON.parse(read('package.json')) as { scripts?: Record<string, string> };

/** The fixture's `ADMIN`, re-evaluated for a given locale. */
const adminFor = async (locale: string): Promise<string> => {
  vi.resetModules();
  vi.stubEnv('DULY_DEMO_LOCALE', locale);
  const { ADMIN } = await import('../src/data/demo-org.js');
  vi.unstubAllEnvs();
  return ADMIN;
};

describe('scripts/demo.mjs agrees with the fixture', () => {
  it('knows the name the fixture gives the admin in each locale', async () => {
    // Both directions of the pair the rename depends on. `Dev Admin` is the
    // name `@objectstack/plugin-auth` mints and the one English keeps; the
    // Chinese one only exists because the script puts it there.
    expect(await adminFor('')).toBe('Dev Admin');
    expect(await adminFor('zh-CN')).toBe('演示管理员');

    expect(demoScript, 'the script must carry the English admin name').toContain("'Dev Admin'");
    expect(demoScript, 'the script must carry the Chinese admin name').toContain("'演示管理员'");
  });

  it('maps the same locale spellings the fixture accepts', () => {
    // A spelling the fixture takes but the script does not would rename the
    // account for the wrong language — the exact drift above, arriving through
    // an alias rather than through an edit.
    for (const spelling of ['zh', 'zh-cn']) {
      expect(demoScript).toContain(`['${spelling}', '演示管理员']`);
    }
    for (const spelling of ['en', 'en-us', 'en-gb']) {
      expect(demoScript).toContain(`['${spelling}', 'Dev Admin']`);
    }
  });

  it('passes the locale to BOTH boots and deletes only the seed gate', () => {
    // The priming boot deliberately runs with the demo OFF, and it deletes
    // exactly one variable to do it. Deleting the locale alongside it — the
    // obvious "symmetry" edit — would leave the priming step renaming the
    // account for a language it could not see.
    expect(demoScript).toContain('delete env[DEMO_SEED_ENV_VAR]');
    expect(demoScript).not.toContain('delete env[DEMO_LOCALE_ENV_VAR]');
    expect(demoScript).toContain('DULY_DEMO_LOCALE');
  });
});

describe('package.json ships the entry point the README documents', () => {
  it('pnpm demo:zh sets the locale and runs the same script', () => {
    expect(packageJson.scripts?.['demo:zh']).toBe('DULY_DEMO_LOCALE=zh-CN node scripts/demo.mjs');
    // The same script, so the two demos cannot diverge in how they boot.
    expect(packageJson.scripts?.demo).toBe('node scripts/demo.mjs');
  });

  it('and the README tells an evaluator it exists', () => {
    // The demo table is the first thing anybody reads; a command that only
    // exists in package.json is a command nobody runs.
    expect(read('README.md')).toContain('pnpm demo:zh');
  });
});
