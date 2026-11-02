// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { extractHookBody } from '@objectstack/cli/hook-body';

import stack from '../objectstack.config.js';
import { TaskDutyReadGuard, TaskLifecycleHook, dulyHooks } from '../src/hooks/index.js';
import { runDispatch, unbindDispatchEngine } from '../src/jobs/dispatch.job.js';
import { ensureUsers } from './support/users.js';

/**
 * `duly_task.duty` must name a duty the writer can read (#174).
 *
 * Measured first on 18.2.0 against a live `pnpm demo`: a `duly_member` who
 * reads a duty as 404 could still attach a task to it through every door. This
 * suite proves the refusal door by door, as a real `duly_member` resolved by
 * the platform's own `buildContextForUser` — `SecurityPlugin` and
 * `SharingServicePlugin` mounted, so `readScope: 'own'` is what decides what
 * the member can read, not a fixture's say-so:
 *
 *  - **Data POST / PATCH** — `HttpDispatcher.handleData`, the handler behind
 *    `/api/v1/data/duly_task`. A refusal THROWS there; the HTTP adapter maps
 *    the `ValidationError` shape to 400.
 *  - **Bulk** — `POST /data/duly_task/updateMany`, the console's bulk shape.
 *  - **MCP** — `HttpDispatcher.buildMcpBridge`, whose `create` / `update` are
 *    the `create_record` / `update_record` tools.
 *
 * And the writes that must keep working: a member's own duty, a re-save that
 * re-sends a stored duty the member cannot read (#143), clearing the duty, the
 * dispatcher, and the seed's system write.
 *
 * The last block runs the guard the way a deployment does: lowered by the
 * build's own extractor and executed as a QuickJS `body`.
 */

const SYSTEM = { isSystem: true } as const;
const DUE = '2026-11-10';

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;
let OWEN: HttpProtocolContext;
let otherDuty: string;
let owenDuty: string;
let missing: string;

const dutyRow = (name: string, owner: string) => ({
  name,
  owner,
  form: 'one_off',
  status: 'active',
  source: 'catalog',
  timezone: 'UTC',
});

/** An administrator's write of an established duty (see `test/dispatch.test.ts` `seedDuty`). */
const HISTORY = { isSystem: true, skipStateMachine: true } as const;

/** A refusal is what the engine's own check answers for a duty that does not exist. */
const expectNotFound = (thrown: any, id: string) => {
  expect(thrown, 'the write was refused').toBeDefined();
  const fields = thrown?.fields ?? thrown?.error?.fields ?? thrown?.details?.fields;
  const message = String(thrown?.message ?? thrown?.error?.message ?? '');
  expect(message).toContain(`no duly_duty record has id "${id}"`);
  if (fields) expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'duty', code: 'reference_not_found' })]));
};

const attempt = async (fn: () => Promise<any>): Promise<{ ok?: any; thrown?: any }> => {
  try {
    const ok = await fn();
    const status = ok?.response?.status;
    if (typeof status === 'number' && status >= 400) return { thrown: ok.response.body?.error ?? ok.response.body };
    return { ok };
  } catch (thrown) {
    return { thrown };
  }
};

/** The id a create answered with: `{ success, data: { id, … } }` through `handleData`. */
const createdId = (res: { ok?: any }): string => {
  const body = res.ok?.response?.body;
  return String(body?.data?.id ?? body?.data?.record?.id ?? body?.id ?? body?.record?.id);
};

const post = (body: Record<string, unknown>) =>
  attempt(() => dispatcher.handleData('/duly_task', 'POST', body, {}, OWEN));
const patch = (id: string, body: Record<string, unknown>) =>
  attempt(() => dispatcher.handleData(`/duly_task/${id}`, 'PATCH', body, {}, OWEN));
const mcp = () => (dispatcher as any).buildMcpBridge(OWEN);

const stored = async (id: string) => data.findOne('duly_task', { where: { id } }, { context: SYSTEM });
const tasksOn = async (duty: string) => (await data.find('duly_task', { where: { duty } }, { context: SYSTEM })) ?? [];

/** A task of Owen's own, created through his own door, with no duty. */
const owenTask = async (subject: string): Promise<string> => {
  const res = await post({ subject, due_date: DUE });
  expect(res.thrown, 'creating his own duty-less task').toBeUndefined();
  return createdId(res);
};

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new SharingServicePlugin());
  await kernel.use(new SecurityPlugin());
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  const ql = kernel.getService('objectql');
  dispatcher = new HttpDispatcher(kernel);

  await ensureUsers(data, ['user_owen', 'user_sam']);
  const grant = await data.insert(
    'sys_user_permission_set',
    { user_id: 'user_owen', permission_set: 'duly_member' },
    { context: SYSTEM },
  );
  const executionContext = await buildContextForUser(ql, 'user_owen', Date.now(), grant.organization_id);
  OWEN = { request: {}, executionContext };

  // Sam's duty, written by an administrator: `owner_id` is not Owen's.
  otherDuty = String((await data.insert('duly_duty', dutyRow('Sam\'s duty', 'user_sam'), { context: SYSTEM })).id);
  // A duty Owen declared himself, through his own door: his to read. Without
  // `owner` and `source`, which a member may not name since #178.
  const { owner: _owner, source: _source, ...ownRow } = dutyRow('Owen\'s duty', 'user_owen');
  const own = await attempt(() => dispatcher.handleData('/duly_duty', 'POST', ownRow, {}, OWEN));
  expect(own.thrown, 'Owen creating his own duty').toBeUndefined();
  owenDuty = createdId(own);
  missing = 'no-such-duty-174';
}, 180_000);

afterAll(async () => {
  unbindDispatchEngine?.();
  await kernel?.shutdown?.();
});

describe('the premise, measured on this boot', () => {
  it('registers the guard beside the lifecycle hook, with the opposite identity', () => {
    expect(dulyHooks).toContain(TaskDutyReadGuard);
    expect(TaskDutyReadGuard.object).toBe('duly_task');
    expect(TaskDutyReadGuard.events).toEqual(['beforeInsert', 'beforeUpdate']);
    expect(TaskDutyReadGuard.onError).toBe('abort');
    expect(TaskDutyReadGuard.runAs).toBe('inherit');
    expect(TaskLifecycleHook.runAs).toBe('system');
  });

  it('Owen cannot read Sam\'s duty, and can read his own', async () => {
    const read = async (id: string) =>
      attempt(() => dispatcher.handleData(`/duly_duty/${id}`, 'GET', undefined, {}, OWEN));
    expect((await read(otherDuty)).thrown, 'Sam\'s duty is hidden from Owen').toBeDefined();
    expect((await read(owenDuty)).thrown, 'his own duty is readable').toBeUndefined();
  });
});

describe('every door refuses a duty the writer cannot read', () => {
  it('data POST', async () => {
    const before = (await tasksOn(otherDuty)).length;
    const res = await post({ subject: 'On Sam\'s duty', duty: otherDuty, due_date: DUE });
    expectNotFound(res.thrown, otherDuty);
    expect((await tasksOn(otherDuty)).length).toBe(before);
  });

  it('data POST naming the duty\'s own owner — the write that would pre-empt their dispatch', async () => {
    // Since #176 the owner key alone is refused, before this guard is asked:
    // a member may not name anyone else as owner (`TASK_PROVENANCE_LOCK`).
    const named = await post({ subject: 'As Sam', duty: otherDuty, owner: 'user_sam', period_key: '2026-11', due_date: DUE });
    expect(String(named.thrown?.message ?? named.thrown?.error?.message ?? named.thrown)).toContain('Field write denied');
    // And without it, the duty is still refused here.
    const res = await post({ subject: 'Next period', duty: otherDuty, period_key: '2026-11', due_date: DUE });
    expectNotFound(res.thrown, otherDuty);
  });

  it('answers exactly what a duty that exists nowhere answers', async () => {
    const hidden = await post({ subject: 'Hidden', duty: otherDuty, due_date: DUE });
    const absent = await post({ subject: 'Absent', duty: missing, due_date: DUE });
    expectNotFound(absent.thrown, missing);
    const shape = (t: any) => (t?.fields ?? []).map((f: any) => ({ field: f.field, code: f.code }));
    expect(shape(hidden.thrown)).toEqual(shape(absent.thrown));
    expect(hidden.thrown?.code).toBe(absent.thrown?.code);
    expect(String(hidden.thrown?.message).replace(otherDuty, 'ID')).toBe(String(absent.thrown?.message).replace(missing, 'ID'));
  });

  it('data PATCH moving his own task onto it', async () => {
    const id = await owenTask('Mine, moved');
    const res = await patch(id, { duty: otherDuty });
    expectNotFound(res.thrown, otherDuty);
    expect((await stored(id)).duty ?? null).toBeNull();
  });

  it('bulk updateMany moving his own tasks onto it', async () => {
    // `POST /data/duly_task/updateMany` is a REST route over
    // `protocol.updateManyData` (not a `handleData` path), so the protocol is
    // called the way that route calls it: one payload per record, the
    // console's bulk shape.
    const a = await owenTask('Bulk A');
    const b = await owenTask('Bulk B');
    const res = await attempt(() => kernel.getService('protocol').updateManyData({
      object: 'duly_task',
      records: [{ id: a, data: { duty: otherDuty } }, { id: b, data: { duty: otherDuty } }],
      context: OWEN.executionContext,
    }));
    if (res.thrown === undefined) {
      // A per-row envelope: every row reports its own refusal.
      const rows = res.ok?.results ?? res.ok?.records ?? [];
      expect(rows.length, JSON.stringify(res.ok)).toBe(2);
      for (const row of rows) {
        expect(row.success, JSON.stringify(row)).toBe(false);
        const message = (row.errors ?? [row.error]).map((e: any) => e?.message).join(' ');
        expect(message).toContain(`no duly_duty record has id "${otherDuty}"`);
      }
    } else {
      expectNotFound(res.thrown, otherDuty);
    }
    expect((await stored(a)).duty ?? null).toBeNull();
    expect((await stored(b)).duty ?? null).toBeNull();
  });

  it('a predicate (multi) update over his own tasks', async () => {
    const a = await owenTask('Predicate A');
    const res = await attempt(() => data.update(
      'duly_task',
      { duty: otherDuty },
      { where: { subject: 'Predicate A' }, multi: true, context: OWEN.executionContext },
    ));
    expectNotFound(res.thrown, otherDuty);
    expect((await stored(a)).duty ?? null).toBeNull();
  });

  it('MCP create_record', async () => {
    const res = await attempt(() => mcp().create('duly_task', { subject: 'Via MCP', duty: otherDuty }));
    expect(res.ok?.id ?? res.ok?.record?.id, 'no row came back').toBeUndefined();
    expectNotFound(res.thrown, otherDuty);
  });

  it('MCP update_record', async () => {
    const id = await owenTask('Mine, via MCP');
    const res = await attempt(() => mcp().update('duly_task', id, { duty: otherDuty }));
    expectNotFound(res.thrown, otherDuty);
    expect((await stored(id)).duty ?? null).toBeNull();
  });
});

describe('the writes that keep working', () => {
  it('a task on his own duty, by POST and by MCP', async () => {
    expect((await post({ subject: 'On my duty', duty: owenDuty, due_date: DUE })).thrown).toBeUndefined();
    expect((await attempt(() => mcp().create('duly_task', { subject: 'On my duty, MCP', duty: owenDuty }))).thrown).toBeUndefined();
  });

  it('moving his own task onto his own duty, and clearing it again', async () => {
    const id = await owenTask('Mine, onto mine');
    expect((await patch(id, { duty: owenDuty })).thrown).toBeUndefined();
    expect((await stored(id)).duty).toBe(owenDuty);
    expect((await patch(id, { duty: null })).thrown).toBeUndefined();
    expect((await stored(id)).duty ?? null).toBeNull();
  });

  it('a re-save that re-sends a stored duty he cannot read (#143)', async () => {
    // A task of Owen's that an administrator put on Sam's duty: Owen reads the
    // task and not the duty, the open-edition shape of a dispatched task.
    const id = await owenTask('Mine, put on Sam\'s duty by an admin');
    await data.update('duly_task', { id, duty: otherDuty }, { context: SYSTEM });
    const res = await patch(id, { duty: otherDuty, note: 'Still on it' });
    expect(res.thrown, 'the form re-save').toBeUndefined();
    expect((await stored(id)).note).toBe('Still on it');
  });

  it('the dispatcher, writing as the system, on a duty no member can read', async () => {
    const duty = await data.insert('duly_duty', {
      ...dutyRow('Sam\'s monthly duty', 'user_sam'),
      form: 'recurring',
      frequency: 'monthly',
      review_status: 'approved',
    }, { context: HISTORY });
    const result = await runDispatch(data, { now: new Date('2026-11-02T06:00:00Z') });
    expect(result.degradedReason).toBeUndefined();
    expect(result.created).toBeGreaterThan(0);
    const created = await tasksOn(String(duty.id));
    expect(created.length).toBeGreaterThan(0);
    expect(created.every((t: any) => t.owner === 'user_sam')).toBe(true);
  });

  it('a seed write, from the seed loader\'s own context', async () => {
    const row = await data.insert(
      'duly_task',
      { subject: 'Seeded on Sam\'s duty', duty: otherDuty, owner: 'user_sam', source: 'catalog', due_date: DUE },
      { context: { isSystem: true, skipTriggers: true, seedReplay: true } },
    );
    expect((await stored(String(row.id))).duty).toBe(otherDuty);
  });
});

describe('the guard as it ships — lowered, and run in QuickJS', () => {
  let bodyKernel: any;
  let bodyData: any;
  let bodyDispatcher: HttpDispatcher;
  let bodyOwen: HttpProtocolContext;
  let samDuty: string;
  let ownDuty: string;

  beforeAll(async () => {
    const lowered = extractHookBody(TaskDutyReadGuard.handler as (...a: unknown[]) => unknown, 'task.hook.ts');
    const bodyOnly = {
      ...stack,
      hooks: (stack.hooks ?? []).map((hook: any) =>
        hook.name === TaskDutyReadGuard.name
          ? { ...hook, handler: undefined, body: { language: 'js', source: lowered.source, capabilities: lowered.capabilities } }
          : hook),
    };
    const { plugins } = await createStandaloneStack({
      databaseDriver: 'sqlite',
      databaseUrl: ':memory:',
      skipSeedData: true,
      artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
    });
    bodyKernel = new ObjectKernel();
    for (const plugin of plugins) await bodyKernel.use(plugin);
    await bodyKernel.use(createIdentityObjectsPlugin());
    await bodyKernel.use(new SharingServicePlugin());
    await bodyKernel.use(new SecurityPlugin());
    await bodyKernel.use(new AppPlugin(bodyOnly as typeof stack, undefined, { skipSeedData: true }));
    await bodyKernel.bootstrap();
    bodyData = bodyKernel.getService('data');
    bodyDispatcher = new HttpDispatcher(bodyKernel);
    await ensureUsers(bodyData, ['user_owen', 'user_sam']);
    const grant = await bodyData.insert(
      'sys_user_permission_set',
      { user_id: 'user_owen', permission_set: 'duly_member' },
      { context: SYSTEM },
    );
    bodyOwen = {
      request: {},
      executionContext: await buildContextForUser(bodyKernel.getService('objectql'), 'user_owen', Date.now(), grant.organization_id),
    };
    samDuty = String((await bodyData.insert('duly_duty', dutyRow('Sam\'s duty', 'user_sam'), { context: SYSTEM })).id);
    const { owner: _owner, source: _source, ...ownRow } = dutyRow('Owen\'s duty', 'user_owen');
    const own = await bodyDispatcher.handleData('/duly_duty', 'POST', ownRow, {}, bodyOwen);
    ownDuty = createdId({ ok: own });
  }, 180_000);

  afterAll(async () => {
    await bodyKernel?.shutdown?.();
  });

  it('declares the read it makes, and nothing more', () => {
    const lowered = extractHookBody(TaskDutyReadGuard.handler as (...a: unknown[]) => unknown, 'task.hook.ts');
    expect(lowered.capabilities).toEqual(['api.read']);
  });

  it('refuses Sam\'s duty and allows his own', async () => {
    const refused = await attempt(() => bodyDispatcher.handleData('/duly_task', 'POST', { subject: 'Body: Sam', duty: samDuty, due_date: DUE }, {}, bodyOwen));
    expect(refused.thrown, 'refused in the sandbox').toBeDefined();
    expect(String(refused.thrown?.message ?? '')).toContain(`no duly_duty record has id "${samDuty}"`);
    const allowed = await attempt(() => bodyDispatcher.handleData('/duly_task', 'POST', { subject: 'Body: mine', duty: ownDuty, due_date: DUE }, {}, bodyOwen));
    expect(allowed.thrown).toBeUndefined();
  });

  it('lets a system write through', async () => {
    const row = await bodyData.insert('duly_task', { subject: 'Body: system', duty: samDuty, owner: 'user_sam', source: 'catalog', due_date: DUE }, { context: SYSTEM });
    expect(row.id).toBeDefined();
  });
});
