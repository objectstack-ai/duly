// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

import { CATALOG_PACKS, PACK_ENV_VAR, packCatalogRows, requestedPacks, type CatalogPack } from '../src/data/packs/index.js';
import { FOOD_SAFETY } from '../src/data/packs/food-safety/pack.js';

/**
 * Catalog packs (#134): the format, the first pack, and the switch.
 *
 * What is pinned, and why each half matters:
 *  - **Both languages, on every row.** zh-CN is the pack's primary language
 *    and en the app's source language; a row missing either is a catalog that
 *    renders blank in one demo. The authored-text gate does not see seed rows,
 *    so this suite is the pack's i18n gate.
 *  - **No name the demo already uses.** `name` is the upsert key: a pack row
 *    sharing it would silently overwrite a demo catalog item, or be overwritten.
 *  - **Off unless asked, and a typo is refused.** An unknown id that loaded
 *    nothing would be indistinguishable from the empty first boot.
 *  - **It boots.** The rows go through the real loader and the real
 *    validation rules, in both languages, with no demo underneath.
 */

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const DEMO_LOCALE_ENV_VAR = 'DULY_DEMO_LOCALE';

const CJK = /[一-鿿]/;

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

const texts = (pack: CatalogPack) =>
  pack.duties.flatMap((duty) => [duty.name, duty.done, duty.evidence, ...(duty.reference ? [duty.reference] : [])]);

// ───────────────────────────────────────────────────────────────────────────
describe.each(CATALOG_PACKS.map((pack) => [pack.id, pack] as const))('pack %s — format', (_id, pack) => {
  it('has a lowercase, hyphenated id', () => {
    expect(pack.id).toMatch(/^[a-z][a-z0-9-]*$/);
  });

  it('carries every display string in both languages, and they differ', () => {
    for (const text of [pack.title, ...Object.values(pack.positions), ...texts(pack)]) {
      expect(text.zh.trim(), JSON.stringify(text)).not.toBe('');
      expect(text.en.trim(), JSON.stringify(text)).not.toBe('');
      expect(text.zh, `zh is Chinese: ${JSON.stringify(text)}`).toMatch(CJK);
      expect(text.en, `en is not Chinese: ${JSON.stringify(text)}`).not.toMatch(CJK);
    }
  });

  it('names a declared position on every duty, and uses every position it declares', () => {
    const keys = Object.keys(pack.positions);
    for (const duty of pack.duties) expect(keys, duty.name.en).toContain(duty.position);
    expect(new Set(pack.duties.map((duty) => duty.position))).toEqual(new Set(keys));
  });

  it.each(['zh-CN', 'en'] as const)('gives every row a unique name, in %s', (locale) => {
    const names = packCatalogRows(pack, locale).map((row) => row.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it.each(['zh-CN', 'en'] as const)('fits every column the object bounds, in %s', (locale) => {
    for (const row of packCatalogRows(pack, locale)) {
      expect(row.name.length, row.name).toBeLessThanOrEqual(200);
      expect(row.position_code.length, row.position_code).toBeLessThanOrEqual(100);
      expect((row.regulation_ref ?? '').length, row.name).toBeLessThanOrEqual(200);
    }
  });

  it('writes the evidence line into "What done means", never a gate', () => {
    for (const row of packCatalogRows(pack, 'en')) expect(row.description).toContain('**Evidence to keep:**');
    for (const row of packCatalogRows(pack, 'zh-CN')) expect(row.description).toContain('**留存证据：**');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the food-safety pack — what the card asks of it', () => {
  it('has 6–10 positions and 25–40 duties', () => {
    expect(Object.keys(FOOD_SAFETY.positions).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(FOOD_SAFETY.positions).length).toBeLessThanOrEqual(10);
    expect(FOOD_SAFETY.duties.length).toBeGreaterThanOrEqual(25);
    expect(FOOD_SAFETY.duties.length).toBeLessThanOrEqual(40);
  });

  it('spans daily, weekly, monthly, quarterly and annual work', () => {
    const frequencies = new Set(FOOD_SAFETY.duties.map((duty) => duty.frequency));
    for (const frequency of ['daily', 'weekly', 'monthly', 'quarterly', 'annual'] as const) {
      expect(frequencies, frequency).toContain(frequency);
    }
  });

  it('carries no cadence on a standing row, so #61 cannot refuse it', () => {
    for (const row of packCatalogRows(FOOD_SAFETY, 'en').filter((row) => row.form === 'standing')) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['frequency']));
      for (const column of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
        expect(row, `${row.name}.${column}`).not.toHaveProperty(column);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('no pack name or position collides with the demo catalog', () => {
  it.each(['en', 'zh-CN'] as const)('in %s', async (locale) => {
    vi.resetModules();
    vi.stubEnv(DEMO_LOCALE_ENV_VAR, locale);
    const { CATALOG_ITEMS } = await import('../src/data/demo-catalog.js');
    const demoNames = new Set(CATALOG_ITEMS.map((item) => item.name));
    const demoPositions = new Set(CATALOG_ITEMS.map((item) => item.position));
    for (const pack of CATALOG_PACKS) {
      for (const row of packCatalogRows(pack, locale)) {
        expect(demoNames.has(row.name), `${pack.id}: ${row.name}`).toBe(false);
        expect(demoPositions.has(row.position_code), `${pack.id}: ${row.position_code}`).toBe(false);
      }
    }
  });

  it('nor two packs with each other', () => {
    for (const locale of ['en', 'zh-CN'] as const) {
      const names = CATALOG_PACKS.flatMap((pack) => packCatalogRows(pack, locale).map((row) => row.name));
      expect(new Set(names).size).toBe(names.length);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('DULY_PACK chooses, and refuses what it does not know', () => {
  it.each([undefined, '', ' ', 'none', 'NONE'])('%j is no pack', (raw) => {
    expect(requestedPacks(raw)).toEqual([]);
  });

  it.each(['food-safety', ' Food-Safety ', 'food-safety,food-safety'])('%j is the food-safety pack, once', (raw) => {
    expect(requestedPacks(raw)).toEqual([FOOD_SAFETY]);
  });

  it.each(['bogus', 'food_safety', 'food-safety,bogus'])('%j is refused, naming the packs there are', (raw) => {
    expect(() => requestedPacks(raw)).toThrow(/there is no catalog pack .*Use one of: food-safety/);
  });

  it('is refused at compile time, not quietly at boot', async () => {
    vi.resetModules();
    vi.stubEnv(PACK_ENV_VAR, 'bogus');
    await expect(import('../src/data/index.js')).rejects.toThrow(/DULY_PACK="bogus"/);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('what the stack is handed', () => {
  type Dataset = { object: string; records: readonly Record<string, unknown>[] };

  const loadStackData = async (): Promise<readonly Dataset[]> => {
    vi.resetModules();
    const stack = (await import('../objectstack.config.js')).default;
    return ((stack as { data?: readonly Dataset[] }).data ?? []) as readonly Dataset[];
  };

  it('a pack alone is catalog rows and nothing else — no people, no duties', async () => {
    vi.stubEnv(PACK_ENV_VAR, 'food-safety');
    const data = await loadStackData();
    expect(data.map((dataset) => dataset.object)).toEqual(['duly_catalog_item']);
    expect(data[0]!.records).toHaveLength(FOOD_SAFETY.duties.length);
  });

  it('a pack with the demo is the whole demo plus the pack', async () => {
    vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
    vi.stubEnv(PACK_ENV_VAR, 'food-safety');
    const { demoSeeds } = await import('../src/data/index.js');
    const data = await loadStackData();
    expect(data).toHaveLength(demoSeeds.length + 1);
    expect(data.at(-1)!.records).toHaveLength(FOOD_SAFETY.duties.length);
  });

  it('pnpm demo turns the pack on, but only when the caller has not chosen', () => {
    const demoScript = readFileSync(new URL('../scripts/demo.mjs', import.meta.url), 'utf8');
    expect(demoScript).toContain("const PACK_ENV_VAR = 'DULY_PACK';");
    expect(demoScript).toContain("const DEFAULT_DEMO_PACK = 'food-safety';");
    expect(demoScript).toContain(
      'if (process.env[PACK_ENV_VAR] === undefined) process.env[PACK_ENV_VAR] = DEFAULT_DEMO_PACK;',
    );
    // And not as a shell default in package.json, which does not run on Windows.
    expect(readFileSync(new URL('../package.json', import.meta.url), 'utf8')).not.toContain('DULY_PACK');
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe.each(['en', 'zh-CN'] as const)('the pack boots on an empty database, in %s', (locale) => {
  it('lands every row through the real loader and validation rules', async () => {
    vi.resetModules();
    vi.stubEnv(PACK_ENV_VAR, 'food-safety');
    vi.stubEnv(DEMO_LOCALE_ENV_VAR, locale);
    const stack = (await import('../objectstack.config.js')).default as unknown as Record<string, unknown>;

    const { plugins } = await createStandaloneStack({
      databaseDriver: 'sqlite',
      databaseUrl: ':memory:',
      skipSeedData: true,
      // As in test/seed.test.ts: never let a local `pnpm build` artifact stand in for the config.
      artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
    });
    const kernel = new ObjectKernel();
    for (const plugin of plugins) await kernel.use(plugin);
    await kernel.use(createIdentityObjectsPlugin());
    await kernel.use(new SharingServicePlugin());
    await kernel.use(new SecurityPlugin());
    await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
    await kernel.bootstrap();

    try {
      const data = kernel.getService('data') as any;
      const items = async () =>
        ((await data.find('duly_catalog_item', {}, { context: { isSystem: true } })) ?? []) as Record<string, unknown>[];
      const deadline = Date.now() + 60_000;
      while ((await items()).length < FOOD_SAFETY.duties.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const rows = await items();
      const expected = packCatalogRows(FOOD_SAFETY, locale);
      expect(rows).toHaveLength(expected.length);
      expect(new Set(rows.map((row) => row.name))).toEqual(new Set(expected.map((row) => row.name)));
      expect(new Set(rows.map((row) => row.position_code)).size).toBe(Object.keys(FOOD_SAFETY.positions).length);
      // Nothing else: the pack writes no duty, no task and no person.
      expect(await data.find('duly_duty', {}, { context: { isSystem: true } })).toHaveLength(0);
      if (locale === 'zh-CN') for (const row of rows) expect(String(row.name)).toMatch(CJK);
    } finally {
      await kernel.shutdown?.();
    }
  }, 120_000);
});
