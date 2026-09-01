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
