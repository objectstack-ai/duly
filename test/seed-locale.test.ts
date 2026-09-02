// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

/**
 * The demo fixture in both languages, asserted against TWO REAL BOOTED
 * KERNELS — one per locale — with the declarative seeder actually running.
 *
 * `test/seed.test.ts` is the suite that proves the demo lands and that every
 * view has something in it; it does that in English, which is the source
 * language and the default. This file asks the three questions that only
 * appear once there are two languages:
 *
 *  1. **Is the Chinese demo the SAME demo?** Same objects, same row counts,
 *     same statuses. A zh-CN fixture with 19 catalog items where the English
 *     one has 20 is not a translation bug anybody notices on a screen — the
 *     app looks fine, and one obligation has silently stopped existing.
 *  2. **Did anything stay in English?** Every display string a zh-CN boot puts
 *     in the database has to carry at least one Han character. This is the
 *     assertion that catches a fixture line somebody forgot to translate,
 *     HERE, rather than in a demo in front of a customer — which is the whole
 *     reason the card asked for it.
 *  3. **Is the English demo still exactly what it was?** The Chinese half is
 *     a new audience, not a licence to reword the English one. The names and
 *     subjects are pinned literally below, and the dictionary-coverage test
 *     pins the prose the same way (an English line that is reworded orphans
 *     its translation and goes red).
 *
 * ── Why the strings are read back from the DATABASE, not from the fixture ──
 * Same reason as `test/seed.test.ts`: `src/data/demo-*.ts` is plain TypeScript
 * that would satisfy any assertion made about it whether or not a row ever
 * reached the database. Half of these strings are NATURAL KEYS — `duly_task.duty`
 * resolves against `duly_duty.name`, `owner` against `sys_user.name` — so the
 * failure a translation can cause is not "reads oddly", it is a reference that
 * resolves to nothing and a row refused, or worse, resolved to the wrong row.
 * Only the loader can be asked about that.
 */

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const DEMO_LOCALE_ENV_VAR = 'DULY_DEMO_LOCALE';

const SYSTEM = { isSystem: true } as const;

/** Every object the demo writes into, in the order the barrel lists them. */
const SEEDED_OBJECTS = [
  'sys_business_unit',
  'sys_user',
  'sys_business_unit_member',
  'duly_catalog_item',
  'duly_duty',
  'duly_assignment',
  'duly_task',
  'duly_log_entry',
] as const;

type Row = Record<string, unknown>;

interface Booted {
  kernel: any;
  rows: Record<string, Row[]>;
}

/**
 * Boot the app once, with the demo on and the given locale, and read every
 * seeded object back.
 *
 * `vi.resetModules()` before the dynamic import is what makes a second locale
 * possible at all: both `DULY_DEMO_SEED` and `DULY_DEMO_LOCALE` are read at
 * module-evaluation time (the fixture is baked into the compiled artifact, so
 * they are compile-time decisions), and a cached module graph would hand back
 * the previous locale's fixture while reporting success.
 */
const boot = async (locale: string): Promise<Booted> => {
  vi.resetModules();
  vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
  vi.stubEnv(DEMO_LOCALE_ENV_VAR, locale);

  const stack = (await import('../objectstack.config.js')).default as unknown as Record<string, unknown>;
  expect(
    (stack.data as unknown[] | undefined)?.length ?? 0,
    `this suite boots the demo, so ${DEMO_SEED_ENV_VAR} must be set before the config is imported`,
  ).toBeGreaterThan(0);

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Same guard as `test/seed.test.ts`: point the artifact lookup at a path
    // that cannot exist, or a local `pnpm build` leaves `dist/objectstack.json`
    // where the kernel loads metadata — objects, hooks AND the compiled seed —
    // from the last BUILD rather than from the config imported above. In this
    // suite that would be worse than stale: the built artifact carries exactly
    // one locale, so both boots would read the same one and agree perfectly.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  const kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
  await kernel.bootstrap();

  // `any`, as in `test/seed.test.ts`: the kernel's service registry is keyed by
  // name and returns `unknown`, and narrowing it here would be this suite
  // describing a platform surface it does not own.
  const data = kernel.getService('data') as any;
  const all = async (object: string): Promise<Row[]> =>
    ((await data.find(object, {}, { context: SYSTEM })) ?? []) as Row[];

  // The inline seed is raced against a budget rather than awaited by
  // bootstrap, so wait for the LAST dataset in the barrel to have landed.
  const deadline = Date.now() + 120_000;
  for (;;) {
    const logs = (await all('duly_log_entry')).length;
    if (logs >= 15) break;
    if (Date.now() > deadline) throw new Error(`${locale}: seed did not settle — ${logs} log entries after 120s`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const rows: Record<string, Row[]> = {};
  for (const object of SEEDED_OBJECTS) rows[object] = await all(object);
  return { kernel, rows };
};

let en: Booted;
let zh: Booted;

beforeAll(async () => {
  en = await boot('en');
  zh = await boot('zh-CN');
}, 300_000);

afterAll(async () => {
  await en?.kernel?.shutdown?.();
  await zh?.kernel?.shutdown?.();
  vi.unstubAllEnvs();
  vi.resetModules();
});

// ───────────────────────────────────────────────────────────────────────────
/** Any CJK ideograph, including the extension blocks a rarer surname needs. */
const HAN = /[㐀-䶿一-鿿豈-﫿]/u;

/** The fields of each object that a person READS. Machine values are not here. */
const DISPLAY_FIELDS: Readonly<Record<string, readonly string[]>> = {
  sys_business_unit: ['name'],
  sys_user: ['name'],
  duly_catalog_item: ['name', 'description', 'regulation_ref', 'position_code'],
  duly_duty: ['name', 'description', 'review_note'],
  duly_assignment: ['subject', 'description'],
  duly_task: ['subject', 'note', 'skip_reason'],
  duly_log_entry: ['subject', 'detail'],
};

/** `[object.field on row N, value]` for every non-blank display string. */
const displayStrings = (booted: Booted): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  for (const [object, fields] of Object.entries(DISPLAY_FIELDS)) {
    for (const row of booted.rows[object] ?? []) {
      for (const field of fields) {
        const value = row[field];
        if (typeof value === 'string' && value.trim() !== '') out.push([`${object}.${field}`, value]);
      }
    }
  }
  return out;
};

// ───────────────────────────────────────────────────────────────────────────
describe('the two locales are the same demo', () => {
  it('boots into two independent databases', async () => {
    // Stated first because every comparison below is meaningless without it:
    // two kernels sharing one in-memory store would make the second boot see
    // the first one's rows, and "same counts" would be trivially true of a
    // fixture that had been seeded twice.
    const enDuties = en.rows.duly_duty!.map((duty) => String(duty.name));
    const zhDuties = zh.rows.duly_duty!.map((duty) => String(duty.name));
    expect(enDuties.some((name) => HAN.test(name)), 'a Chinese duty in the English database').toBe(false);
    expect(zhDuties.every((name) => HAN.test(name)), 'an English duty in the Chinese database').toBe(true);
  });

  it('writes the same number of rows into every object', () => {
    // The failure this catches: a translation that does not resolve as a
    // natural key. `duly_task.owner` is required, so an owner that matches no
    // `sys_user.name` does not drop a field — it refuses the whole row, and
    // the seed still reports success.
    for (const object of SEEDED_OBJECTS) {
      expect(zh.rows[object]!.length, `${object} row count differs between locales`).toBe(
        en.rows[object]!.length,
      );
    }
    // And the fixture is really populated, so "equal" cannot be met by two
    // empty databases.
    expect(en.rows.duly_task!.length).toBeGreaterThan(100);
  });

  it('and the same shape of history — statuses, calibers, review states', () => {
    const tally = (booted: Booted, object: string, field: string): Record<string, number> => {
      const out: Record<string, number> = {};
      for (const row of booted.rows[object] ?? []) {
        const key = String(row[field]);
        out[key] = (out[key] ?? 0) + 1;
      }
      return out;
    };
    // Select values are machine data: the translations bundle renders them, so
    // a fixture that "translated" one would break every filter naming it.
    expect(tally(zh, 'duly_task', 'status')).toEqual(tally(en, 'duly_task', 'status'));
    expect(tally(zh, 'duly_task', 'source')).toEqual(tally(en, 'duly_task', 'source'));
    expect(tally(zh, 'duly_duty', 'review_status')).toEqual(tally(en, 'duly_duty', 'review_status'));
    expect(tally(zh, 'duly_duty', 'form')).toEqual(tally(en, 'duly_duty', 'form'));
    expect(tally(zh, 'duly_catalog_item', 'frequency')).toEqual(tally(en, 'duly_catalog_item', 'frequency'));
    expect(tally(zh, 'duly_log_entry', 'category')).toEqual(tally(en, 'duly_log_entry', 'category'));
    // Period keys are computed by the engine and must not vary with language.
    expect(tally(zh, 'duly_task', 'period_key')).toEqual(tally(en, 'duly_task', 'period_key'));
  });

  it('keeps the machine values identical, language by language', () => {
    const codes = (booted: Booted) => booted.rows.sys_business_unit!.map((u) => String(u.code)).sort();
    expect(codes(zh)).toEqual(codes(en));
    const zones = (booted: Booted) => booted.rows.duly_duty!.map((d) => String(d.timezone)).sort();
    expect(zones(zh)).toEqual(zones(en));
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('nothing is left in English in a zh-CN demo', () => {
  it('every display string a Chinese boot writes carries a Han character', () => {
    const strings = displayStrings(zh);
    // A real population, or an empty one would pass vacuously — and exactly as
    // many strings as the English boot, which is the assertion that actually
    // holds it down: a column that stopped being written, or a display field
    // renamed out from under the list above, would shrink one side only.
    expect(strings.length).toBeGreaterThan(300);
    expect(strings.length, 'the two locales write a different number of display strings').toBe(
      displayStrings(en).length,
    );
    const untranslated = strings.filter(([, value]) => !HAN.test(value));
    // Named rather than counted: the point of this test is to say WHICH line
    // was missed, because the symptom otherwise is one English row on a
    // Chinese screen — which reads as a styling quirk, not a missing string.
    expect(untranslated).toEqual([]);
  });

  it('and the English boot has none of them, so the check is really about language', () => {
    // The mirror image. Without it, a regex that matched everything — or a
    // display-field list naming columns that do not exist — would pass above
    // and prove nothing.
    const strings = displayStrings(en);
    expect(strings.length).toBeGreaterThan(300);
    expect(strings.filter(([, value]) => HAN.test(value))).toEqual([]);
  });

  it('but the mailboxes stay ASCII, on a domain that cannot exist', () => {
    // `sys_user.email` is an identifier that gets typed, pasted and matched
    // on. The display name is Chinese; the address is pinyin. RFC 2606 holds
    // in both locales — see `test/seed.test.ts` for why that is a hard rule.
    const addressed = zh.rows.sys_user!.filter((user) => user.email);
    expect(addressed.length).toBe(12);
    for (const user of addressed) {
      expect(String(user.email), `${user.name}'s address`).toMatch(/^[a-z]+\.[a-z]+@ardenline\.example$/);
    }
    // Distinct, or two people share a mailbox.
    expect(new Set(addressed.map((user) => String(user.email))).size).toBe(12);
  });

  it('names no real company, person, site or regulation', () => {
    // The fixture's hard rule, restated for the strings this card adds. A demo
    // seed is screenshotted into decks; a real GB/T number in one is a claim
    // about a real regulation. Every reference the Chinese catalog cites is an
    // internal document belonging to a company that does not exist, and they
    // are spelled as such — 《…》 wrapping an invented internal code.
    const references = zh.rows
      .duly_catalog_item!.map((item) => item.regulation_ref)
      .filter((ref): ref is string => typeof ref === 'string');
    expect(references.length).toBeGreaterThan(15);
    for (const reference of references) {
      expect(reference, 'a catalog reference must be an internal document').toMatch(/^《.+》第\d+[条款]$/u);
      // The spellings a real Chinese standard would carry. None of these can
      // appear in an invented internal policy number.
      expect(reference).not.toMatch(/GB|ISO|HJ\/T|国标/);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the English demo is byte-for-byte what it was', () => {
  /**
   * Pinned literally, not snapshotted to a file: a `.snap` is updated by
   * `vitest -u` without anybody reading the diff, and the whole point of this
   * block is that a change to the English demo has to be a deliberate,
   * reviewable edit. These are the strings an evaluator reads on the first
   * screen and the ones every deck screenshot carries.
   */
  const names = (object: string, field: string): string[] =>
    en.rows[object]!.map((row) => String(row[field])).sort();

  it('the org chart', () => {
    expect(names('sys_business_unit', 'name')).toEqual([
      'Ardenline Group',
      'Central Office',
      'Northgate Operations',
      'Northgate Plant',
      'Northgate Quality',
      'Riverside Plant',
    ]);
    expect(names('sys_user', 'name')).toEqual([
      'Ana Ferreira',
      'Dev Admin',
      'Elin Halvorsen',
      'Greta Lindqvist',
      'Ibrahim Chaudhry',
      'Marek Dvorak',
      'Nadia Ilves',
      'Owen Pryce',
      'Priya Raman',
      'Rosa Delgado',
      'Sami Okonkwo',
      'Tomas Bergh',
      'Yuki Tanabe',
    ]);
  });

  it('the role catalog, and the three positions it hangs off', () => {
    expect(names('duly_catalog_item', 'name')).toEqual([
      'Annual environmental statement',
      'Answer the duty phone',
      'Calibration verification',
      'Cleaning verification swabs',
      'Commissioning file handover',
      'Contractor induction refresh',
      'Effluent sampling record',
      'Emissions return',
      'Instrument drift check',
      'Keep the permit register current',
      'Lifting equipment check',
      'Line safety walk',
      'Nonconformance log review',
      'Overtime justification summary',
      'Permit condition review',
      'Retained sample review',
      'Shift handover record',
      'Site environmental audit',
      'Toolbox talk record',
      'Waste transfer log review',
    ]);
    // Readable in English too (#117 item 3) — they used to be
    // `plant_compliance_officer`, a machine spelling in a column people read.
    expect([...new Set(names('duly_catalog_item', 'position_code'))].sort()).toEqual([
      'Plant compliance officer',
      'Quality technician',
      'Shift supervisor',
    ]);
  });

  it('the duties, whose names are also the natural key every task resolves against', () => {
    expect(names('duly_duty', 'name')).toEqual([
      'Annual environmental statement — Ardenline',
      'Answer the duty phone — Northgate Quality',
      'Calibration verification — Lab 1',
      'Calibration verification — Lab 2',
      'Commissioning file handover — Riverside upgrade',
      'Contractor induction refresh — Northgate',
      'Emissions return — Northgate',
      'Emissions return — Riverside',
      'Instrument drift check — Lab 2',
      'Keep the permit register current — Ardenline',
      'Keep the permit register current — Northgate',
      'Keep up with regulator bulletins',
      'Lifting equipment check — Line C',
      'Line safety walk — Line A',
      'Line safety walk — Line B',
      'Line safety walk — Riverside',
      'Monthly quality trend read',
      'Monthly site performance note',
      'Nonconformance log review — Northgate Quality',
      'Nonconformance log review — Riverside',
      'Overtime justification summary — Northgate Operations',
      'Permit condition review — Northgate',
      'Permit condition review — Riverside',
      'Retained sample review — Lab 1',
      'Shift handover record — Line A',
      'Site environmental audit — Northgate',
      'Toolbox talk record — Line B',
      'Toolbox talk record — Riverside',
      'Track my own training hours',
      'Waste transfer log review — Northgate',
      'Waste transfer log review — Riverside',
    ]);
  });

  it('the two assignments and the personal work log', () => {
    expect(names('duly_assignment', 'subject')).toEqual([
      'Q3 supplier certificate sweep',
      'Winter shutdown readiness check',
    ]);
    expect(names('duly_log_entry', 'subject')).toEqual([
      'Chased the carrier for three missing transfer notes',
      'Covered the goods-in checks while Ibrahim was on leave',
      'Drafted the shutdown environmental brief',
      'Half a day rebuilding the meter reading spreadsheet',
      'Helped operations read the swab results',
      'Lab handover meeting with the night shift',
      'Out-of-hours callout: effluent alarm on the north outfall',
      'Recalibrated the bench balance after the move',
      'Rewrote the sampling instruction after the lab query',
      'Sat in on the Riverside permit review to compare approaches',
      'Sorted the supplier certificate folder into something findable',
      'Standing call with the regulator liaison',
      'Traced the drift on the pH probe back to the buffer batch',
      'Walked the new starter through the permit register',
      'Wrote up the retained-sample disposal procedure',
    ]);
  });
});
