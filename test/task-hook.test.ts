// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { dulyHooks } from '../src/hooks/index.js';

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
