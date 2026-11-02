// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed, type Seed } from '@objectstack/spec/data';

import type { Frequency } from '../../functions/period.js';
import { CatalogItem } from '../../objects/catalog-item.object.js';
import { cadenceOf, type DemoCatalogItem, type Form } from '../demo-catalog.js';
import { DEMO_LOCALE, type DemoLocale } from '../demo-locale.js';

import { EHS_PLANT } from './ehs-plant/pack.js';
import { FOOD_SAFETY } from './food-safety/pack.js';
import { ISO_9001 } from './iso-9001/pack.js';

/**
 * Catalog packs — a starting list of recurring duties for one industry, as
 * nothing but seed rows (#134). See `README.md` beside this file.
 *
 * ── What a pack is, in platform terms ─────────────────────────────────────
 * Rows of `duly_catalog_item`, and nothing else. No object, no field, no hook,
 * no metadata key. The pack's POSITIONS are the free-text `position_code` the
 * catalog already carries (so a plant can load its catalog before it models a
 * single position), and its EVIDENCE line is part of "What done means" —
 * guidance, never a gate: completion never requires evidence, a note, or a
 * percentage (an invariant, AGENTS.md). Duties need an owner, so a pack ships
 * none; they are made from the catalog with **Apply role catalog**, per position.
 *
 * ── How one is chosen, and why it is an environment variable ──────────────
 * Measured on @objectstack 18.2.0 for #134: `defineStack({ data })` is ONE
 * flat `Seed[]`, and a `Seed` scopes itself only by `env` and `locale`. The
 * platform has no named seed set to pick at boot. So the choice is made where
 * this app already makes the demo's: a variable read when the artifact is
 * compiled (`DULY_PACK`, beside `DULY_DEMO_SEED` in `../index.ts`), with every
 * boot passing `--compile`. No loader of our own.
 *
 * `Seed.locale` would be the platform's way to ship both languages and let the
 * boot pick — but the boot filters on `i18n.defaultLocale`, which this app
 * fixes at `en`. So, like the demo, the language is chosen at compile time by
 * `DULY_DEMO_LOCALE` (`zh-CN` for Chinese), and the other language's rows are
 * never written.
 */

/** One display string in both of the app's languages. zh-CN is the pack's primary. */
export interface PackText {
  readonly zh: string;
  readonly en: string;
}

/** One duty template: a row of `duly_catalog_item`. Columns are described in `README.md`. */
export interface PackDuty {
  /** A key of {@link CatalogPack.positions}. */
  readonly position: string;
  readonly name: PackText;
  /** What "done" means. */
  readonly done: PackText;
  /** The record a plant would keep to show it was done. Guidance only. */
  readonly evidence: PackText;
  readonly form: Form;
  readonly frequency?: Frequency;
  readonly dueAnchor?: 'period_start' | 'period_end';
  readonly dueOffsetDays?: number;
  readonly leadDays?: number;
  readonly graceDays?: number;
  /** The public framework the duty comes from. Omitted where there is no single source. */
  readonly reference?: PackText;
}

export interface CatalogPack {
  /** What `DULY_PACK` names. Lowercase, hyphenated. */
  readonly id: string;
  readonly title: PackText;
  /** Position key → its name, which becomes `position_code`. */
  readonly positions: Readonly<Record<string, PackText>>;
  readonly duties: readonly PackDuty[];
}

/** The environment variable that chooses packs: one id, or several separated by commas. */
export const PACK_ENV_VAR = 'DULY_PACK';

/** Every pack this repo ships. A new pack is one import and one entry here. */
export const CATALOG_PACKS: readonly CatalogPack[] = [FOOD_SAFETY, ISO_9001, EHS_PLANT];

/** Spellings that mean "no pack", besides leaving the variable unset. */
const NO_PACK = ['', 'none'];

declare const process: { env: Record<string, string | undefined> };

/**
 * The packs this compile was asked for, in the order named.
 *
 * An id that names no pack is REFUSED, loudly, before anything boots: a typo
 * that quietly loaded nothing would look exactly like the empty first boot,
 * and nobody would know the catalog they asked for is missing.
 */
export const requestedPacks = (raw: string | undefined = process.env[PACK_ENV_VAR]): CatalogPack[] => {
  const ids = [...new Set((raw ?? '').split(',').map((id) => id.trim().toLowerCase()))].filter(
    (id) => !NO_PACK.includes(id),
  );
  return ids.map((id) => {
    const pack = CATALOG_PACKS.find((candidate) => candidate.id === id);
    if (pack === undefined) {
      throw new Error(
        `${PACK_ENV_VAR}=${JSON.stringify(raw)}: there is no catalog pack ${JSON.stringify(id)}. ` +
          `Use one of: ${CATALOG_PACKS.map((p) => p.id).join(', ')} — or leave it unset for no pack.`,
      );
    }
    return pack;
  });
};

const pick = (text: PackText, locale: DemoLocale): string => (locale === 'zh-CN' ? text.zh : text.en);

/** The label in front of the evidence line, per language. */
const EVIDENCE_LABEL: PackText = { zh: '留存证据：', en: 'Evidence to keep:' };

/**
 * A pack's catalog items in one language, as `duly_catalog_item` columns.
 *
 * Cadence goes through the demo's `cadenceOf`, the one place that decides
 * which of the five cadence fields a form may carry (#61), so a pack cannot
 * trip `standing_no_frequency` and friends by carrying a stray value.
 */
export const packCatalogRows = (pack: CatalogPack, locale: DemoLocale) =>
  pack.duties.map((duty) => {
    const position = pack.positions[duty.position];
    /* c8 ignore next 3 -- a typo here would seed a row under a position nobody named */
    if (position === undefined) {
      throw new Error(`catalog pack ${pack.id}: duty ${JSON.stringify(duty.name.en)} names no position ${JSON.stringify(duty.position)}`);
    }
    const cadence = cadenceOf({ ...duty, name: duty.name.en, position: '', description: '' } as DemoCatalogItem);
    return {
      name: pick(duty.name, locale),
      position_code: pick(position, locale),
      form: duty.form,
      description: `${pick(duty.done, locale)}\n\n**${pick(EVIDENCE_LABEL, locale)}** ${pick(duty.evidence, locale)}`,
      // Spread only when present, as the demo does: an explicit `undefined` is
      // still an own property, and the loader's no-op replay check would churn
      // the row on every boot.
      ...(duty.reference === undefined ? {} : { regulation_ref: pick(duty.reference, locale) }),
      active: true,
      ...cadence,
    };
  });

/** Every column a pack writes besides the `name` it is matched on. */
const PACK_COLUMNS = [
  'position_code',
  'form',
  'description',
  'regulation_ref',
  'active',
  'frequency',
  'due_anchor',
  'due_offset_days',
  'lead_days',
  'grace_days',
] as const;

/**
 * One pack as one dataset.
 *
 * `upsert` on `name`, with every other column `applyOn: 'create'`: the pack
 * writes a row the first time it finds it missing, and a later boot with the
 * pack still on leaves the row exactly as the plant has since edited it. A
 * starting catalog is there to be changed; a replay that put the pack's
 * wording back every boot would make it a catalog you cannot own. (A row you
 * DELETE does come back on the next boot with the pack on: it is missing
 * again. Turn the pack off once the catalog is yours — see `README.md`.)
 */
export const packSeed = (pack: CatalogPack, locale: DemoLocale): Seed =>
  defineSeed(CatalogItem, {
    externalId: 'name',
    mode: 'upsert',
    columns: Object.fromEntries(PACK_COLUMNS.map((column) => [column, { applyOn: 'create' as const }])),
    records: packCatalogRows(pack, locale),
  }) as Seed;

/** What `DULY_PACK` adds to `defineStack({ data })` for this compile. Empty unless asked. */
export const packSeeds: Seed[] = requestedPacks().map((pack) => packSeed(pack, DEMO_LOCALE));
