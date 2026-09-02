// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import { SysBusinessUnit, SysUser } from '@objectstack/platform-objects/identity';

import { CatalogItem, Duty } from '../src/objects/index.js';

/**
 * The `samples/` CSVs are the artefact the pre-sales walk-through hands an
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
  const firstLine = readFileSync(samplePath(file), 'utf8')
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .find((line) => line.trim() !== '');
  if (firstLine === undefined) throw new Error(`samples/${file} is empty`);

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

/** A default the ROW supplies for itself — a CEL expression over `record.*`,
 *  as opposed to a scalar or a caller token like `'current_user'`.
 *
 *  The distinction decides whether an omitted column is a defect (#107). Both
 *  kinds stop the import refusing the row, so neither is caught by "required";
 *  what separates them is what lands instead:
 *
 *   - **Record-derived** (`F`record.source == "self" ? … : …``): the value is
 *     computed from other columns of the SAME row, so an omitted column yields
 *     exactly what the sample would have had to type. Nothing is substituted
 *     and nothing is lost.
 *   - **Caller-derived** (`'current_user'` on `duly_duty.owner`): an omitted
 *     column yields the IMPORTER, silently, on every row — nineteen duties
 *     owned by whoever ran the import. That is the worse half of the failure
 *     this test exists for, so it stays in the required set even though it too
 *     would not be refused.
 */
const isRecordDerivedDefault = (value: unknown): boolean =>
  typeof value === 'object' && value !== null && 'dialect' in (value as Record<string, unknown>);

/** Fields a row cannot omit AND a caller may set AND the row cannot supply for
 *  itself. Each exclusion drops a field for its own reason:
 *
 *   - `readonly` — the platform's to write, never the CSV's.
 *   - a record-derived default — see above. `duly_duty.review_status` is the
 *     first field to be required, writable and defaulted this way (#107):
 *     `record.source == "self" ? "to_review" : "to_confirm"`, so an imported
 *     catalog row lands `to_confirm`, which is precisely what the product
 *     wants an imported list to be. A column for it would restate the default
 *     the walkthrough already documents ("A blank cell means leave this field
 *     unset … the object's `defaultValue` then decides") and would invite an
 *     author to type `approved` there, which `initialStates` refuses row by
 *     row. */
const requiredWritableFields = (schema: unknown): string[] =>
  fieldEntries(schema)
    .filter(([, def]) =>
      def?.required === true && def?.readonly !== true && !isRecordDerivedDefault(def?.defaultValue))
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
