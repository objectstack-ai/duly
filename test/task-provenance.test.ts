// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { JobServicePlugin } from '@objectstack/service-job';
import { extractHookBody } from '@objectstack/cli/hook-body';

import stack from '../objectstack.config.js';
import { Task } from '../src/objects/task.object.js';
import { TaskOwnerGuard, dulyHooks } from '../src/hooks/index.js';
import { runDispatch, unbindDispatchEngine } from '../src/jobs/dispatch.job.js';
import { ensureUsers } from './support/users.js';

/**
 * Where a task came from, whose it is, and which unit it is filed under (#176).
 *
 * Measured first on 18.2.0 against a live `pnpm demo`: a `duly_member` and a
 * `duly_manager` could each write `source`, `owner` and `business_unit` on a
 * task through every door — data POST and PATCH, MCP create and update — and
 * so put self-made work into the governed readings, or a row into somebody
 * else's. This suite proves the fix door by door, as a real member AND a real
 * manager resolved by the platform's own `buildContextForUser`, with
 * `SecurityPlugin` and `SharingServicePlugin` mounted:
 *
 *  - `source` is `readonly`: a caller's value is STRIPPED, on insert
 *    re-defaulted to `self`.
 *  - `business_unit` is `readonly`: stripped on update; on insert the
 *    lifecycle hook writes the writer's own primary unit.
 *  - `owner` naming anyone but the writer is REFUSED by
 *    `duly_task_owner_is_writer` (it cannot be readonly — see the hook).
 *
 * And the writers that put work on other people keep writing all three: the
 * dispatcher, the assignment fan-out and the seed.
 */

const SYSTEM = { isSystem: true } as const;
const HISTORY = { isSystem: true, skipStateMachine: true } as const;
const DUE = '2026-11-10';

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;
let unitOwen: string;
let unitMarek: string;
let unitOther: string;
const callers: Record<string, HttpProtocolContext> = {};

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

const createdId = (res: { ok?: any }): string => {
  const body = res.ok?.response?.body;
  return String(body?.data?.id ?? body?.data?.record?.id ?? body?.id ?? body?.record?.id ?? res.ok?.id ?? res.ok?.record?.id);
};

const stored = async (id: string) => data.findOne('duly_task', { where: { id } }, { context: SYSTEM });

const expectOwnerRefused = (thrown: any) => {
  expect(thrown, 'the write was refused').toBeDefined();
  const message = String(thrown?.message ?? thrown?.error?.message ?? '');
  expect(message).toContain('you can only create or keep tasks for yourself');
  const fields = thrown?.fields ?? thrown?.error?.fields ?? thrown?.details?.fields;
  if (fields) expect(fields).toEqual(expect.arrayContaining([expect.objectContaining({ field: 'owner', code: 'owner_not_writer' })]));
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
  await kernel.use(new JobServicePlugin());
  await kernel.use(new AutomationServicePlugin());
  await kernel.bootstrap();
  data = kernel.getService('data');
  const ql = kernel.getService('objectql');
  dispatcher = new HttpDispatcher(kernel);

  await ensureUsers(data, ['user_owen', 'user_marek', 'user_sam']);
  const unit = async (name: string, code: string) =>
    String((await data.insert('sys_business_unit', { name, code }, { context: SYSTEM })).id);
  unitOwen = await unit('Central Office', 'CEN');
  unitMarek = await unit('Northgate Operations', 'OPS');
  unitOther = await unit('Northgate Quality', 'QA');
  // `primary_business_unit_id` is the platform's projection; a fixture writes
  // it directly, from the system, the way `test/business-unit-membership`
  // reads it back.
  for (const [user, bu] of [['user_owen', unitOwen], ['user_marek', unitMarek], ['user_sam', unitOther]]) {
    await data.update('sys_user', { id: user, primary_business_unit_id: bu }, { context: SYSTEM });
  }

  const bind = async (user: string, sets: string[]) => {
    let organization: string | undefined;
    for (const set of sets) {
      const grant = await data.insert('sys_user_permission_set', { user_id: user, permission_set: set }, { context: SYSTEM });
      organization = grant.organization_id;
    }
    return { request: {}, executionContext: await buildContextForUser(ql, user, Date.now(), organization) };
  };
  callers.member = await bind('user_owen', ['duly_member']);
  callers.manager = await bind('user_marek', ['duly_member', 'duly_manager']);
}, 180_000);

afterAll(async () => {
  unbindDispatchEngine?.();
  await kernel?.shutdown?.();
});

describe('the metadata', () => {
  it('source and business_unit are server-owned; owner is not readonly, so required still bites', () => {
    const fields = Task.fields as Record<string, { readonly?: boolean; required?: boolean }>;
    expect(fields.source.readonly).toBe(true);
    expect(fields.business_unit.readonly).toBe(true);
    expect(fields.owner.readonly, 'a readonly field skips required — see the owner guard').toBeFalsy();
    expect(fields.owner.required).toBe(true);
  });

  it('registers the owner guard, failing closed', () => {
    expect(dulyHooks).toContain(TaskOwnerGuard);
    expect(TaskOwnerGuard.object).toBe('duly_task');
    expect(TaskOwnerGuard.events).toEqual(['beforeInsert', 'beforeUpdate']);
    expect(TaskOwnerGuard.onError).toBe('abort');
  });
});

describe.each([
  ['member', 'user_owen', () => unitOwen],
  ['manager', 'user_marek', () => unitMarek],
])('as a %s', (who, self, ownUnit) => {
  const ctx = () => callers[who]!;
  const post = (body: Record<string, unknown>) =>
    attempt(() => dispatcher.handleData('/duly_task', 'POST', body, {}, ctx()));
  const patch = (id: string, body: Record<string, unknown>) =>
    attempt(() => dispatcher.handleData(`/duly_task/${id}`, 'PATCH', body, {}, ctx()));
  const mcp = () => (dispatcher as any).buildMcpBridge(ctx());
  const ownTask = async (subject: string): Promise<string> => {
    const res = await post({ subject, due_date: DUE });
    expect(res.thrown, 'creating their own task').toBeUndefined();
    return createdId(res);
  };

  describe('a plain task of their own', () => {
    it('is theirs, self-declared, and filed under their own unit', async () => {
      const row = await stored(await ownTask(`${who}: plain`));
      expect(row.owner).toBe(self);
      expect(row.owner_id).toBe(self);
      expect(row.source).toBe('self');
      expect(row.business_unit).toBe(ownUnit());
    });

    it('saves from the console form, which echoes source and business_unit back', async () => {
      // The create form's own body (measured: `{ source: 'self', status, subject }`),
      // plus an edit form's re-save of every field it shows.
      const res = await post({ subject: `${who}: form`, source: 'self', status: 'open', business_unit: ownUnit() });
      expect(res.thrown).toBeUndefined();
      const id = createdId(res);
      expect((await stored(id)).business_unit).toBe(ownUnit());
      const resave = await patch(id, { subject: `${who}: form, edited`, source: 'self', business_unit: ownUnit(), owner: self, note: 'n' });
      expect(resave.thrown).toBeUndefined();
      const row = await stored(id);
      expect(row.subject).toBe(`${who}: form, edited`);
      expect(row.note).toBe('n');
      expect(row.business_unit).toBe(ownUnit());
    });
  });

  describe('source — stripped on every door', () => {
    it('data POST: a forged catalog lands self', async () => {
      const res = await post({ subject: `${who}: forged catalog`, source: 'catalog', due_date: DUE });
      expect(res.thrown).toBeUndefined();
      expect((await stored(createdId(res))).source).toBe('self');
    });

    it('data PATCH: moving their own task to assigned leaves it self', async () => {
      const id = await ownTask(`${who}: patch source`);
      expect((await patch(id, { source: 'assigned', note: 'still saved' })).thrown).toBeUndefined();
      const row = await stored(id);
      expect(row.source).toBe('self');
      expect(row.note, 'the rest of the write lands').toBe('still saved');
    });

    it('MCP create_record and update_record', async () => {
      const created = await attempt(() => mcp().create('duly_task', { subject: `${who}: mcp source`, source: 'catalog' }));
      expect(created.thrown).toBeUndefined();
      const id = createdId(created);
      expect((await stored(id)).source).toBe('self');
      expect((await attempt(() => mcp().update('duly_task', id, { source: 'catalog' }))).thrown).toBeUndefined();
      expect((await stored(id)).source).toBe('self');
    });

    it('bulk updateMany', async () => {
      const a = await ownTask(`${who}: bulk source`);
      await attempt(() => kernel.getService('protocol').updateManyData({
        object: 'duly_task',
        records: [{ id: a, data: { source: 'catalog' } }],
        context: ctx().executionContext,
      }));
      expect((await stored(a)).source).toBe('self');
    });
  });

  describe('business_unit — the writer\'s own, on every door', () => {
    it('data POST: a foreign unit lands as their own', async () => {
      const res = await post({ subject: `${who}: foreign unit`, business_unit: unitOther });
      expect(res.thrown).toBeUndefined();
      expect((await stored(createdId(res))).business_unit).toBe(ownUnit());
    });

    it('data PATCH: moving their own task to a foreign unit leaves it', async () => {
      const id = await ownTask(`${who}: patch unit`);
      expect((await patch(id, { business_unit: unitOther })).thrown).toBeUndefined();
      expect((await stored(id)).business_unit).toBe(ownUnit());
    });

    it('MCP create_record and update_record', async () => {
      const created = await attempt(() => mcp().create('duly_task', { subject: `${who}: mcp unit`, business_unit: unitOther }));
      expect(created.thrown).toBeUndefined();
      const id = createdId(created);
      expect((await stored(id)).business_unit).toBe(ownUnit());
      expect((await attempt(() => mcp().update('duly_task', id, { business_unit: unitOther }))).thrown).toBeUndefined();
      expect((await stored(id)).business_unit).toBe(ownUnit());
    });

    it('bulk updateMany', async () => {
      const a = await ownTask(`${who}: bulk unit`);
      await attempt(() => kernel.getService('protocol').updateManyData({
        object: 'duly_task',
        records: [{ id: a, data: { business_unit: unitOther } }],
        context: ctx().executionContext,
      }));
      expect((await stored(a)).business_unit).toBe(ownUnit());
    });
  });

  describe('owner — refused on every door', () => {
    it('data POST naming someone else', async () => {
      const res = await post({ subject: `${who}: for Sam`, owner: 'user_sam' });
      expectOwnerRefused(res.thrown);
      const rows = await data.find('duly_task', { where: { subject: `${who}: for Sam` } }, { context: SYSTEM });
      expect(rows ?? []).toHaveLength(0);
    });

    it('data POST naming themselves is fine', async () => {
      const res = await post({ subject: `${who}: for me`, owner: self });
      expect(res.thrown).toBeUndefined();
      expect((await stored(createdId(res))).owner).toBe(self);
    });

    it('data PATCH handing their own task to someone else', async () => {
      const id = await ownTask(`${who}: hand over`);
      expectOwnerRefused((await patch(id, { owner: 'user_sam' })).thrown);
      expect((await stored(id)).owner).toBe(self);
    });

    it('MCP create_record and update_record', async () => {
      expectOwnerRefused((await attempt(() => mcp().create('duly_task', { subject: `${who}: mcp for Sam`, owner: 'user_sam' }))).thrown);
      const id = await ownTask(`${who}: mcp hand over`);
      expectOwnerRefused((await attempt(() => mcp().update('duly_task', id, { owner: 'user_sam' }))).thrown);
      expect((await stored(id)).owner).toBe(self);
    });

    it('bulk updateMany', async () => {
      const a = await ownTask(`${who}: bulk hand over`);
      const res = await attempt(() => kernel.getService('protocol').updateManyData({
        object: 'duly_task',
        records: [{ id: a, data: { owner: 'user_sam' } }],
        context: ctx().executionContext,
      }));
      if (res.thrown === undefined) {
        const rows = res.ok?.results ?? res.ok?.records ?? [];
        expect(rows.length, JSON.stringify(res.ok)).toBe(1);
        expect(rows[0].success).toBe(false);
      } else {
        expectOwnerRefused(res.thrown);
      }
      expect((await stored(a)).owner).toBe(self);
    });

    it('a predicate (multi) update over their own tasks', async () => {
      const subject = `${who}: predicate hand over`;
      const a = await ownTask(subject);
      const res = await attempt(() => data.update('duly_task', { owner: 'user_sam' }, {
        where: { subject }, multi: true, context: ctx().executionContext,
      }));
      expectOwnerRefused(res.thrown);
      expect((await stored(a)).owner).toBe(self);
    });

    it('a re-save of a row whose stored owner is already someone else passes', async () => {
      // Rows written before this guard can carry a foreign owner. A re-save
      // that re-sends it is not a change, so it is not judged.
      const id = await ownTask(`${who}: legacy row`);
      await data.update('duly_task', { id, owner: 'user_sam' }, { context: SYSTEM });
      const res = await patch(id, { owner: 'user_sam', note: 'touched' });
      expect(res.thrown).toBeUndefined();
      expect((await stored(id)).note).toBe('touched');
    });
  });
});

describe('the writers that put work on other people keep writing all three', () => {
  it('the dispatcher copies the duty\'s source, owner and unit', async () => {
    const duty = await data.insert('duly_duty', {
      name: 'Sam\'s monthly return',
      owner: 'user_sam',
      business_unit: unitOther,
      form: 'recurring',
      frequency: 'monthly',
      status: 'active',
      source: 'catalog',
      review_status: 'approved',
      timezone: 'UTC',
    }, { context: HISTORY });
    const result = await runDispatch(data, { now: new Date('2026-11-02T06:00:00Z') });
    expect(result.degradedReason).toBeUndefined();
    const tasks = await data.find('duly_task', { where: { duty: String(duty.id) } }, { context: SYSTEM });
    expect(tasks.length).toBeGreaterThan(0);
    for (const task of tasks) {
      expect(task.owner).toBe('user_sam');
      expect(task.source).toBe('catalog');
      expect(task.business_unit).toBe(unitOther);
    }
  });

  it('the assignment fan-out, triggered by a manager, writes assigned + the assignee\'s unit', async () => {
    const assignment = await data.insert('duly_assignment', {
      subject: 'Supplier attestation, #176', assigner: 'user_marek', assignees: ['user_sam'],
      due_date: '2026-11-20', status: 'dispatched', needs_collection: false,
    }, { context: SYSTEM });
    const row = await data.findOne('duly_assignment', { where: { id: assignment.id } }, { context: SYSTEM });
    // A record-change trigger carries the user whose write fired it: a
    // `runAs: 'system'` run is then `{ isSystem: true, userId }`. That user is
    // the manager — and the owner guard and the unit stamp must still stand
    // aside, because the write is the system's.
    await kernel.getService('automation').execute('duly_assignment_fanout', {
      record: row, object: 'duly_assignment', event: 'afterUpdate', userId: 'user_marek',
    });
    const tasks = await data.find('duly_task', { where: { assignment: assignment.id } }, { context: SYSTEM });
    const sams = tasks.filter((t: any) => t.owner === 'user_sam');
    expect(sams, JSON.stringify(tasks)).toHaveLength(1);
    expect(sams[0].source).toBe('assigned');
    expect(sams[0].business_unit).toBe(unitOther);
  });

  it('a fan-out row with no owner is still refused — owner keeps its required', async () => {
    const res = await attempt(() => data.insert('duly_task', { subject: 'Ownerless', owner: null, source: 'assigned' }, { context: SYSTEM }));
    expect(res.thrown, 'a system insert with no owner').toBeDefined();
    expect(String(res.thrown?.message)).toMatch(/Owner is required/);
  });

  it('a seed write, from the seed loader\'s own context', async () => {
    const row = await data.insert('duly_task', {
      subject: 'Seeded for Sam', owner: 'user_sam', source: 'catalog', business_unit: unitOther, due_date: DUE,
    }, { context: { isSystem: true, skipTriggers: true, seedReplay: true } });
    const back = await stored(String(row.id));
    expect(back.owner).toBe('user_sam');
    expect(back.source).toBe('catalog');
    expect(back.business_unit).toBe(unitOther);
  });

  it('an administrative system update can still re-file a task', async () => {
    const row = await data.insert('duly_task', { subject: 'Re-filed', owner: 'user_sam', source: 'catalog' }, { context: SYSTEM });
    await data.update('duly_task', { id: row.id, owner: 'user_owen', business_unit: unitOwen, source: 'assigned' }, { context: SYSTEM });
    const back = await stored(String(row.id));
    expect([back.owner, back.business_unit, back.source]).toEqual(['user_owen', unitOwen, 'assigned']);
  });
});

describe('the owner guard as it ships — lowered, and run in QuickJS', () => {
  let bodyKernel: any;
  let bodyData: any;
  let bodyDispatcher: HttpDispatcher;
  let bodyOwen: HttpProtocolContext;

  beforeAll(async () => {
    const lowered = extractHookBody(TaskOwnerGuard.handler as (...a: unknown[]) => unknown, 'task.hook.ts');
    expect(lowered.isExpression).toBe(false);
    expect(lowered.capabilities, 'the guard reads nothing').toEqual([]);
    const bodyOnly = {
      ...stack,
      hooks: (stack.hooks ?? []).map((hook: any) =>
        hook.name === TaskOwnerGuard.name
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
    await bodyKernel.use(new AppPlugin(bodyOnly as any, undefined, { skipSeedData: true }));
    await bodyKernel.bootstrap();
    bodyData = bodyKernel.getService('data');
    bodyDispatcher = new HttpDispatcher(bodyKernel);
    await ensureUsers(bodyData, ['user_owen', 'user_sam']);
    const grant = await bodyData.insert('sys_user_permission_set', { user_id: 'user_owen', permission_set: 'duly_member' }, { context: SYSTEM });
    bodyOwen = { request: {}, executionContext: await buildContextForUser(bodyKernel.getService('objectql'), 'user_owen', Date.now(), grant.organization_id) };
  }, 180_000);

  afterAll(async () => {
    await bodyKernel?.shutdown?.();
  });

  it('refuses a foreign owner, allows their own, and lets the system through', async () => {
    const refused = await attempt(() => bodyDispatcher.handleData('/duly_task', 'POST', { subject: 'Body: for Sam', owner: 'user_sam' }, {}, bodyOwen));
    expectOwnerRefused(refused.thrown);
    const allowed = await attempt(() => bodyDispatcher.handleData('/duly_task', 'POST', { subject: 'Body: mine', owner: 'user_owen' }, {}, bodyOwen));
    expect(allowed.thrown).toBeUndefined();
    const system = await bodyData.insert('duly_task', { subject: 'Body: system for Sam', owner: 'user_sam', source: 'assigned' }, { context: SYSTEM });
    expect(system.owner).toBe('user_sam');
  });
});
