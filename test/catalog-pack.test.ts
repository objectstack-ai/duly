// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

import { CATALOG_PACKS, PACK_ENV_VAR, packCatalogRows, requestedPacks, type CatalogPack } from '../src/data/packs/index.js';
import { EHS_PLANT } from '../src/data/packs/ehs-plant/pack.js';
import { FOOD_SAFETY } from '../src/data/packs/food-safety/pack.js';
import { ISO_9001 } from '../src/data/packs/iso-9001/pack.js';

/**
 * Catalog packs (#134): the format, the packs (food-safety #134, iso-9001
 * #136, ehs-plant #137), and the switch.
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
describe.each(CATALOG_PACKS.map((pack) => [pack.id, pack] as const))('pack %s — what its card asks of it', (_id, pack) => {
  it('has 6–10 positions and 25–40 duties', () => {
    expect(Object.keys(pack.positions).length).toBeGreaterThanOrEqual(6);
    expect(Object.keys(pack.positions).length).toBeLessThanOrEqual(10);
    expect(pack.duties.length).toBeGreaterThanOrEqual(25);
    expect(pack.duties.length).toBeLessThanOrEqual(40);
  });

  it('spans daily, weekly, monthly, quarterly and annual work', () => {
    const frequencies = new Set(pack.duties.map((duty) => duty.frequency));
    for (const frequency of ['daily', 'weekly', 'monthly', 'quarterly', 'annual'] as const) {
      expect(frequencies, frequency).toContain(frequency);
    }
  });

  it('carries no cadence on a standing row, so #61 cannot refuse it', () => {
    for (const row of packCatalogRows(pack, 'en').filter((row) => row.form === 'standing')) {
      expect(Object.keys(row)).not.toEqual(expect.arrayContaining(['frequency']));
      for (const column of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
        expect(row, `${row.name}.${column}`).not.toHaveProperty(column);
      }
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the iso-9001 pack — clause numbers and titles, never the standard', () => {
  const EN_CLAUSE = /§(\d+(?:\.\d+)*) \(([^)]+)\)/g;
  const ZH_CLAUSE = /(?:^GB\/T 19001-2016 |；)(\d+(?:\.\d+)*) ([^；]+)/g;
  const referenced = ISO_9001.duties.filter((duty) => duty.reference !== undefined);

  it('cites ISO 9001:2015 in English and GB/T 19001-2016 in Chinese, on every cited row', () => {
    for (const duty of referenced) {
      expect(duty.reference!.en, duty.name.en).toMatch(/^ISO 9001:2015 §\d/);
      expect(duty.reference!.zh, duty.name.en).toMatch(/^GB\/T 19001-2016 \d/);
    }
  });

  it('names the same clauses, by number and title only, in both languages', () => {
    for (const duty of referenced) {
      const en = [...duty.reference!.en.matchAll(EN_CLAUSE)];
      const zh = [...duty.reference!.zh.matchAll(ZH_CLAUSE)];
      expect(en.length, duty.reference!.en).toBeGreaterThan(0);
      expect(zh.map((match) => match[1]), duty.name.en).toEqual(en.map((match) => match[1]));
      // A title is a few words, not a sentence of the standard.
      for (const match of en) expect(match[2]!.split(' ').length, match[2]).toBeLessThanOrEqual(10);
      for (const match of zh) expect(match[2]!.length, match[2]).toBeLessThanOrEqual(20);
    }
  });

  it('gives one clause one title, wherever it is cited', () => {
    const titles = new Map<string, string>();
    for (const duty of referenced) {
      for (const match of duty.reference!.en.matchAll(EN_CLAUSE)) {
        expect(titles.get(match[1]!) ?? match[2], match[1]).toBe(match[2]);
        titles.set(match[1]!, match[2]!);
      }
    }
  });

  it.each(['7.1.5', '8.4', '8.7', '9.1', '9.2', '9.3', '10.2'])('covers the clause area %s the card names', (area) => {
    const clauses = referenced.flatMap((duty) => [...duty.reference!.en.matchAll(EN_CLAUSE)].map((match) => match[1]!));
    expect(clauses.some((clause) => clause === area || clause.startsWith(`${area}.`)), area).toBe(true);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the ehs-plant pack — obligation types, never an article (#137)', () => {
  it('has the 30–40 duties its card asks for', () => {
    expect(EHS_PLANT.duties.length).toBeGreaterThanOrEqual(30);
    expect(EHS_PLANT.duties.length).toBeLessThanOrEqual(40);
  });

  it.each(['manager', 'safety', 'fire', 'equipment', 'waste', 'health', 'shift'])(
    'has the position %s the card names',
    (position) => {
      expect(Object.keys(EHS_PLANT.positions)).toContain(position);
    },
  );

  it('cites a reference on every row', () => {
    for (const duty of EHS_PLANT.duties) expect(duty.reference, duty.name.en).toBeDefined();
  });

  // The card: reference the obligation type, never a named regulation's
  // article text. So no article, clause or section number in either language.
  it.each([
    ['an article in Chinese', /第[一二三四五六七八九十百零\d]+条/],
    ['an article in English', /\bArt(icle)?\.?\s*\d/i],
    ['a section sign', /§/],
    ['a clause number', /\b\d+\.\d+/],
    ['a quotation', /[“”"]/],
  ])('cites no %s', (_what, pattern) => {
    for (const duty of EHS_PLANT.duties) {
      expect(duty.reference!.zh, duty.name.en).not.toMatch(pattern);
      expect(duty.reference!.en, duty.name.en).not.toMatch(pattern);
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

  it.each(['iso-9001', ' ISO-9001 '])('%j is the iso-9001 pack alone', (raw) => {
    expect(requestedPacks(raw)).toEqual([ISO_9001]);
  });

  it.each(['ehs-plant', ' EHS-Plant '])('%j is the ehs-plant pack alone', (raw) => {
    expect(requestedPacks(raw)).toEqual([EHS_PLANT]);
  });

  it('takes several packs, in the order named', () => {
    expect(requestedPacks('iso-9001,food-safety')).toEqual([ISO_9001, FOOD_SAFETY]);
  });

  it.each(['bogus', 'food_safety', 'iso9001', 'food-safety,bogus'])('%j is refused, naming the packs there are', (raw) => {
    expect(() => requestedPacks(raw)).toThrow(/there is no catalog pack .*Use one of: food-safety, iso-9001/);
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

  it.each(CATALOG_PACKS.map((pack) => [pack.id, pack] as const))(
    '%s alone is its own catalog rows and nothing else — no other pack, no people, no duties',
    async (id, pack) => {
      vi.stubEnv(PACK_ENV_VAR, id);
      const data = await loadStackData();
      expect(data.map((dataset) => dataset.object)).toEqual(['duly_catalog_item']);
      expect(data[0]!.records.map((row) => row.name)).toEqual(packCatalogRows(pack, 'en').map((row) => row.name));
    },
  );

  it('two packs are two datasets, one per pack', async () => {
    vi.stubEnv(PACK_ENV_VAR, 'food-safety,iso-9001');
    const data = await loadStackData();
    expect(data.map((dataset) => dataset.records.length)).toEqual([FOOD_SAFETY.duties.length, ISO_9001.duties.length]);
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
describe.each(
  CATALOG_PACKS.flatMap((pack) => (['en', 'zh-CN'] as const).map((locale) => [pack.id, locale, pack] as const)),
)('pack %s boots on an empty database, in %s', (id, locale, pack) => {
  it('lands every row through the real loader and validation rules', async () => {
    vi.resetModules();
    vi.stubEnv(PACK_ENV_VAR, id);
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
      while ((await items()).length < pack.duties.length && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 250));
      }

      const rows = await items();
      const expected = packCatalogRows(pack, locale);
      expect(rows).toHaveLength(expected.length);
      expect(new Set(rows.map((row) => row.name))).toEqual(new Set(expected.map((row) => row.name)));
      expect(new Set(rows.map((row) => row.position_code)).size).toBe(Object.keys(pack.positions).length);
      // Nothing else: the pack writes no duty, no task and no person.
      expect(await data.find('duly_duty', {}, { context: { isSystem: true } })).toHaveLength(0);
      if (locale === 'zh-CN') for (const row of rows) expect(String(row.name)).toMatch(CJK);
    } finally {
      await kernel.shutdown?.();
    }
  }, 120_000);
});
