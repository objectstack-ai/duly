// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { Duty } from '../src/objects/index.js';

/**
 * #107 — confirmation and approval: the pipeline `duly_duty.review_status`
 * declares, and the three enforcements behind it.
 *
 * ── Why every assertion here goes through a booted engine ────────────────
 * All three mechanisms this card rests on are INVISIBLE to `pnpm validate`,
 * and each is invisible in a different way:
 *
 *  - The **conditional default** is a CEL expression. `field.zod.ts`'s
 *    authoring gate returns unconditionally on an expression envelope ("a CEL
 *    result type is unknowable at parse time"), so a structural pin
 *    (`Duty.fields.review_status.defaultValue === …`) proves the KEY exists
 *    and nothing about what it evaluates to. Same reasoning, same shape as
 *    `test/cadence-conditional-defaults.test.ts`.
 *  - The **state machine** is a `transitions` table the validator reads at
 *    write time with the prior row in hand. Nothing at author time compares it
 *    to the option list, so a table naming a state that does not exist — or
 *    omitting one that does — parses clean. (Omitting is the dangerous
 *    direction: measured on `@objectstack/objectql` 17.2.0, a state with NO
 *    row accepts every transition out of it, so a missing row reads like
 *    "locked" and behaves like "wide open".)
 *  - The **per-option `visibleWhen`** is the authorization half, and it is the
 *    one an author is most likely to mistake for decoration. It is not: the
 *    rule validator evaluates the PICKED option's predicate on every insert
 *    and update and refuses the write. The tests at the bottom drive it with
 *    three different callers, because a predicate that never refuses anybody
 *    is indistinguishable from no predicate at all.
 *
 * The dispatch half of #107 — an unapproved duty produces no tasks — lives in
 * `test/dispatch.test.ts`, next to the rest of the planner.
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
    // See dispatch.test.ts: left to its default this resolves
    // `<cwd>/dist/objectstack.json`, and a local `pnpm build` would make the
    // suite report on the last BUILD instead of on `src/`.
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

const OWNER = 'user_owner';
const REVIEWER = 'user_reviewer';

/**
 * A duty, inserted through the ordinary write path.
 *
 * No `skipStateMachine` and no `isSystem` anywhere in this file: the rules
 * under test are exactly the ones those keys turn off, so a fixture that used
 * either would be testing the escape hatch. Where an already-approved duty is
 * needed, it is WALKED there through the pipeline, one legal transition at a
 * time — which is also the shortest honest statement of what the pipeline is.
 */
const insertDuty = async (over: AnyRow = {}, options?: AnyRow): Promise<AnyRow> => {
  const created = await data.insert('duly_duty', {
    name: `Duty ${++seq}`,
    form: 'recurring',
    owner: OWNER,
    source: 'catalog',
    status: 'active',
    frequency: 'monthly',
    timezone: 'UTC',
    ...over,
  }, options);
  return (Array.isArray(created) ? created[0] : created) as AnyRow;
};

const readDuty = async (id: unknown): Promise<AnyRow> =>
  (await data.find('duly_duty', { where: { id }, limit: 1 }))[0] as AnyRow;

/** Move one duty one step, as `who` (a bare user id, or nobody at all). */
const advance = (id: unknown, to: string, over: AnyRow = {}, who?: string) =>
  data.update(
    'duly_duty',
    { id, review_status: to, ...over },
    who === undefined ? undefined : { context: { userId: who, positions: [] } },
  );

/** A duty walked all the way to `approved` by somebody who does not own it. */
const approvedDuty = async (over: AnyRow = {}): Promise<AnyRow> => {
  const duty = await insertDuty(over);
  await advance(duty.id, 'to_review', {}, OWNER);
  await advance(duty.id, 'approved', {}, REVIEWER);
  return await readDuty(duty.id);
};

// ───────────────────────────────────────────────────────────────────────────
// Where a duty enters the pipeline
// ───────────────────────────────────────────────────────────────────────────

describe('a new duty enters the pipeline where its SOURCE puts it', () => {
  it('an organisation-supplied duty waits for the owner to confirm it', async () => {
    // The import / catalog case, and the reason the card exists: a list the
    // organisation produced is visible immediately and productive only once
    // the person who owes it has said "yes, this is mine".
    for (const source of ['catalog', 'assigned']) {
      const duty = await insertDuty({ source });
      expect((await readDuty(duty.id)).review_status, source).toBe('to_confirm');
    }
  });

  it('a self-declared duty is already confirmed — writing it down IS the confirmation', async () => {
    const duty = await insertDuty({ source: 'self' });
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
  });

  it('the default is reached through `source`, not through the payload', async () => {
    // `source` itself defaults to `self` (#54), so a duty created with no
    // source at all is self-declared and lands in `to_review`. This is the
    // hand-created case, and it is the one that proves the default is being
    // EVALUATED rather than copied off a literal.
    const duty = await insertDuty({ source: undefined });
    const row = await readDuty(duty.id);
    expect(row.source).toBe('self');
    expect(row.review_status).toBe('to_review');
  });

  it('is required, so no duty can sit outside the pipeline', () => {
    expect(Duty.fields.review_status.required).toBe(true);
  });
});

describe('a duty cannot be BORN mid-pipeline', () => {
  it('refuses an insert that arrives already approved', async () => {
    // `transitions` governs updates only, and a `select` accepts any declared
    // option on create — so without `initialStates` the whole card could be
    // walked around by writing `approved` on the way in, which is exactly the
    // defect it exists to close ("imported lists take effect and dispatch
    // immediately").
    const { code, message } = await refusal(insertDuty({ review_status: 'approved' }));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toContain('not a step this review can take');
  });

  it('refuses an insert that arrives already returned', async () => {
    const { code } = await refusal(insertDuty({ review_status: 'returned', review_note: 'no' }));
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('admits the two states a duty may legitimately start in', async () => {
    for (const review_status of ['to_confirm', 'to_review']) {
      const duty = await insertDuty({ review_status });
      expect((await readDuty(duty.id)).review_status, review_status).toBe(review_status);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The transitions
// ───────────────────────────────────────────────────────────────────────────

describe('the pipeline admits exactly the steps it declares', () => {
  it('refuses to_confirm → approved — the card\'s own example', async () => {
    const duty = await insertDuty();
    const { code, message } = await refusal(advance(duty.id, 'approved', {}, REVIEWER));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toContain('not a step this review can take');
    // And the refused write left the row where it was.
    expect((await readDuty(duty.id)).review_status).toBe('to_confirm');
  });

  it('walks to_confirm → to_review → approved', async () => {
    const duty = await insertDuty();
    await advance(duty.id, 'to_review', {}, OWNER);
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
    await advance(duty.id, 'approved', {}, REVIEWER);
    expect((await readDuty(duty.id)).review_status).toBe('approved');
  });

  it('walks to_review → returned → to_review', async () => {
    const duty = await insertDuty({ source: 'self' });
    await advance(duty.id, 'returned', { review_note: 'Quarterly, not monthly.' }, REVIEWER);
    expect((await readDuty(duty.id)).review_status).toBe('returned');
    await advance(duty.id, 'to_review', {}, OWNER);
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
  });

  it('refuses returned → approved — a correction goes back through review', async () => {
    const duty = await insertDuty({ source: 'self' });
    await advance(duty.id, 'returned', { review_note: 'The owner is wrong.' }, REVIEWER);
    const { code } = await refusal(advance(duty.id, 'approved', {}, REVIEWER));
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('lets an approved duty be RETURNED — the correction path', async () => {
    // The one edge the card's table does not draw, added deliberately: with
    // `approved` terminal there is no way to correct a live duty at all, by
    // anyone. See the rule's comment in `duty.object.ts`.
    const duty = await approvedDuty();
    await advance(duty.id, 'returned', { review_note: 'Superseded by the group standard.' }, REVIEWER);
    expect((await readDuty(duty.id)).review_status).toBe('returned');
  });

  it('refuses approved → to_review — the way back is a return, with a reason', async () => {
    const duty = await approvedDuty();
    const { code } = await refusal(advance(duty.id, 'to_review', {}, REVIEWER));
    expect(code).toBe('VALIDATION_FAILED');
    expect((await readDuty(duty.id)).review_status).toBe('approved');
  });

  it('every state the field declares has a row in the table', () => {
    // The measured trapdoor: a state with no `transitions` row is not frozen,
    // it is UNGOVERNED — `if (!Array.isArray(allowed)) return null` lets every
    // transition out of it through. Nothing at author time compares the two
    // lists, so this is the comparison.
    const rule = (Duty.validations ?? []).find((v: any) => v.name === 'review_status_transitions') as any;
    const declared = (Duty.fields.review_status.options ?? []).map((option: any) => String(option.value));
    expect(Object.keys(rule.transitions).sort()).toEqual([...declared].sort());
    // And every TARGET is a real state too — a typo'd target is a step nobody
    // can ever take, which reads as "the pipeline is stuck" at run time.
    for (const [from, targets] of Object.entries(rule.transitions as Record<string, string[]>)) {
      for (const target of targets) expect(declared, `${from} → ${target}`).toContain(target);
    }
  });
});

// ───────────────────────────────────────────────────────────────────────────
// The reason a return carries
// ───────────────────────────────────────────────────────────────────────────

describe('returning a duty says why', () => {
  it('refuses a return with no reason', async () => {
    const duty = await insertDuty({ source: 'self' });
    const { code, message } = await refusal(advance(duty.id, 'returned', {}, REVIEWER));
    expect(code).toBe('VALIDATION_FAILED');
    expect(message).toBe('Say why the duty is being returned — the owner needs something to act on.');
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
  });

  it('refuses blanking the reason while the duty is still returned', async () => {
    // The rule reads the MERGED record, so an update carrying only
    // `review_note: null` is judged against the stored `returned` — which is
    // what stops a return from being emptied out after the fact.
    const duty = await insertDuty({ source: 'self' });
    await advance(duty.id, 'returned', { review_note: 'The frequency is wrong.' }, REVIEWER);
    const { code } = await refusal(data.update('duly_duty', { id: duty.id, review_note: null }));
    expect(code).toBe('VALIDATION_FAILED');
    expect((await readDuty(duty.id)).review_note).toBe('The frequency is wrong.');
  });

  it('keeps the last reason on the record after it goes back for review', async () => {
    // Deliberately NOT cleared: the owner is correcting the duty while
    // reading it, and a reason that vanishes the moment they act on it is a
    // reason they cannot re-read.
    const duty = await insertDuty({ source: 'self' });
    await advance(duty.id, 'returned', { review_note: 'Wrong owner — this is the Lab 2 duty.' }, REVIEWER);
    await advance(duty.id, 'to_review', {}, OWNER);
    const row = await readDuty(duty.id);
    expect(row.review_status).toBe('to_review');
    expect(row.review_note).toBe('Wrong owner — this is the Lab 2 duty.');
  });
});

// ───────────────────────────────────────────────────────────────────────────
// Who may issue a verdict
// ───────────────────────────────────────────────────────────────────────────

describe('a review is not something you issue on your own list', () => {
  it('refuses the OWNER approving their own duty', async () => {
    // The per-option `visibleWhen` doing the job the spec says it must do:
    // "Client-side hiding is UX, not authorization … the server MUST also
    // reject writes of its value". This is that rejection, server-side, with
    // no hook anywhere in the path.
    const duty = await insertDuty();
    await advance(duty.id, 'to_review', {}, OWNER);
    const { code, message } = await refusal(advance(duty.id, 'approved', {}, OWNER));
    expect(code).toBe('VALIDATION_FAILED');
    // The platform's own `option_unavailable` catalog entry, naming the field
    // by its LABEL. Pinned rather than shrugged at, because this string is
    // what the reviewer actually reads, and because it comes from the
    // catalog the platform already ships translated — an authored rule
    // message would not have (`object.validations[].message` has no bundle
    // key at all; see `src/translations/authored-text.ts`).
    expect(message).toBe("Review status: option 'approved' is not available");
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
  });

  it('refuses the OWNER returning their own duty', async () => {
    const duty = await insertDuty();
    await advance(duty.id, 'to_review', {}, OWNER);
    const { code } = await refusal(
      advance(duty.id, 'returned', { review_note: 'I disagree with myself.' }, OWNER),
    );
    expect(code).toBe('VALIDATION_FAILED');
  });

  it('admits anybody else — WHO that is, is the permission set\'s question', async () => {
    // The option predicate answers "may this value be written by this
    // caller", not "may this caller write this record at all". The second
    // question is `writeScope`'s, one layer up, and keeping them apart is why
    // this predicate names the record relationship rather than a position.
    const duty = await insertDuty();
    await advance(duty.id, 'to_review', {}, OWNER);
    await advance(duty.id, 'approved', {}, REVIEWER);
    expect((await readDuty(duty.id)).review_status).toBe('approved');
  });

  it('lets the owner move their OWN duty into review — confirming is theirs to do', async () => {
    const duty = await insertDuty();
    await advance(duty.id, 'to_review', {}, OWNER);
    expect((await readDuty(duty.id)).review_status).toBe('to_review');
  });

  it('admits a write with no acting user at all, and that is the seed path', async () => {
    // Measured and deliberately pinned, because it is the half that surprises
    // people: with no user in the context the predicate cannot bind
    // `current_user`, the evaluation FAILS rather than returning false, and
    // the platform logs `option visibleWhen … failed to evaluate — allowed
    // through` and admits the write. That is what lets the demo seed carry
    // approved rows and what keeps in-process jobs working — and it is why
    // this predicate is a rule about people, not a containment boundary for
    // server code. If this ever starts refusing, the seed goes with it.
    const duty = await insertDuty();
    await advance(duty.id, 'to_review');
    await advance(duty.id, 'approved');
    expect((await readDuty(duty.id)).review_status).toBe('approved');
  });

  it('gates the two VERDICTS and nothing else', () => {
    // A predicate on `to_confirm` or `to_review` would put the owner's own
    // confirmation behind an authorization test, which is not what any of
    // this is for.
    const gated = (Duty.fields.review_status.options ?? [])
      .filter((option: any) => option.visibleWhen !== undefined)
      .map((option: any) => String(option.value))
      .sort();
    expect(gated).toEqual(['approved', 'returned']);
  });
});
