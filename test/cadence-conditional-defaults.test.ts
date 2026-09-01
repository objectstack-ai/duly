// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { DEFAULT_DUE_ANCHOR, DEFAULT_DUE_OFFSET_DAYS, DEFAULT_LEAD_DAYS } from '../src/jobs/dispatch.plan.js';

/**
 * #61 — "Standing / Monthly" reads as if a standing duty dispatches.
 *
 * `frequency`, `due_anchor`, `due_offset_days`, `lead_days` and `grace_days`
 * are declared with CONDITIONAL defaults on both `duly_duty` and
 * `duly_catalog_item` (`duty.object.ts` / `catalog-item.object.ts`), plus
 * validation rules that refuse the meaningless combinations outright — B
 * (hide it in the UI) was rejected in the issue precisely because it leaves
 * the wrong value IN THE DATA, so this suite proves the DATA, never the
 * rendering.
 *
 * ── Why this runs against a REAL booted engine, not a schema-structural pin
 * A conditional default here is a CEL `defaultValue` (the blessed
 * null-guard idiom `cond ? value : null`, objectstack#3306 — the same
 * evaluator `Field.formula` uses). `pnpm validate` does not check a CEL
 * `defaultValue`'s syntax OR behaviour at all: `field.zod.ts`'s authoring
 * gate discriminates the shape and, for an expression envelope, returns
 * unconditionally (`shape === 'expression' → return` — "a CEL result type is
 * unknowable at parse time"). So a schema-structural assertion
 * (`Duty.fields.x.defaultValue === literal`) would prove only that the KEY
 * is present, never that the expression evaluates to the right thing for the
 * right form. The only thing that proves that is inserting a row and
 * reading it back — which is what every test below does.
 *
 * `test/dispatch.test.ts`'s "the cadence fallbacks are the object schema"
 * block used to pin `due_anchor` / `due_offset_days` / `lead_days`
 * structurally; that pin is superseded by the "still a recurring duty"
 * tests here, which check the SAME constants against real inserted rows.
 */

type AnyRow = Record<string, unknown>;

let kernel: { getService(name: string): unknown; shutdown?(): Promise<void> } | undefined;
let data: {
  find(o: string, q?: AnyRow, x?: AnyRow): Promise<AnyRow[]>;
  insert(o: string, d: AnyRow, x?: AnyRow): Promise<AnyRow>;
  update(o: string, d: AnyRow, x?: AnyRow): Promise<unknown>;
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // See task-hook.test.ts / dispatch.test.ts for why this must not resolve
    // to a real path: a local `pnpm build` would make the suite report on the
    // last BUILD instead of on `src/`.
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

/** Assert a refusal by its ENVELOPE (ADR-0112), never by the bare fact that it threw. */
async function refusal(promise: Promise<unknown>): Promise<{ code: unknown; message: string }> {
  try {
    await promise;
  } catch (error: any) {
    return { code: error?.code, message: String(error?.message ?? '') };
  }
  throw new Error('expected the write to be refused, but it resolved');
}

let seq = 0;

const insertDuty = async (over: AnyRow): Promise<AnyRow> => {
  const created = await data.insert('duly_duty', {
    name: `Duty ${++seq}`,
    owner: `user_${seq}`,
    source: 'self',
    status: 'active',
    ...over,
  });
  return Array.isArray(created) ? created[0] : created;
};

const insertCatalogItem = async (over: AnyRow): Promise<AnyRow> => {
  const created = await data.insert('duly_catalog_item', {
    name: `Item ${++seq}`,
    position_code: 'test_position',
    ...over,
  });
  return Array.isArray(created) ? created[0] : created;
};

const readDuty = async (id: string): Promise<AnyRow> =>
  (await data.find('duly_duty', { where: { id }, limit: 1 }))[0] as AnyRow;

const CADENCE_MESSAGES = {
  frequency: 'A standing duty never dispatches — a frequency on it is meaningless. Remove it.',
  timing:
    'Due anchor, due offset and lead time compute a period due date — only a recurring duty has one. Clear them for standing and one-off.',
  grace: "Grace days measures lateness against a task's due date — a standing duty never has a task, so it never has one.",
} as const;

// ─────────────────────────────────────────────────────────────────────────
// duly_duty
// ─────────────────────────────────────────────────────────────────────────

describe('duly_duty — conditional cadence defaults (#61)', () => {
  it('a standing duty is inserted with no cadence field stamped at all', async () => {
    const row = await insertDuty({ form: 'standing' });
    for (const field of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
      expect(row[field] ?? null, field).toBeNull();
    }
  });

  it('a recurring duty is still stamped with every cadence default, unchanged', async () => {
    const row = await insertDuty({ form: 'recurring' });
    expect(row.frequency).toBe('monthly');
    expect(row.due_anchor).toBe(DEFAULT_DUE_ANCHOR);
    expect(row.due_offset_days).toBe(DEFAULT_DUE_OFFSET_DAYS);
    expect(row.lead_days).toBe(DEFAULT_LEAD_DAYS);
    expect(row.grace_days).toBe(0);
  });

  it('a one-off duty loses the period-timing fields but keeps frequency and grace_days defaults', async () => {
    // Deliberately NOT the same as standing (see the cadence block comment in
    // duty.object.ts): a one-off's due date is real, just not computed from a
    // period anchor, so `frequency` (out of THIS issue's adjudicated scope)
    // and `grace_days` (which measures lateness against that real due date)
    // are left alone.
    const row = await insertDuty({ form: 'one_off' });
    expect(row.due_anchor ?? null).toBeNull();
    expect(row.due_offset_days ?? null).toBeNull();
    expect(row.lead_days ?? null).toBeNull();
    expect(row.frequency).toBe('monthly');
    expect(row.grace_days).toBe(0);
  });

  it('a standing duty with every cadence field simply omitted is valid', async () => {
    await expect(insertDuty({ form: 'standing' })).resolves.toBeTruthy();
  });
});

describe('duly_duty — the new validations (#61)', () => {
  it('refuses a frequency on a standing duty', async () => {
    const { code, message } = await refusal(insertDuty({ form: 'standing', frequency: 'monthly' }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe(CADENCE_MESSAGES.frequency);
  });

  it.each(['due_anchor', 'due_offset_days', 'lead_days'] as const)(
    'refuses %s on a standing duty',
    async (field) => {
      const value = field === 'due_anchor' ? 'period_start' : 3;
      const { code, message } = await refusal(insertDuty({ form: 'standing', [field]: value }));
      expect(code).toBe('VALIDATION_FAILED');
      expect(message).toBe(CADENCE_MESSAGES.timing);
    },
  );

  it.each(['due_anchor', 'due_offset_days', 'lead_days'] as const)(
    'refuses %s on a one-off duty too — it has no period to anchor into either',
    async (field) => {
      const value = field === 'due_anchor' ? 'period_end' : 2;
      const { code, message } = await refusal(insertDuty({ form: 'one_off', [field]: value }));
      expect(code).toBe('VALIDATION_FAILED');
      expect(message).toBe(CADENCE_MESSAGES.timing);
    },
  );

  it('refuses grace_days on a standing duty', async () => {
    const { code, message } = await refusal(insertDuty({ form: 'standing', grace_days: 3 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe(CADENCE_MESSAGES.grace);
  });

  it('allows grace_days on a one-off duty — its task has a real due date to be late against', async () => {
    const row = await insertDuty({ form: 'one_off', grace_days: 3 });
    expect(row.grace_days).toBe(3);
  });

  it('allows a recurring duty to state its own cadence explicitly', async () => {
    const row = await insertDuty({
      form: 'recurring',
      frequency: 'quarterly',
      due_anchor: 'period_end',
      due_offset_days: -3,
      lead_days: 14,
      grace_days: 2,
    });
    expect(row.frequency).toBe('quarterly');
    expect(row.due_anchor).toBe('period_end');
    expect(row.due_offset_days).toBe(-3);
    expect(row.lead_days).toBe(14);
    expect(row.grace_days).toBe(2);
  });
});

describe('negative control — recurring_needs_frequency must still fire (#61 must not go vacuous)', () => {
  it('an update that blanks frequency on a still-recurring duty is refused', async () => {
    const created = await insertDuty({ form: 'recurring' });
    const { code, message } = await refusal(data.update('duly_duty', { id: created.id, frequency: null }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe('A recurring duty needs a frequency — otherwise nothing can dispatch it.');
    // And the row itself must be untouched by the refused write.
    expect((await readDuty(String(created.id))).frequency).toBe('monthly');
  });

  it('standing_no_frequency does not fire for a recurring duty, and vice versa', async () => {
    // Both rules read `record.form`, on opposite literals — a rule that
    // accidentally matched the other form's condition would either block
    // every recurring duty or admit every standing one.
    await expect(insertDuty({ form: 'recurring', frequency: 'weekly' })).resolves.toBeTruthy();
    await expect(insertDuty({ form: 'standing' })).resolves.toBeTruthy();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// duly_catalog_item — the same fix, mirrored (#61: #5's instantiation copies
// these fields verbatim onto every duty made from a catalog item)
// ─────────────────────────────────────────────────────────────────────────

describe('duly_catalog_item — mirrors duly_duty field-for-field (#61)', () => {
  it('a standing catalog item is inserted with no cadence field stamped at all', async () => {
    const row = await insertCatalogItem({ form: 'standing' });
    for (const field of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
      expect(row[field] ?? null, field).toBeNull();
    }
  });

  it('a recurring catalog item is still stamped with every cadence default', async () => {
    const row = await insertCatalogItem({ form: 'recurring' });
    expect(row.frequency).toBe('monthly');
    expect(row.due_anchor).toBe(DEFAULT_DUE_ANCHOR);
    expect(row.due_offset_days).toBe(DEFAULT_DUE_OFFSET_DAYS);
    expect(row.lead_days).toBe(DEFAULT_LEAD_DAYS);
    expect(row.grace_days).toBe(0);
  });

  it('a one-off catalog item keeps frequency and grace_days but loses the timing fields', async () => {
    const row = await insertCatalogItem({ form: 'one_off' });
    expect(row.due_anchor ?? null).toBeNull();
    expect(row.due_offset_days ?? null).toBeNull();
    expect(row.lead_days ?? null).toBeNull();
    expect(row.frequency).toBe('monthly');
    expect(row.grace_days).toBe(0);
  });

  it('refuses a frequency on a standing catalog item', async () => {
    const { code, message } = await refusal(insertCatalogItem({ form: 'standing', frequency: 'monthly' }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe(CADENCE_MESSAGES.frequency);
  });

  it('refuses due timing on a standing catalog item', async () => {
    const { code, message } = await refusal(insertCatalogItem({ form: 'standing', due_offset_days: 1 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe(CADENCE_MESSAGES.timing);
  });

  it('refuses grace_days on a standing catalog item', async () => {
    const { code, message } = await refusal(insertCatalogItem({ form: 'standing', grace_days: 1 }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe(CADENCE_MESSAGES.grace);
  });
});

describe('#5 instantiation: a blank catalog-side cadence stays blank on the duty it produces', () => {
  it('copying a standing catalog item verbatim onto a duty still yields no cadence fields', async () => {
    // `applyCatalogHandler` (catalog.handlers.ts) copies frequency/due_anchor/
    // due_offset_days/lead_days/grace_days from the catalog item onto the
    // new duty VERBATIM — reproduced here with a direct insert rather than
    // driving the handler, so this stays a fixture-free proof that the two
    // objects' conditional defaults agree once the values in transit are
    // null, which is what the handler will actually be carrying now that the
    // catalog item itself is never allowed to hold them for a standing row.
    const item = await insertCatalogItem({ form: 'standing' });
    const duty = await insertDuty({
      form: item.form,
      frequency: item.frequency ?? null,
      due_anchor: item.due_anchor ?? null,
      due_offset_days: item.due_offset_days ?? null,
      lead_days: item.lead_days ?? null,
      grace_days: item.grace_days ?? null,
      source: 'catalog',
      catalog_item: String(item.id),
    });
    for (const field of ['frequency', 'due_anchor', 'due_offset_days', 'lead_days', 'grace_days']) {
      expect(duty[field] ?? null, field).toBeNull();
    }
  });
});
