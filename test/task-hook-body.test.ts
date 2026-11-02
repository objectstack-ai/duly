// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { extractHookBody } from '@objectstack/cli/hook-body';

import stack from '../objectstack.config.js';
import { TaskLifecycleHook } from '../src/hooks/task.hook.js';
import { ensureUsers } from './support/users.js';

/**
 * `duly_task_lifecycle_stamps` as it SHIPS — lowered, and run in QuickJS.
 *
 * `test/task-hook.test.ts` runs the inline handler in Node. What a deployment
 * runs is different: `objectstack build` lowers that handler into a metadata
 * `body`, and the runtime executes the body in the QuickJS sandbox, where the
 * module scope is gone, `Intl` does not exist and `ctx.api` is only usable for
 * the capabilities the body declares. All four gates can stay green while the
 * lowered body is broken, because none of them runs it.
 *
 * #100 is what makes that gap matter here: the hook now READS `duly_duty`
 * through `ctx.api` to apply the duty's grace. So this suite lowers the handler
 * with the build's own extractor (`@objectstack/cli/hook-body`, the function
 * `os build` and `os lint` both call), swaps the result into the real config in
 * place of the function, and boots that — `AppPlugin` then binds it through
 * the QuickJS body runner, exactly as it binds `dist/objectstack.json`.
 */

const lowered = extractHookBody(TaskLifecycleHook.handler as (...a: unknown[]) => unknown, 'task.hook.ts');

let data: any;
let kernel: any;

const SYSTEM = { isSystem: true } as const;

beforeAll(async () => {
  const bodyOnly = {
    ...stack,
    hooks: (stack.hooks ?? []).map((hook: any) =>
      hook.name === TaskLifecycleHook.name
        ? {
            ...hook,
            // No function left to fall back to: if the body does not run, the
            // stamps below are simply missing.
            handler: undefined,
            body: { language: 'js', source: lowered.source, capabilities: lowered.capabilities },
          }
        : hook),
  };

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // See test/task-hook.test.ts: never let a local build artifact stand in
    // for the config under test.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new AppPlugin(bodyOnly as typeof stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  await ensureUsers(data, ['user_alice']);
}, 120_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

const DUE = '2026-11-10';

const oneOffDuty = async (name: string, grace: number) =>
  data.insert('duly_duty', {
    name,
    owner: 'user_alice',
    form: 'one_off',
    status: 'active',
    source: 'catalog',
    grace_days: grace,
    timezone: 'UTC',
  }, { context: SYSTEM });

const newTask = async (over: Record<string, unknown> = {}) =>
  data.insert('duly_task', {
    subject: 'Hand over the commissioning file',
    owner: 'user_alice',
    source: 'catalog',
    status: 'open',
    ...over,
  });

describe('the lowered body', () => {
  it('lowers without a module-scope reference, and declares exactly the read it makes', () => {
    // `extractHookBody` throws on a free identifier, so reaching this line is
    // half the assertion. The other half: the grace read is the body's only
    // `ctx.api` use, so `api.read` is its only capability — a write
    // capability appearing here would mean the hook had grown a second effect.
    expect(lowered.isExpression).toBe(false);
    expect(lowered.capabilities).toEqual(['api.read']);
    expect(lowered.source).toContain("ctx.api.object(\"duly_duty\").findOne");
  });

  it('makes exactly two elevated calls: grace_days off the duty, and the owner\'s unit (#176)', () => {
    // `runAs: 'system'` elevates the body's own `ctx.api` calls and nothing
    // else — the triggering task write keeps its caller's authorization (the
    // spec's `runAs` scope note; measured live on `pnpm demo` for #100: a
    // member who gets 404 reading the duty still gets the grace on their
    // task, and still gets 404 updating a task that is not theirs). So the
    // whole of what the elevation reaches is these two reads, and they are
    // pinned: the duty's grace, and — on a caller's insert only (#176) — the
    // owner's `primary_business_unit_id` (the caller, unless the caller is unlocked).
    const calls = lowered.source.match(/ctx\.api\b[^;]*/g) ?? [];
    const apiCalls = calls.filter((c) => c.includes('.object(')).map((c) => c.replace(/\s+/g, ' '));
    expect(apiCalls, 'two ctx.api data calls in the whole body').toHaveLength(2);
    expect(apiCalls[0])
      .toBe('ctx.api.object("duly_duty").findOne({ where: { id }, fields: ["grace_days"] })');
    expect(apiCalls[1])
      .toBe('ctx.api.object("sys_user").findOne({ where: { id: ownerId }, fields: ["primary_business_unit_id"] })');
  });

  it('stamps a task on a one-off duty with the duty\'s grace (#100)', async () => {
    const duty = await oneOffDuty('One-off granting a week — lowered body', 7);
    const task = await newTask({ duty: duty.id, due_date: DUE });
    expect(task.late_after).toBe('2026-11-17');
  });

  it('keeps zero grace for a task with no duty', async () => {
    const task = await newTask({ subject: 'my own task, lowered', due_date: DUE });
    expect(task.late_after).toBe(DUE);
  });

  it('fills a blank deadline with the duty\'s grace on the update leg', async () => {
    const duty = await oneOffDuty('One-off dated later — lowered body', 7);
    const task = await newTask({ duty: duty.id });
    const dated = await data.update('duly_task', { id: task.id, due_date: DUE });
    expect(dated.late_after).toBe('2026-11-17');
  });

  it('still stamps the completion — the rest of the hook survived the lowering', async () => {
    const task = await newTask({ subject: 'complete me, lowered', due_date: '2099-01-01' });
    const done = await data.update('duly_task', { id: task.id, status: 'done' });
    expect(done.completed_at, 'completed_at_required_when_done would refuse the write otherwise')
      .toBeTruthy();
    expect(done.completed_late).toBe(false);
  });
});
