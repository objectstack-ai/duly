// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { CatalogItem, Duty } from '../src/objects/index.js';
import { FREQUENCIES } from '../src/functions/period.js';
import { planDispatch, type DispatchDuty } from '../src/jobs/dispatch.plan.js';

/**
 * #82 — `due_offset_days`, `lead_days` and `grace_days` accepted values the
 * product cannot carry out.
 *
 * The defect is the shape #24 had one field over: a value that validates
 * clean on the record and fails days later, inside the nightly batch,
 * attributed to the job rather than to the duty holding it. The fix is
 * DECLARATIVE — `scale` / `min` / `max` on the field (AGENTS.md rule 9) —
 * because the engine's number validator enforces those three and only when
 * they are declared, and because a declared `scale: 0` also makes the form
 * render a whole-number input.
 *
 * ── The three fields did NOT behave the same, and that is the point ──────
 * They share a declaration and reach the period engine by different routes.
 * Measured on 17.2.0 before the fix, one duty at a time:
 *
 *   due_offset_days: 1.5   `dueDateFor` throws; the run is `degraded` and the
 *                          duty produces nothing —
 *                          "dueOffsetDays must be a whole number of days,
 *                           received 1.5"
 *   lead_days: 2.5         throws one function over (`visibleFromFor`, reached
 *                          through `addCalendarDays`, which NEGATES), so the
 *                          message names a value nobody typed —
 *                          "leadDays must be a whole number of days,
 *                           received -2.5"
 *   grace_days: 2.5        throws nowhere, ever. It never reaches the period
 *                          engine; its only evaluating reader is the overdue
 *                          escalation's CEL gate, which wraps it in `int()`.
 *                          `int(2.5) == 2`, so it escalates on the day a
 *                          grace of 2 would — silently, forever.
 *
 * The suite below therefore proves the WRITE is refused (one place, one
 * mechanism), and separately that every value the declaration still admits is
 * one the consumers can actually carry out.
 *
 * ── Why this boots a real engine ─────────────────────────────────────────
 * A structural assertion (`Duty.fields.x.scale === 0`) proves the key is
 * present, not that anything enforces it. Only a real insert proves the
 * refusal, and only a real UPDATE proves the update path — the two are
 * different code paths in the engine, and #65 was exactly a rule that held on
 * insert and did nothing on update.
 */

type AnyRow = Record<string, unknown>;

interface FieldFault {
  field: string;
  code: string;
  message: string;
  label?: string;
  constraint?: Record<string, unknown>;
}

let kernel: { getService(name: string): unknown; shutdown?(): Promise<void> } | undefined;
let data: {
  insert(o: string, d: AnyRow, x?: AnyRow): Promise<AnyRow>;
  update(o: string, d: AnyRow, x?: AnyRow): Promise<unknown>;
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Must not resolve to a real path — see cadence-conditional-defaults.test.ts:
    // a local `pnpm build` would make the suite report on the last BUILD.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  const k = new ObjectKernel();
  for (const plugin of plugins) await k.use(plugin);
  await k.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await k.bootstrap();
  kernel = k as unknown as typeof kernel;
  data = k.getService('data') as typeof data;
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

/**
 * Assert a refusal by its ENVELOPE (ADR-0112), never by the bare fact that it
 * threw. `expect(...).rejects.toThrow()` would pass on ANY error — including
 * the "Owner is required" a malformed fixture produces — which is how a
 * rejection test ends up green against a field that enforces nothing.
 *
 * The engine-level envelope carries `code` and a per-field `fields[]`; it
 * carries no HTTP `status` (measured: `undefined` — status is the REST
 * layer's mapping, not this one's), so the field-level `code` is what stands
 * in for it here and it is the more precise assertion anyway:
 * `max_scale` and `max_value` are different refusals.
 */
async function refusal(promise: Promise<unknown>): Promise<{ code: unknown; message: string; fields: FieldFault[] }> {
  try {
    await promise;
  } catch (error: any) {
    return {
      code: error?.code,
      message: String(error?.message ?? ''),
      fields: (error?.fields ?? []) as FieldFault[],
    };
  }
  throw new Error('expected the write to be refused, but it resolved');
}

let seq = 0;

const dutyRow = (over: AnyRow): AnyRow => ({
  name: `Duty ${++seq}`,
  owner: `user_${seq}`,
  source: 'self',
  status: 'active',
  form: 'recurring',
  frequency: 'monthly',
  ...over,
});

const catalogRow = (over: AnyRow): AnyRow => ({
  name: `Item ${++seq}`,
  position_code: 'test_position',
  form: 'recurring',
  frequency: 'monthly',
  ...over,
});

const insertDuty = (over: AnyRow) => data.insert('duly_duty', dutyRow(over));
const insertCatalogItem = (over: AnyRow) => data.insert('duly_catalog_item', catalogRow(over));

/** The declared box, as one table both objects are checked against. */
const BOUNDS = {
  due_offset_days: { scale: 0, min: -366, max: 366 },
  lead_days: { scale: 0, min: 0, max: 366 },
  grace_days: { scale: 0, min: 0, max: 30 },
} as const;

type CadenceField = keyof typeof BOUNDS;
const CADENCE_FIELDS = Object.keys(BOUNDS) as CadenceField[];

// ─────────────────────────────────────────────────────────────────────────
// The declaration
// ─────────────────────────────────────────────────────────────────────────

describe('the constraints are declared, not scripted', () => {
  it.each(CADENCE_FIELDS)('duly_duty.%s declares scale, min and max', (field) => {
    expect(Duty.fields[field]).toMatchObject(BOUNDS[field]);
  });

  it.each(CADENCE_FIELDS)('duly_catalog_item.%s declares the SAME box', (field) => {
    // A catalog item is a duty template and `applyCatalogHandler` copies all
    // three onto every duty it creates. A laxer bound here is the same silent
    // hole reached one object earlier — and a STRICTER one would refuse a
    // template for a duty that is perfectly legal.
    expect(CatalogItem.fields[field]).toMatchObject(BOUNDS[field]);
  });

  it('no hand-written validation was added for any of it', () => {
    // The card left this open — `scale: 0` versus a `script` validation with a
    // product-voice message — and the answer is the platform's own key
    // (AGENTS.md rule 9). The measured refusal is already product voice
    // ("Offset (days, 0 = anchor day) must have at most 0 decimal places
    // (got 1)"), so there is nothing layered on top of it. This pins that:
    // a rule re-stating a declared bound is two sources of truth for one
    // limit, and the one that drifts is always the hand-written one.
    for (const object of [Duty, CatalogItem]) {
      for (const rule of object.validations ?? []) {
        const source = JSON.stringify(rule);
        for (const needle of ['decimal', 'whole number', '366', 'scale']) {
          expect(source, `validation '${rule.name}' on ${object.name}`).not.toContain(needle);
        }
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The refusals — a real engine, a real write
// ─────────────────────────────────────────────────────────────────────────

describe('a fractional cadence value is refused at write time', () => {
  it.each(CADENCE_FIELDS)('duly_duty.%s: 1.5 is refused as max_scale', async (field) => {
    const { code, message, fields } = await refusal(insertDuty({ [field]: 1.5 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(fields).toHaveLength(1);
    expect(fields[0]).toMatchObject({ field, code: 'max_scale', constraint: { scale: 0, actual: 1 } });
    // The refusal names the field the author is looking at, in its own label.
    expect(message).toContain(String((Duty.fields[field] as { label?: string }).label));
    expect(message).toContain('at most 0 decimal places');
  });

  it.each(CADENCE_FIELDS)('duly_catalog_item.%s: 1.5 is refused too', async (field) => {
    const { code, fields } = await refusal(insertCatalogItem({ [field]: 1.5 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(fields[0]).toMatchObject({ field, code: 'max_scale' });
  });

  it('the UPDATE path refuses it as well — not just insert', async () => {
    // #65's lesson: a rule that holds on insert and does nothing on update
    // leaves exactly one reachable path to the broken state, and it is the
    // one a configurer actually uses when fixing a cadence.
    const created: any = await insertDuty({});
    const row = Array.isArray(created) ? created[0] : created;
    const { code, fields } = await refusal(
      data.update('duly_duty', { id: row.id, due_offset_days: 1.5 }),
    );
    expect(code).toBe('VALIDATION_FAILED');
    expect(fields[0]).toMatchObject({ field: 'due_offset_days', code: 'max_scale' });
  });
});

describe('an out-of-range cadence value is refused at write time', () => {
  it.each(CADENCE_FIELDS)('duly_duty.%s refuses max + 1', async (field) => {
    const { code, fields } = await refusal(insertDuty({ [field]: BOUNDS[field].max + 1 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(fields[0]).toMatchObject({ field, code: 'max_value', constraint: { max: BOUNDS[field].max } });
  });

  it.each(CADENCE_FIELDS)('duly_duty.%s refuses min - 1', async (field) => {
    const { code, fields } = await refusal(insertDuty({ [field]: BOUNDS[field].min - 1 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(fields[0]).toMatchObject({ field, code: 'min_value', constraint: { min: BOUNDS[field].min } });
  });

  it('9e9 — the card\'s own example — is refused here rather than deep in the engine', async () => {
    // Before this card it saved clean and failed at dispatch, as
    // "dueDate must be a YYYY-MM-DD calendar date, received 0NaN-NaN-NaN":
    // a message naming neither the field nor anything the author typed. (The
    // card predicted the MIN_YEAR/MAX_YEAR guard would catch it; measured, it
    // did not get that far — the civil arithmetic went to NaN first.)
    const { fields } = await refusal(insertDuty({ due_offset_days: 9e9 }));
    expect(fields[0]).toMatchObject({ field: 'due_offset_days', code: 'max_value' });
  });
});

describe('every value still admitted is one the product can carry out', () => {
  // A bound that refuses a legal value is as wrong as one that admits an
  // illegal one, so the corners are asserted to LAND, not just the middle.
  it.each([
    ['both extremes of the offset, with the maximum lead', { due_offset_days: -366, lead_days: 366 }],
    ['the other extreme', { due_offset_days: 366, lead_days: 0 }],
    ['the largest grace the sweep can honour', { grace_days: 30 }],
    ['zero everywhere', { due_offset_days: 0, lead_days: 0, grace_days: 0 }],
  ] as const)('accepts %s', async (_label, values) => {
    const created: any = await insertDuty(values);
    const row = Array.isArray(created) ? created[0] : created;
    for (const [k, v] of Object.entries(values)) expect(row[k]).toBe(v);
  });

  it('the period engine accepts every corner of the declared box', () => {
    // This is the half that makes the bounds a CONTRACT rather than a guess:
    // the declared box has to sit inside what `dispatch.plan.ts` can actually
    // compute, or the card's defect is merely moved rather than closed. Every
    // frequency, both anchors, both zones, offsets and leads at their
    // declared extremes — and not one `invalid_cadence` among them.
    const base: DispatchDuty = {
      id: 'd1', name: 'D', form: 'recurring', status: 'active', owner: 'u1',
      business_unit: null, source: 'self', frequency: 'monthly',
      due_anchor: 'period_start', due_offset_days: 0, lead_days: 7,
      timezone: 'UTC', effective_from: null, effective_to: null, last_dispatched_period: null,
    };
    const now = new Date('2026-08-15T10:00:00.000Z');
    const faults: string[] = [];
    for (const frequency of FREQUENCIES) {
      for (const due_anchor of ['period_start', 'period_end']) {
        for (const timezone of ['UTC', 'Europe/Berlin']) {
          for (const due_offset_days of [BOUNDS.due_offset_days.min, 0, BOUNDS.due_offset_days.max]) {
            for (const lead_days of [BOUNDS.lead_days.min, 7, BOUNDS.lead_days.max]) {
              const plan = planDispatch({
                duties: [{ ...base, frequency, due_anchor, timezone, due_offset_days, lead_days }],
                now,
              });
              for (const skip of plan.skipped) {
                if (skip.reason === 'invalid_cadence') {
                  faults.push(`${frequency}/${due_anchor}/${timezone}/${due_offset_days}/${lead_days}: ${skip.detail}`);
                }
              }
            }
          }
        }
      }
    }
    expect(faults).toEqual([]);
  });
});
