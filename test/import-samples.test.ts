// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SysBusinessUnit, SysUser } from '@objectstack/platform-objects/identity';

import { CATALOG_ITEMS, cadenceOf } from '../src/data/demo-catalog.js';
import { POSITIONS } from '../src/data/demo-org.js';
import { CatalogItem, Duty } from '../src/objects/index.js';

/**
 * The `samples/` CSVs are the artefact the import walkthrough hands an
 * evaluator: "here is your existing duty list, import it". They go in through
 * the PLATFORM's standard Import button on each object list — Duly writes no
 * import code (#19) — so nothing in this repo would notice the day a field is
 * renamed underneath them.
 *
 * And the failure would be quiet. Measured on `@objectstack/connector-rest`
 * 17.2.0 against a live `pnpm dev`: a column the mapping step cannot place is
 * marked `— Skip —` and the row still imports, minus that column. So a renamed
 * `position_code` does not produce a red import; it produces 21 catalog items
 * with no position, and a demo that looks like it worked.
 *
 * This file is the tripwire: every header in every shipped sample must name a
 * field the target object actually has.
 *
 * ── Read off the schema, never hand-copied ───────────────────────────────
 * The field lists below are derived from the `ObjectSchema` objects
 * themselves. A hand-maintained list of "the columns the sample uses" would be
 * a second copy of the same fact, and the copy is what goes stale.
 *
 * ── Two tiers, because ownership differs ─────────────────────────────────
 * `duly_catalog_item` and `duly_duty` are objects THIS APP declares, so the
 * test can hold the samples to what the import will actually WRITE: declared
 * fields minus `readonly`. Measured on a live import, both directions:
 *
 *   - `duly_duty.last_dispatched_period` (`readonly: true`) maps in the
 *     wizard as **"Last dispatched period (match only)"**, the import reports
 *     `1 created`, and the column reads back `null`. Mapped, reported,
 *     not written.
 *   - every non-readonly column in both samples landed: 21 and 19 rows, `0
 *     skipped`, with cadence, timezone, status and source all as authored.
 *
 * `sys_user` and `sys_business_unit` are the PLATFORM's, and the platform's
 * own `readonly` flag does not predict what its import writes there:
 * `sys_user.email` is `readonly: true` and IS written (12 rows created, each
 * with its address), while `sys_user.manager_id` is `readonly: true` and is
 * dropped to `— Skip —`. Encoding that split here would be this app
 * describing a table it does not own — the same mistake `src/data/org.seed.ts`
 * declines to make with `defineSeed`. So the platform samples are held to the
 * weaker, uncontested property: every header names a DECLARED field. That
 * still catches the rename this file exists for.
 */

const samplePath = (file: string): URL => new URL(`../samples/${file}`, import.meta.url);

/**
 * The header row of a CSV, as field names.
 *
 * Quote-aware because the platform's own template download quotes any header
 * containing a comma (`"Offset (days, 0 = anchor day)"`), and a sample
 * regenerated from that template would carry the same shape. BOM-stripped for
 * the same reason — the template ships one.
 */
function csvHeader(file: string): string[] {
  const firstLine = csvLines(file)[0];
  if (firstLine === undefined) throw new Error(`samples/${file} is empty`);
  return csvCells(firstLine);
}

/** The non-blank lines of a sample, BOM-stripped. No sample cell spans a line. */
const csvLines = (file: string): string[] =>
  readFileSync(samplePath(file), 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '');

/** One CSV line as cells, honouring quotes and doubled quotes. */
function csvCells(firstLine: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < firstLine.length; i++) {
    const ch = firstLine[i];
    if (quoted) {
      if (ch === '"') {
        if (firstLine[i + 1] === '"') { cur += '"'; i++; } else { quoted = false; }
      } else cur += ch;
      continue;
    }
    if (ch === '"') { quoted = true; continue; }
    if (ch === ',') { out.push(cur.trim()); cur = ''; continue; }
    cur += ch;
  }
  out.push(cur.trim());
  return out;
}

/** `[fieldName, definition]` for every field the schema declares. */
function fieldEntries(schema: unknown): Array<[string, { readonly?: boolean; required?: boolean; defaultValue?: unknown }]> {
  const fields = (schema as { fields?: Record<string, Record<string, unknown>> }).fields;
  if (!fields || typeof fields !== 'object') throw new Error('schema declares no fields');
  return Object.entries(fields).map(([key, def]) => [
    typeof def?.name === 'string' ? (def.name as string) : key,
    def as { readonly?: boolean; required?: boolean; defaultValue?: unknown },
  ]);
}

const declaredFields = (schema: unknown): string[] => fieldEntries(schema).map(([name]) => name);

/** Declared minus `readonly` — what the import will actually write. */
const writableFields = (schema: unknown): string[] =>
  fieldEntries(schema).filter(([, def]) => def?.readonly !== true).map(([name]) => name);

/** Fields a row cannot omit AND a caller may set — every `required` field
 *  that is not `readonly` (the platform's to write, never the CSV's).
 *
 *  A default does not take a field off this list, and that was measured, not
 *  assumed. Until #128 this helper also excluded a field whose default the
 *  row supplies for itself (a CEL `defaultValue` over `record.*`), on the
 *  reasoning of #107: `duly_duty.review_status` defaults to
 *  `record.source == "self" ? "to_review" : "to_confirm"`, so an omitted
 *  column lands exactly what a sample would have typed. That held on the
 *  17.2.0 Import. On `@objectstack/*` 18.2.0 the wizard's mapping step stops
 *  instead — "Can't continue — required field(s) not mapped: Review status
 *  (review_status)" — with Next disabled, whatever the default would have
 *  done. So `samples/duties.csv` carries the column, written as the default
 *  would have written it (`to_confirm` on catalog rows, `to_review` on the
 *  self-declared one), and this helper holds every sample to the rule the
 *  wizard enforces rather than the one the engine would. Never write
 *  `approved` there: `initialStates` refuses it row by row. */
const requiredWritableFields = (schema: unknown): string[] =>
  fieldEntries(schema)
    .filter(([, def]) => def?.required === true && def?.readonly !== true)
    .map(([name]) => name);

describe('samples/ — the duty list an evaluator imports (#19)', () => {
  describe.each([
    { file: 'catalog-items.csv', object: 'duly_catalog_item', schema: CatalogItem },
    { file: 'duties.csv', object: 'duly_duty', schema: Duty },
  ])('$file → $object', ({ file, schema }) => {
    it('every header names a field the import will write', () => {
      const writable = writableFields(schema);
      const unknown = csvHeader(file).filter((h) => !writable.includes(h));
      // Named rather than counted: the failure message has to say WHICH column
      // stopped resolving, because the symptom in the app is a silently blank
      // one.
      expect(unknown).toEqual([]);
    });

    it('carries every field a row cannot be created without', () => {
      const header = csvHeader(file);
      const missing = requiredWritableFields(schema).filter((f) => !header.includes(f));
      // The other direction of the same rot: a NEW required field leaves the
      // sample syntactically fine and refused row by row at import time.
      expect(missing).toEqual([]);
    });
  });

  describe.each([
    { file: 'business-units.csv', object: 'sys_business_unit', schema: SysBusinessUnit },
    { file: 'people.csv', object: 'sys_user', schema: SysUser },
  ])('$file → $object (platform object — declared-fields tier)', ({ file, schema }) => {
    it('every header names a declared field', () => {
      const declared = declaredFields(schema);
      const unknown = csvHeader(file).filter((h) => !declared.includes(h));
      expect(unknown).toEqual([]);
    });
  });
});

/**
 * #120 — the catalog sample and the demo describe the same fictional
 * manufacturer, so where they share an item they must say the same thing
 * about it.
 *
 * Nothing else observes this. The header tests above hold columns, not
 * values, and `position_code` is free text matched verbatim, so the sample
 * kept `plant_compliance_officer` for weeks after the demo started reading
 * `Plant compliance officer`, and kept a 150-day audit lead after the demo
 * moved to 200: both imported cleanly, and an evaluator saw two spellings of
 * one position and two cadences for one audit.
 *
 * The sample is allowed to carry items the demo does not (it is a whole
 * catalog export; the demo seeds what its lenses need), so the comparison is
 * over the shared names, and fails if that overlap ever collapses.
 */
describe('samples/catalog-items.csv agrees with the demo catalog (#120)', () => {
  const [header, ...lines] = csvLines('catalog-items.csv');
  const columns = csvCells(header!);
  const rows = lines.map((line) => {
    const cells = csvCells(line);
    return Object.fromEntries(columns.map((c, i) => [c, cells[i] ?? '']));
  });
  const demoByName = new Map(CATALOG_ITEMS.map((item) => [item.name, item]));
  const shared = rows.filter((row) => demoByName.has(row.name!));

  it('shares most of its items with the demo, so the checks below mean something', () => {
    expect(shared.length).toBeGreaterThanOrEqual(CATALOG_ITEMS.length - 2);
  });

  it('spells every position the way the demo does', () => {
    const demoPositions = Object.values(POSITIONS) as string[];
    const strays = [...new Set(rows.map((row) => row.position_code!))]
      .filter((code) => !demoPositions.includes(code));
    expect(strays).toEqual([]);
  });

  it.each(shared.map((row) => [row.name!, row] as const))('%s: same position, form and cadence', (name, row) => {
    const demo = demoByName.get(name)!;
    const cadence = cadenceOf(demo);
    const num = (cell: string | undefined): number | undefined => (cell ? Number(cell) : undefined);
    expect({
      position_code: row.position_code,
      form: row.form,
      frequency: row.frequency || undefined,
      due_anchor: row.due_anchor || undefined,
      due_offset_days: num(row.due_offset_days),
      lead_days: num(row.lead_days),
      grace_days: num(row.grace_days),
    }).toEqual({
      position_code: demo.position,
      form: demo.form,
      frequency: cadence.frequency,
      due_anchor: cadence.due_anchor,
      due_offset_days: cadence.due_offset_days,
      lead_days: cadence.lead_days,
      grace_days: cadence.grace_days,
    });
  });
});
