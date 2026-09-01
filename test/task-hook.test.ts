// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { dulyHooks } from '../src/hooks/index.js';
import { planDispatch } from '../src/jobs/dispatch.plan.js';

/**
 * `duly_task` lifecycle stamps.
 *
 * These run against a REAL booted ObjectQL engine (in-memory driver) with the
 * app's own `objectstack.config.ts` as the bundle, rather than against a
 * hand-made hook context. That matters for two reasons:
 *
 *  - The hook only counts if it is reachable from `defineStack({ hooks })`. A
 *    `*.hook.ts` missing from the barrel type-checks and reads as wired, so a
 *    test that imported the handler directly would pass on dead metadata. Here
 *    the handler runs only because `AppPlugin` found it in the real config.
 *  - The interesting behaviour is not the handler in isolation, it is the
 *    handler's PLACE in the write pipeline: ahead of the validation rules,
 *    behind the pre-image read, and ahead of the readonly strip.
 *
 * Timestamps are ISO-8601, so lexical `>` is chronological. Each write that
 * should move the clock is preceded by a short sleep, which is what makes the
 * "does NOT advance" assertions mean something: without it an errant stamp
 * could land in the same millisecond and compare equal.
 */

let data: any;
let kernel: any;

const tick = () => new Promise((resolve) => setTimeout(resolve, 5));

const newTask = async (over: Record<string, unknown> = {}) =>
  data.insert('duly_task', {
    subject: 'Return the safety inspection',
    owner: 'user_alice',
    source: 'catalog',
    status: 'open',
    ...over,
  });

const read = async (id: string) => data.findOne('duly_task', { where: { id } });

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Point the artifact lookup at a path that cannot exist. Left to its
    // default it resolves `<cwd>/dist/objectstack.json`, and when a local
    // `pnpm build` has left one there the kernel loads its metadata — objects
    // AND hooks — from that file instead of from the config imported above.
    // The suite then reports on the last BUILD rather than on `src/`, passes
    // with the barrel entry deleted, and behaves differently in CI (where
    // `pnpm test` runs before `pnpm build` and no artifact exists) than it does
    // on a developer's machine. Measured, not hypothetical: it is what made the
    // registration ablation come back green.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
}, 120_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── The wiring, which is the failure mode that reads as success ────────────
describe('registration', () => {
  it('is exported from the hooks barrel', () => {
    const hook = dulyHooks.find((h) => h.name === 'duly_task_lifecycle_stamps');
    expect(hook, 'the hook must be in dulyHooks or it never runs').toBeDefined();
    expect(hook?.object).toBe('duly_task');
    expect(hook?.events).toEqual(['beforeInsert', 'beforeUpdate']);
  });

  it('reaches defineStack({ hooks }) — the only place the runtime reads', () => {
    const names = (stack.hooks ?? []).map((h: any) => h.name);
    expect(names).toContain('duly_task_lifecycle_stamps');
  });
});

// ── The pipeline facts the design depends on ───────────────────────────────
describe('platform mechanics this hook relies on', () => {
  it('hands beforeUpdate the pre-image, so a TRANSITION is detectable', async () => {
    const seen: Array<Record<string, unknown> | undefined> = [];
    data.registerHook(
      'beforeUpdate',
      (ctx: any) => { seen.push(ctx.previous); },
      { object: 'duly_task', hookName: 'test_previous_probe' },
    );

    const task = await newTask({ status: 'in_progress' });
    await data.update('duly_task', { id: task.id, note: 'probing' });

    expect(seen.length).toBe(1);
    expect(seen[0], 'ctx.previous must be bound on beforeUpdate').toBeDefined();
    expect(seen[0]?.status).toBe('in_progress');
    expect(seen[0]?.id).toBe(task.id);
  });

  it('enforces completed_at_required_when_done — the hook is not trusted, it is checked', async () => {
    // The negative control for every "done" assertion below. beforeInsert
    // deliberately does not stamp completed_at, so an insert that asks for
    // `done` is refused. If this ever stops throwing, the validation rule has
    // gone quiet and the completion assertions prove nothing.
    await expect(newTask({ status: 'done' })).rejects.toThrow(
      /completion timestamp/i,
    );
  });
});

describe('completed_at', () => {
  it('is left blank on insert, and last_update_at is stamped', async () => {
    const task = await newTask();
    expect(task.last_update_at, 'a new task has just been touched').toBeTruthy();
    expect(task.completed_at ?? null).toBeNull();
  });

  it('a write carrying ONLY { status: done } commits, with completed_at set', async () => {
    // The stamp lands ahead of the validation rules, which is the whole reason
    // a bare completion does not have to carry a timestamp of its own.
    const task = await newTask();
    const done = await data.update('duly_task', { id: task.id, status: 'done' });

    expect(done.status).toBe('done');
    expect(done.completed_at, 'completed_at must be stamped by the hook').toBeTruthy();
    expect(new Date(done.completed_at as string).getTime()).not.toBeNaN();
  });

  it('reopening clears it, and the reopened record passes validation', async () => {
    const task = await newTask();
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_at).toBeTruthy();

    const reopened = await data.update('duly_task', {
      id: task.id,
      status: 'in_progress',
    });
    expect(reopened.status).toBe('in_progress');
    expect(reopened.completed_at ?? null, 'a reopened task is not completed').toBeNull();

    // And it is genuinely persisted, not just echoed back by the write.
    expect((await read(task.id)).completed_at ?? null).toBeNull();
  });

  it('is not re-stamped when an already-done task is saved again', async () => {
    // Every whole-record form submit re-sends `status: 'done'`. That is a state,
    // not a transition, and overwriting the original completion instant on each
    // save would corrupt the one timestamp completion reporting reads.
    const task = await newTask();
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    const firstCompletion = done.completed_at;

    await tick();
    const resaved = await data.update('duly_task', {
      id: task.id,
      status: 'done',
      note: 'adding a note after the fact',
    });

    expect(resaved.completed_at).toBe(firstCompletion);
  });

  it('strips and replaces a caller-supplied value', async () => {
    const task = await newTask();
    const forged = '1999-01-01T00:00:00.000Z';
    const done = await data.update('duly_task', {
      id: task.id,
      status: 'done',
      completed_at: forged,
    });

    expect(done.completed_at, 'the caller does not get to choose this').not.toBe(forged);
    expect(new Date(done.completed_at as string).getTime()).toBeGreaterThan(
      new Date(forged).getTime(),
    );
  });

  it('drops a caller-supplied value on a write the hook does not stamp', async () => {
    // No transition here, so the hook writes nothing and the readonly strip is
    // the only thing standing between the caller and the column.
    const task = await newTask();
    const before = (await read(task.id)).completed_at ?? null;

    await data.update('duly_task', {
      id: task.id,
      completed_at: '1999-01-01T00:00:00.000Z',
    });

    expect((await read(task.id)).completed_at ?? null).toBe(before);
  });
});

describe('last_update_at — the stagnation signal', () => {
  it('advances when the note is edited', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const edited = await data.update('duly_task', { id: task.id, note: 'chased the vendor' });

    expect(edited.last_update_at as string > before).toBe(true);
  });

  it('advances on a status change', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const moved = await data.update('duly_task', { id: task.id, status: 'in_progress' });

    expect(moved.last_update_at as string > before).toBe(true);
  });

  it('advances when a skip reason is recorded', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const skipped = await data.update('duly_task', {
      id: task.id,
      status: 'skipped',
      skip_reason: 'the plant was down, there was nothing to return',
    });

    expect(skipped.last_update_at as string > before).toBe(true);
  });

  /**
   * THE assertion this hook exists for.
   *
   * `last_update_at` feeds the "Not moving" view — `status in (open,
   * in_progress) AND last_update_at < {14_days_ago}`. A hook that stamped on
   * every update would let one bulk re-owner, a business-unit backfill or an
   * import silently reset the clock across the whole table. Nothing would
   * error; the stagnation numbers would simply improve and the signal would go
   * quiet exactly when it matters. So an administrative write must leave the
   * clock alone, and that is checked here directly rather than inferred.
   */
  it('does NOT advance on an administrative write (business_unit)', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const rebadged = await data.update('duly_task', {
      id: task.id,
      business_unit: 'bu_north',
    });

    expect(rebadged.business_unit).toBe('bu_north');
    expect(
      rebadged.last_update_at,
      'a business-unit backfill is not progress on the task',
    ).toBe(before);
  });

  it('does NOT advance on a re-owner', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const reowned = await data.update('duly_task', { id: task.id, owner: 'user_bob' });

    expect(reowned.owner).toBe('user_bob');
    expect(reowned.last_update_at).toBe(before);
  });

  it('does NOT advance on a re-date', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;

    await tick();
    const redated = await data.update('duly_task', { id: task.id, due_date: '2026-12-31' });

    expect(redated.last_update_at).toBe(before);
  });

  it('does NOT advance on a re-save with no changes', async () => {
    const task = await newTask({ note: 'as found' });
    const before = task.last_update_at as string;

    await tick();
    const resaved = await data.update('duly_task', {
      id: task.id,
      status: 'open',
      note: 'as found',
    });

    expect(
      resaved.last_update_at,
      're-sending unchanged values is not a touch',
    ).toBe(before);
  });

  it('does NOT accept a caller-supplied value', async () => {
    const task = await newTask();
    const before = task.last_update_at as string;
    const forged = '2099-01-01T00:00:00.000Z';

    await tick();
    await data.update('duly_task', { id: task.id, last_update_at: forged });

    expect((await read(task.id)).last_update_at).toBe(before);
  });

  it('is stamped by the hook, not copied from the caller, on a real edit', async () => {
    const task = await newTask();
    const forged = '2099-01-01T00:00:00.000Z';

    await tick();
    const edited = await data.update('duly_task', {
      id: task.id,
      note: 'a real edit',
      last_update_at: forged,
    });

    expect(edited.last_update_at).not.toBe(forged);
    expect(edited.last_update_at as string < forged).toBe(true);
  });
});

// ── The shared-payload path: a predicate (bulk) write ──────────────────────
//
// A `multi: true` update carries ONE payload for all N matched rows —
// `driver.updateMany` takes a single SET clause — and ADR-0058 Addendum II D3
// says what that means for a hook: every per-row `beforeUpdate` context
// carries THAT payload, so "a rewrite takes effect on the WHOLE batch,
// whichever row's dispatch made it". D3 names the consequence outright: a
// rewrite CONDITIONED on the row is *expressible and wrong*, and the sanctioned
// route for row-specific work in a `before*` hook is to THROW.
//
// `completed_at` is exactly such a rewrite — it is stamped on the TRANSITION,
// read off this row's own pre-image. So on this path the hook refuses instead
// of stamping. These assertions run against the real engine, and the dispatch
// mode they turn on is the engine's own (`ctx.dispatch.mode`), measured here
// rather than inferred.
describe('completed_at on a predicate write — one payload, N rows', () => {
  /** Assert a refusal by its ENVELOPE (ADR-0112), never by the bare fact that it threw. */
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error: any) {
      return { code: error?.code, status: error?.status, message: String(error?.message ?? '') };
    }
    throw new Error('expected the predicate write to be refused, but it resolved');
  };

  const complete = async (id: string) => data.update('duly_task', { id, status: 'done' });

  it('refuses a done batch that contains an already-done row, and does not move its clock', async () => {
    // THE assertion this guard exists for. Without it the open row's dispatch
    // stamps `completed_at = now` into the shared payload and the already-done
    // row — completed days ago — is silently re-dated.
    const open = (await newTask({ subject: 'still open' })).id;
    const alreadyDone = (await newTask({ subject: 'done last week' })).id;
    await complete(alreadyDone);
    const original = (await read(alreadyDone)).completed_at;
    expect(original).toBeTruthy();

    await tick();
    const { code, status, message } = await refusal(
      data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: [open, alreadyDone] } } }),
    );

    expect(code).toBe('DULY_TASK_BULK_ALREADY_DONE');
    expect(status).toBe(409);
    expect(message, 'the refusal must name the row a caller has to remove').toContain(alreadyDone);

    expect(
      (await read(alreadyDone)).completed_at,
      'the original completion instant must survive the refused batch',
    ).toBe(original);
  });

  it('writes nothing at all — the refusal is not a partial batch', async () => {
    const open = (await newTask({ subject: 'untouched by a refused batch' })).id;
    const alreadyDone = (await newTask({ subject: 'already done' })).id;
    await complete(alreadyDone);

    await refusal(
      data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: [open, alreadyDone] } } }),
    );

    expect((await read(open)).status, 'the transitioning row must not commit either').toBe('open');
    expect((await read(open)).completed_at ?? null).toBeNull();
  });

  it('refuses whichever dispatch order the batch arrives in', async () => {
    // The guard is decided from the ROW alone — its own pre-image and the
    // payload — never from what an earlier dispatch happened to leave behind.
    // An accumulator would only catch the order in which the done row is
    // dispatched second.
    for (const doneFirst of [true, false]) {
      const openRow = (await newTask({ subject: `order open ${doneFirst}` })).id;
      const doneRow = (await newTask({ subject: `order done ${doneFirst}` })).id;
      await complete(doneRow);
      const original = (await read(doneRow)).completed_at;
      await tick();

      const ids = doneFirst ? [doneRow, openRow] : [openRow, doneRow];
      const { code } = await refusal(
        data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: ids } } }),
      );

      expect(code, `done-first=${doneFirst} must refuse`).toBe('DULY_TASK_BULK_ALREADY_DONE');
      expect((await read(doneRow)).completed_at).toBe(original);
    }
  });

  it('still completes a homogeneous batch — every row stamped, in one write', async () => {
    // The negative control. The guard must refuse the mixed batch WITHOUT
    // taking bulk complete away: a week of ticks in one gesture is the feature.
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await newTask({ subject: `homogeneous ${i}` })).id);

    const affected = await data.update('duly_task', { status: 'done' }, {
      multi: true,
      where: { id: { $in: ids } },
    });
    expect(affected).toBe(5);

    for (const id of ids) {
      const row = await read(id);
      expect(row.status).toBe('done');
      expect(row.completed_at, `${id} must be stamped like any other write`).toBeTruthy();
    }
  });

  it('leaves an administrative predicate write alone — the guard turns on the STATUS in the payload', async () => {
    // The over-refusal control, and the one that keeps the seed's second pass
    // working: a bulk write that does not carry `status` computes no stamp, so
    // there is nothing to leak and nothing to refuse — even over a done row.
    const alreadyDone = (await newTask({ subject: 'admin backfill target' })).id;
    await complete(alreadyDone);
    const original = (await read(alreadyDone)).completed_at;
    await tick();

    await data.update('duly_task', { business_unit: 'bu_north' }, {
      multi: true,
      where: { id: { $in: [alreadyDone] } },
    });

    const row = await read(alreadyDone);
    expect(row.business_unit, 'a backfill must still land').toBe('bu_north');
    expect(row.completed_at, 'and must not disturb the completion instant').toBe(original);
  });

  it('does not fire on the single-record path — a re-save of a done task is still a no-op', async () => {
    // `mode: 'record'` has a payload of its own, so the row-conditional stamp
    // is sound there. Re-sending `status: 'done'` on a done task must keep
    // behaving as it always has: accepted, and NOT re-stamped.
    const task = await newTask();
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    const first = done.completed_at;

    await tick();
    const resaved = await data.update('duly_task', { id: task.id, status: 'done', note: 'after the fact' });

    expect(resaved.completed_at, 'the by-id path is unchanged by the bulk guard').toBe(first);
  });

  it('a predicate write clearing done is NOT refused — that direction is row-invariant', async () => {
    // Reopening a batch sets `completed_at = null`, and null is the correct
    // value for EVERY row being moved out of done, including one that was
    // never completed. Nothing row-specific leaks, so nothing is refused.
    const wasDone = (await newTask({ subject: 'reopen me' })).id;
    const neverDone = (await newTask({ subject: 'never completed' })).id;
    await complete(wasDone);

    const affected = await data.update('duly_task', { status: 'in_progress' }, {
      multi: true,
      where: { id: { $in: [wasDone, neverDone] } },
    });
    expect(affected).toBe(2);

    for (const id of [wasDone, neverDone]) {
      const row = await read(id);
      expect(row.status).toBe('in_progress');
      expect(row.completed_at ?? null, `${id} must come out of done with no completion`).toBeNull();
    }
  });
});

// ── The shared-payload path again: last_update_at ──────────────────────────
//
// Same mechanism as the `completed_at` block above, opposite response.
//
// The stamp is row-conditional in the other direction: it fires when THIS
// row's `status`, `note` or `skip_reason` differs from THIS row's pre-image.
// Under D3 that value lands in the one shared payload and is written to every
// matched row, so a single genuine edit inside a 200-row batch refreshes all
// 200 clocks. Unlike `completed_at`, there is nothing to corrupt — the clock
// only moves forward, and nothing historical is overwritten — so refusing the
// write would cost a feature to protect a value that, on this path, nothing
// reads. The hook writes nothing instead.
//
// Why writing nothing is SAFE and not merely convenient: stagnation is defined
// over open work (`duly_stagnation` and the "Not moving" lens both filter
// `status IN ('open','in_progress')`), and both bulk actions this product
// ships move every row they touch OUT of that set. An unrefreshed clock on a
// done or skipped row is a value nothing will ever evaluate again.
//
// That premise is a fact about `bulkActionDefs`, not about this hook, so it is
// guarded where it can go stale: `test/bulk-stagnation-premise.test.ts` fails
// if a bulk action is ever added whose patch leaves rows inside the stagnation
// set.
describe('last_update_at on a predicate write — one payload, N rows', () => {
  const SHARED_NOTE = 'chased the vendor, all of them';

  it('does NOT advance the clock of a row that changed nothing', async () => {
    // THE assertion. A batch of exactly the shape the defect was measured on:
    // row A genuinely changes its note, row B already holds that same note.
    // Row B's `status`, `note` and `skip_reason` are all unchanged, so nothing
    // about row B is progress — but row A's dispatch used to write the stamp
    // into the shared payload and row B's clock moved with it.
    const changing = (await newTask({ subject: 'row A — the genuine edit', note: 'as found' })).id;
    const unchanged = (await newTask({ subject: 'row B — already holds it', note: SHARED_NOTE })).id;
    const before = (await read(unchanged)).last_update_at as string;

    await tick();
    const affected = await data.update('duly_task', { note: SHARED_NOTE }, {
      multi: true,
      where: { id: { $in: [changing, unchanged] } },
    });
    expect(affected).toBe(2);

    const rowB = await read(unchanged);
    expect(rowB.note, 'the batch must still land — this is not a refusal').toBe(SHARED_NOTE);
    expect(
      rowB.last_update_at,
      "row A's edit must not quiet row B's stagnation clock",
    ).toBe(before);
  });

  it('does not advance the clock of the row that DID change either', async () => {
    // The honest statement of the decision, pinned so a later "restore it just
    // for the row that changed" cannot land quietly: there is no such thing on
    // this path. One payload, N rows — a stamp aimed at the changing row IS
    // the stamp every other row receives.
    const changing = (await newTask({ subject: 'row A alone', note: 'as found' })).id;
    const bystander = (await newTask({ subject: 'row B alone', note: SHARED_NOTE })).id;
    const before = (await read(changing)).last_update_at as string;

    await tick();
    await data.update('duly_task', { note: SHARED_NOTE }, {
      multi: true,
      where: { id: { $in: [changing, bystander] } },
    });

    const rowA = await read(changing);
    expect(rowA.note, 'the edit itself still commits').toBe(SHARED_NOTE);
    expect(rowA.last_update_at, 'no row is stamped on the shared-payload path').toBe(before);
  });

  it('leaves an all-unchanged batch alone, and commits it', async () => {
    // The control for the option this decision rejected. Refusing any batch
    // containing an unchanged row would have refused this one too, where
    // nothing leaks because nothing is stamped.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) {
      ids.push((await newTask({ subject: `all unchanged ${i}`, note: SHARED_NOTE })).id);
    }
    const before = await Promise.all(ids.map(async (id) => (await read(id)).last_update_at as string));

    await tick();
    const affected = await data.update('duly_task', { note: SHARED_NOTE }, {
      multi: true,
      where: { id: { $in: ids } },
    });
    expect(affected).toBe(3);

    for (const [i, id] of ids.entries()) {
      expect((await read(id)).last_update_at, `${id} was not touched`).toBe(before[i]);
    }
  });

  it('bulk complete still completes — the unrefreshed clock is a value nothing reads', async () => {
    // The cost of the decision, measured rather than asserted away. `done` is
    // outside the stagnation set, so a task that comes out of this batch with
    // a stale `last_update_at` can never be counted as stalled again.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await newTask({ subject: `bulk complete ${i}` })).id);
    const before = await Promise.all(ids.map(async (id) => (await read(id)).last_update_at as string));

    await tick();
    const affected = await data.update('duly_task', { status: 'done' }, {
      multi: true,
      where: { id: { $in: ids } },
    });
    expect(affected).toBe(3);

    for (const [i, id] of ids.entries()) {
      const row = await read(id);
      expect(row.status).toBe('done');
      expect(row.completed_at, 'completed_at is still stamped — it is a different column').toBeTruthy();
      expect(row.last_update_at, 'and the stagnation clock is left where it was').toBe(before[i]);
    }
  });

  it('bulk skip still skips, reason and all', async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await newTask({ subject: `bulk skip ${i}` })).id);
    const before = await Promise.all(ids.map(async (id) => (await read(id)).last_update_at as string));

    await tick();
    await data.update('duly_task', { status: 'skipped', skip_reason: 'plant shutdown, week 34' }, {
      multi: true,
      where: { id: { $in: ids } },
    });

    for (const [i, id] of ids.entries()) {
      const row = await read(id);
      expect(row.status).toBe('skipped');
      expect(row.skip_reason).toBe('plant shutdown, week 34');
      expect(row.last_update_at, 'skipped is outside the stagnation set too').toBe(before[i]);
    }
  });

  it('does NOT leak into the single-record path — a by-id note edit still stamps', async () => {
    // The boundary. `mode: 'record'` has a payload of its own, so the
    // row-conditional stamp is sound there and stays exactly as it was. This
    // is the assertion that would go red if the skip were written as "never
    // stamp on update" instead of "never stamp on the shared payload".
    const task = await newTask({ note: 'as found' });
    const before = task.last_update_at as string;

    await tick();
    const edited = await data.update('duly_task', { id: task.id, note: SHARED_NOTE });

    expect(edited.last_update_at as string > before, 'the by-id path is unchanged').toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// The lateness stamps (#52)
// ─────────────────────────────────────────────────────────────────────────

/** A civil date `days` from today, in UTC — the boundary the stamps use. */
const dayFromToday = (days: number): string =>
  new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);

describe('late_after — the deadline the row is born with', () => {
  it('is filled from the due date when nothing supplies one — zero grace, not "no deadline"', async () => {
    // The dispatcher stamps this itself, with the duty's grace. Every other
    // producer — the assignment fan-out, a member creating their own task —
    // has no duty to read, and zero grace is what "no duty governs this row"
    // already means to the overdue escalation. A blank here would be a task
    // that can never be late on any surface.
    const task = await newTask({ due_date: '2026-05-04' });
    expect(task.late_after).toBe('2026-05-04');
  });

  it('keeps the deadline the dispatcher stamped, grace and all', async () => {
    // The planner's value must survive the insert leg untouched, or every task
    // in the system would silently be judged at zero grace.
    const task = await newTask({ due_date: '2026-05-04', late_after: '2026-05-11' });
    expect(task.late_after).toBe('2026-05-11');
  });

  it('a task with no due date has no deadline, and no lateness filter can match it', async () => {
    // The honest answer rather than a convenient one: nothing was owed by any
    // particular day. The `late` view is `late_after < {today}`, so this row
    // never appears there — asserted through a real query rather than by
    // reading the column, because "a blank does not match a date filter" is the
    // claim the view's comment actually makes.
    const task = await newTask({ subject: 'no due date at all' });
    expect(task.late_after ?? null).toBeNull();

    const late = await data.find('duly_task', {
      where: { late_after: { $lt: dayFromToday(3650) }, id: task.id },
    });
    expect(late, 'a task with no deadline must not surface in the Late lens').toEqual([]);
  });

  it('fills a blank deadline if a due date arrives later, and only then', async () => {
    const task = await newTask({ subject: 'due date added afterwards' });
    expect(task.late_after ?? null).toBeNull();

    const dated = await data.update('duly_task', { id: task.id, due_date: '2026-06-30' });
    expect(dated.late_after, 'a dated task must become answerable to the Late lens').toBe('2026-06-30');
  });

  it('a re-date NEVER moves a deadline the row already carries', async () => {
    // Write-once, in its smallest form: `late_after` is what the row was born
    // with. Anything else and a task's compliance deadline could be moved by
    // an ordinary edit, with no trace.
    const task = await newTask({ due_date: '2026-05-04', late_after: '2026-05-11' });
    await data.update('duly_task', { id: task.id, due_date: '2026-09-30' });
    expect((await read(task.id)).late_after).toBe('2026-05-11');
  });

  it('is not writable by a caller', async () => {
    const task = await newTask({ due_date: '2026-05-04', late_after: '2026-05-11' });
    await data.update('duly_task', { id: task.id, late_after: '2099-01-01' });
    expect((await read(task.id)).late_after, 'readonly, and the hook is its only writer')
      .toBe('2026-05-11');
  });
});

describe('WRITE-ONCE — editing a duty\'s grace never rewrites history', () => {
  /**
   * The assertion this whole card turns on.
   *
   * An admin who widens a duty's grace from 3 days to 14 is correcting a
   * configuration. They are NOT re-adjudicating last quarter's compliance
   * record — and a system that let them do it silently would be a system whose
   * on-time rate changes when nobody completed anything. The stamps are the
   * mechanism: `late_after` is resolved at dispatch and `completed_late` at
   * completion, and no leg of this hook recomputes either.
   *
   * The duty here is a real record, edited through the engine, and the task is
   * produced by the real planner from that duty's own fields — so this walks
   * the actual path rather than asserting on hand-made values.
   */
  const GRACE_AT_DISPATCH = 3;

  const dispatchedTaskFor = async (dutyId: string, grace: number | null) => {
    const duty = await data.findOne('duly_duty', { where: { id: dutyId } });
    const [draft] = planDispatch({
      duties: [{
        id: duty.id,
        name: duty.name,
        form: 'recurring',
        status: 'active',
        owner: 'user_alice',
        business_unit: null,
        source: 'catalog',
        frequency: 'monthly',
        due_anchor: 'period_start',
        due_offset_days: 4,
        lead_days: 0,
        grace_days: grace,
        timezone: 'UTC',
      }],
      now: new Date('2026-08-15T09:00:00Z'),
      window: null,
    }).drafts;
    return { draft, duty };
  };

  const newDuty = async (subject: string, grace: number) =>
    data.insert('duly_duty', {
      name: subject,
      owner: 'user_alice',
      form: 'recurring',
      status: 'active',
      source: 'catalog',
      frequency: 'monthly',
      due_anchor: 'period_start',
      due_offset_days: 4,
      lead_days: 0,
      grace_days: grace,
      timezone: 'UTC',
    });

  it('an open task keeps the deadline it was dispatched with', async () => {
    const duty = await newDuty('Grace widened after dispatch', GRACE_AT_DISPATCH);
    const { draft } = await dispatchedTaskFor(duty.id, GRACE_AT_DISPATCH);
    expect(draft!.late_after).toBe('2026-08-08');

    const task = await data.insert('duly_task', { ...draft, subject: draft!.subject, owner: 'user_alice' });

    // The correction an admin makes on Monday morning.
    const widened = await data.update('duly_duty', { id: duty.id, grace_days: 21 });
    expect(widened.grace_days).toBe(21);

    expect(
      (await read(task.id)).late_after,
      'an already-dispatched task must keep the deadline it was born with — duly_catalog_sync is '
        + 'where a replay would belong, and it does not do this today',
    ).toBe('2026-08-08');
  });

  it('a completed task keeps its verdict — the on-time rate does not move when nobody completed anything', async () => {
    const duty = await newDuty('Grace widened after completion', GRACE_AT_DISPATCH);
    const { draft } = await dispatchedTaskFor(duty.id, GRACE_AT_DISPATCH);

    // Dispatched with a deadline that is already past, so completing it NOW is
    // late under the grace that was in force.
    const task = await data.insert('duly_task', {
      ...draft,
      subject: 'completed after its grace ran out',
      owner: 'user_alice',
      late_after: dayFromToday(-2),
    });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_late, 'completed two days past its grace').toBe(true);

    // Widen the grace so that, recomputed today, the same completion would be
    // on time. Nothing may recompute it.
    await data.update('duly_duty', { id: duty.id, grace_days: 30 });

    const after = await read(task.id);
    expect(after.completed_late, 'a compliance verdict that rewrites itself is worth nothing').toBe(true);
    expect(after.late_after, 'and the deadline it was judged against stands too').toBe(dayFromToday(-2));
  });
});

describe('completed_late — the verdict, stamped with completed_at', () => {
  it('is false for a completion inside the grace window', async () => {
    const task = await newTask({ due_date: dayFromToday(-3), late_after: dayFromToday(2) });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_late, 'past due but inside its grace — the whole point of grace').toBe(false);
  });

  it('is false on the LAST day of the window, not true', async () => {
    // `late_after` is the last day still inside the window: grace is granted in
    // whole days, so a task completed at any hour of that day is on time. Off
    // by one here and every duty grants a day less grace than it says.
    const task = await newTask({ due_date: dayFromToday(-5), late_after: dayFromToday(0) });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_late).toBe(false);
  });

  it('is true the day after the window closes', async () => {
    const task = await newTask({ due_date: dayFromToday(-9), late_after: dayFromToday(-1) });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_late).toBe(true);
  });

  it('a task with no deadline is completed ON TIME, never "unknown"', async () => {
    // A definite answer, so `done` always splits into on-time + late and the
    // dashboard's two counts add up to the third.
    const task = await newTask({ subject: 'nothing was owed by any day' });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_late).toBe(false);
  });

  it('every row that reaches done carries a definite verdict', async () => {
    // The invariant behind `tasks_done_on_time + tasks_completed_late =
    // tasks_done`. A null verdict is not a third state; it is a done row
    // missing from the metric that this card exists to make computable.
    for (const over of [
      { subject: 'verdict: no dates at all' },
      { subject: 'verdict: due, inside grace', due_date: dayFromToday(-1), late_after: dayFromToday(1) },
      { subject: 'verdict: due, past grace', due_date: dayFromToday(-9), late_after: dayFromToday(-4) },
    ]) {
      const task = await newTask(over);
      const done = await data.update('duly_task', { id: task.id, status: 'done' });
      expect(typeof done.completed_late, `${over.subject}`).toBe('boolean');
    }
  });

  it('is stamped on an ALREADY-done insert — a seeded history or an import', async () => {
    // These rows never make a completion transition, so the beforeUpdate leg
    // never sees them. Without the insert leg the whole seeded six months would
    // read as verdict-less and the demo's on-time rate would be empty.
    const late = await newTask({
      subject: 'seeded, and late',
      status: 'done',
      due_date: '2026-05-01',
      late_after: '2026-05-04',
      completed_at: '2026-05-09T09:00:00.000Z',
    });
    expect(late.completed_late).toBe(true);

    const onTime = await newTask({
      subject: 'seeded, and on time',
      status: 'done',
      due_date: '2026-05-01',
      late_after: '2026-05-04',
      completed_at: '2026-05-04T23:30:00.000Z',
    });
    expect(onTime.completed_late).toBe(false);
  });

  it('is cleared when a task is reopened — a completion that did not happen has no verdict', async () => {
    const task = await newTask({ due_date: dayFromToday(-9), late_after: dayFromToday(-4) });
    await data.update('duly_task', { id: task.id, status: 'done' });
    expect((await read(task.id)).completed_late).toBe(true);

    await data.update('duly_task', { id: task.id, status: 'in_progress' });
    const reopened = await read(task.id);
    expect(reopened.completed_at ?? null).toBeNull();
    expect(reopened.completed_late ?? null, 'the verdict goes with the timestamp').toBeNull();
  });

  it('is not re-judged when an already-done task is saved again', async () => {
    // Same reason `completed_at` is not re-stamped: a re-save is a state, not a
    // transition. Re-judging here would silently turn every on-time record late
    // the moment someone edits a note after the deadline.
    const task = await newTask({ due_date: dayFromToday(-2), late_after: dayFromToday(0) });
    await data.update('duly_task', { id: task.id, status: 'done' });
    expect((await read(task.id)).completed_late).toBe(false);

    await data.update('duly_task', {
      id: task.id,
      status: 'done',
      note: 'a note added long after the fact',
      late_after: dayFromToday(-10),
    });
    expect((await read(task.id)).completed_late, 'a saved record is not a new completion').toBe(false);
  });

  it('is not writable by a caller', async () => {
    const task = await newTask({ due_date: dayFromToday(-9), late_after: dayFromToday(-4) });
    const done = await data.update('duly_task', { id: task.id, status: 'done', completed_late: false });
    expect(done.completed_late, 'the caller does not get to choose this either').toBe(true);
  });
});

// ── The verdict on the shared-payload path ─────────────────────────────────
//
// `completed_late` is read off THIS row's `late_after`, so it is the rewrite
// ADR-0058 Addendum II D3 puts outside the contract — and worse than
// `completed_at`, because two rows in one batch can legitimately disagree.
//
// The response is asymmetric, and the asymmetry is what makes the write sound:
// a row that would be stamped LATE refuses the write, and every row that
// survives its own guard computes `false`, which is row-invariant by
// construction. So a batch is either wholly on time and stamped correctly, or
// refused — and bulk complete, which this product is built around, keeps
// working for the case it is actually used for.
describe('completed_late on a predicate write — one payload, N rows', () => {
  const refusal = async (promise: Promise<unknown>) => {
    try {
      await promise;
    } catch (error: any) {
      return { code: error?.code, status: error?.status, message: String(error?.message ?? '') };
    }
    throw new Error('expected the predicate write to be refused, but it resolved');
  };

  const openTask = (subject: string, lateAfterDays: number) =>
    newTask({ subject, due_date: dayFromToday(lateAfterDays - 1), late_after: dayFromToday(lateAfterDays) });

  it('refuses a bulk completion that contains a late row, naming it', async () => {
    // THE assertion. Without it, whichever dispatch runs last decides the
    // compliance verdict for every row in the selection — five tasks ticked
    // together, one of them late, and the answer is either "all late" or "all
    // on time" depending on an order the caller cannot see or control.
    const onTime = (await openTask('bulk: inside its grace', 4)).id;
    const late = (await openTask('bulk: past its grace', -2)).id;

    const { code, status, message } = await refusal(
      data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: [onTime, late] } } }),
    );

    expect(code).toBe('DULY_TASK_BULK_LATE_COMPLETION');
    expect(status).toBe(409);
    expect(message, 'the refusal must name the row a caller has to remove').toContain(late);
    expect(message, 'and the day its grace ran out, which is why it was refused')
      .toContain(dayFromToday(-2));
  });

  it('writes nothing at all — the refusal is not a partial batch', async () => {
    const onTime = (await openTask('bulk partial: on time', 4)).id;
    const late = (await openTask('bulk partial: late', -3)).id;

    await refusal(
      data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: [onTime, late] } } }),
    );

    for (const id of [onTime, late]) {
      const row = await read(id);
      expect(row.status, 'no row in a refused batch may commit').toBe('open');
      expect(row.completed_at ?? null).toBeNull();
      expect(row.completed_late ?? null).toBeNull();
    }
  });

  it('refuses whichever dispatch order the batch arrives in', async () => {
    // Decided from the ROW alone. An accumulator would only catch the orders in
    // which the late row happens to be dispatched second.
    for (const lateFirst of [true, false]) {
      const onTime = (await openTask(`order on-time ${lateFirst}`, 5)).id;
      const late = (await openTask(`order late ${lateFirst}`, -1)).id;
      const ids = lateFirst ? [late, onTime] : [onTime, late];

      const { code } = await refusal(
        data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: ids } } }),
      );
      expect(code, `late-first=${lateFirst} must refuse`).toBe('DULY_TASK_BULK_LATE_COMPLETION');
    }
  });

  it('refuses an all-late batch too, even though nothing would leak', async () => {
    // The hook cannot see the batch — `dispatch.index` is a position, not a
    // total — so the rule is stated on the ROW: one a caller can predict and a
    // test can pin. Same boundary the already-done guard draws.
    const ids = [
      (await openTask('all late a', -2)).id,
      (await openTask('all late b', -6)).id,
    ];
    const { code } = await refusal(
      data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: ids } } }),
    );
    expect(code).toBe('DULY_TASK_BULK_LATE_COMPLETION');
  });

  it('still completes an on-time batch — every row stamped false, in one write', async () => {
    // The negative control, and the feature this guard must not cost: a week of
    // ticks in one gesture. Every row that survives its own guard computes the
    // SAME value, so what reaches the shared payload is row-invariant.
    const ids: string[] = [];
    for (let i = 0; i < 5; i += 1) ids.push((await openTask(`on-time batch ${i}`, 2 + i)).id);

    const affected = await data.update('duly_task', { status: 'done' }, {
      multi: true,
      where: { id: { $in: ids } },
    });
    expect(affected).toBe(5);

    for (const id of ids) {
      const row = await read(id);
      expect(row.status).toBe('done');
      expect(row.completed_at, `${id} must be stamped like any other completion`).toBeTruthy();
      expect(row.completed_late, `${id} must carry a verdict, not a blank`).toBe(false);
    }
  });

  it('completes a batch of deadline-less rows — no deadline is not a refusal', async () => {
    // The shape the existing bulk-complete tests use, and the one a hand-created
    // task arrives in. "No deadline to miss" is `false` for every row, so the
    // batch is uniform and allowed.
    const ids: string[] = [];
    for (let i = 0; i < 3; i += 1) ids.push((await newTask({ subject: `undated batch ${i}` })).id);

    await data.update('duly_task', { status: 'done' }, { multi: true, where: { id: { $in: ids } } });
    for (const id of ids) expect((await read(id)).completed_late).toBe(false);
  });

  it('leaves bulk SKIP alone — skipped is not a completion', async () => {
    const ids = [
      (await openTask('skip late a', -4)).id,
      (await openTask('skip on-time b', 4)).id,
    ];
    const affected = await data.update(
      'duly_task',
      { status: 'skipped', skip_reason: 'the plant was down for the whole period' },
      { multi: true, where: { id: { $in: ids } } },
    );
    expect(affected, 'a late row must not block a bulk skip — nothing is being judged').toBe(2);
    for (const id of ids) {
      expect((await read(id)).status).toBe('skipped');
      expect((await read(id)).completed_late ?? null).toBeNull();
    }
  });

  it('a predicate write clearing done is NOT refused — null is right for every row', async () => {
    const late = (await openTask('cleared late', -3)).id;
    const onTime = (await openTask('cleared on-time', 3)).id;
    await data.update('duly_task', { id: late, status: 'done' });
    await data.update('duly_task', { id: onTime, status: 'done' });
    expect((await read(late)).completed_late).toBe(true);

    const affected = await data.update('duly_task', { status: 'in_progress' }, {
      multi: true,
      where: { id: { $in: [late, onTime] } },
    });
    expect(affected).toBe(2);
    for (const id of [late, onTime]) {
      expect((await read(id)).completed_at ?? null).toBeNull();
      expect((await read(id)).completed_late ?? null, 'the verdict is cleared with the timestamp')
        .toBeNull();
    }
  });

  it('does not fill a blank late_after on the shared-payload path', async () => {
    // The fill leg is row-conditional in the other direction — "this row has no
    // stamp" — so on a batch it would write one row's due date onto every
    // matched row, overwriting a deadline another row was born with. Nothing is
    // written instead: an unstamped row stays where it already was.
    const blank = (await newTask({ subject: 'bulk re-date: no deadline yet' })).id;
    const stamped = (await openTask('bulk re-date: already stamped', 6)).id;
    const original = (await read(stamped)).late_after;

    await data.update('duly_task', { due_date: '2026-12-24' }, {
      multi: true,
      where: { id: { $in: [blank, stamped] } },
    });

    expect((await read(stamped)).late_after, 'a stamped row must not be re-dated by another row')
      .toBe(original);
    expect((await read(blank)).late_after ?? null, 'and the blank row is left blank, not filled from a batch')
      .toBeNull();
  });
});
