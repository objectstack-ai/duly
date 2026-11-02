// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { AutomationServicePlugin } from '@objectstack/service-automation';
import { JobServicePlugin } from '@objectstack/service-job';

import stack from '../objectstack.config.js';
import { Task } from '../src/objects/task.object.js';
import { AdminPermissionSet, ManagerPermissionSet, MemberPermissionSet } from '../src/security/permission-sets.js';
import { runDispatch, unbindDispatchEngine } from '../src/jobs/dispatch.job.js';
import { ensureUsers } from './support/users.js';

/**
 * Where a task came from, whose it is, and which unit it is filed under (#176).
 *
 * Measured first on 18.2.0 against a live `pnpm demo`: a `duly_member` and a
 * `duly_manager` could each write `source`, `owner` and `business_unit` on a
 * task through every door — data POST and PATCH, MCP create and update — and
 * so put self-made work into the governed readings, or a row into somebody
 * else's. This suite proves the fix door by door, as a real member, a real
 * manager and a member who also holds `duly_admin`, each resolved by the
 * platform's own `buildContextForUser` with `SecurityPlugin` and
 * `SharingServicePlugin` mounted:
 *
 *  - all three fields are locked by `TASK_PROVENANCE_LOCK` on every Duly set,
 *    so a payload that NAMES one is refused by the field-level write gate;
 *  - a task that names none of them is the caller's, `self`, and filed under
 *    the owner's unit (the lifecycle hook's stamp).
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
let unitNadia: string;
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

const LOCKED = ['source', 'owner', 'business_unit'] as const;

/** The field-level write gate's refusal, naming the field. */
const expectLocked = (thrown: any, field: string) => {
  expect(thrown, `the write naming ${field} was refused`).toBeDefined();
  const message = String(thrown?.message ?? thrown?.error?.message ?? thrown?.error ?? JSON.stringify(thrown));
  expect(message).toContain('Field write denied');
  expect(message).toContain(field);
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

  await ensureUsers(data, ['user_owen', 'user_marek', 'user_nadia', 'user_sam']);
  const unit = async (name: string, code: string) =>
    String((await data.insert('sys_business_unit', { name, code }, { context: SYSTEM })).id);
  unitOwen = await unit('Central Office', 'CEN');
  unitMarek = await unit('Northgate Operations', 'OPS');
  unitOther = await unit('Northgate Quality', 'QA');
  unitNadia = await unit('Ardenline Group', 'ARD');
  // `primary_business_unit_id` is the platform's projection; a fixture writes
  // it directly, from the system, the way `test/business-unit-membership`
  // reads it back.
  for (const [user, bu] of [['user_owen', unitOwen], ['user_marek', unitMarek], ['user_nadia', unitNadia], ['user_sam', unitOther]]) {
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
  callers.admin = await bind('user_nadia', ['duly_member', 'duly_admin']);
}, 180_000);

afterAll(async () => {
  unbindDispatchEngine?.();
  await kernel?.shutdown?.();
});

describe('the metadata', () => {
  it('every Duly set locks the three fields, and none lifts them', () => {
    for (const set of [MemberPermissionSet, ManagerPermissionSet, AdminPermissionSet]) {
      for (const field of LOCKED) {
        const entry = (set.fields as Record<string, { readable?: boolean; editable?: boolean }> | undefined)?.[`duly_task.${field}`];
        expect(entry, `${set.name} declares duly_task.${field}`).toBeDefined();
        expect(entry?.editable, `${set.name} may not edit duly_task.${field}`).toBe(false);
        expect(entry?.readable, `${set.name} still reads duly_task.${field}`).toBe(true);
      }
    }
  });

  it('owner is not readonly on the object, so required still bites', () => {
    const fields = Task.fields as Record<string, { readonly?: boolean; required?: boolean }>;
    for (const field of LOCKED) expect(fields[field].readonly, `duly_task.${field}`).toBeFalsy();
    expect(fields.owner.required).toBe(true);
  });
});

describe.each([
  ['member', 'user_owen', () => unitOwen],
  ['manager', 'user_marek', () => unitMarek],
  ['member who also holds duly_admin', 'user_nadia', () => unitNadia],
])('as a %s', (who, self, ownUnit) => {
  const key = who.startsWith('member who') ? 'admin' : who;
  const ctx = () => callers[key]!;
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
  const forged: Record<(typeof LOCKED)[number], () => unknown> = {
    source: () => 'catalog',
    owner: () => 'user_sam',
    business_unit: () => unitOther,
  };

  it('a task naming none of them is theirs, self-declared, and filed under their unit', async () => {
    // The console form's own body: Source and Business unit are left out.
    const res = await post({ subject: `${who}: plain`, status: 'open' });
    expect(res.thrown).toBeUndefined();
    const row = await stored(createdId(res));
    expect(row.owner).toBe(self);
    expect(row.owner_id).toBe(self);
    expect(row.source).toBe('self');
    expect(row.business_unit).toBe(ownUnit());
  });

  it('an edit that names none of them saves', async () => {
    const id = await ownTask(`${who}: edit`);
    const res = await patch(id, { subject: `${who}: edited`, note: 'n' });
    expect(res.thrown).toBeUndefined();
    const row = await stored(id);
    expect([row.subject, row.note, row.business_unit]).toEqual([`${who}: edited`, 'n', ownUnit()]);
  });

  describe.each(LOCKED)('%s', (field) => {
    it('data POST naming it is refused, and nothing is written', async () => {
      const subject = `${who}: POST ${field}`;
      expectLocked((await post({ subject, [field]: forged[field]() })).thrown, field);
      expect((await data.find('duly_task', { where: { subject } }, { context: SYSTEM })) ?? []).toHaveLength(0);
    });

    it('data PATCH naming it is refused', async () => {
      const id = await ownTask(`${who}: PATCH ${field}`);
      const before = await stored(id);
      expectLocked((await patch(id, { [field]: forged[field](), note: 'with it' })).thrown, field);
      const after = await stored(id);
      expect(after[field]).toEqual(before[field]);
      expect(after.note ?? null, 'nothing of the write lands').toBeNull();
    });

    it('MCP create_record and update_record naming it are refused', async () => {
      expectLocked((await attempt(() => mcp().create('duly_task', { subject: `${who}: MCP ${field}`, [field]: forged[field]() }))).thrown, field);
      const id = await ownTask(`${who}: MCP update ${field}`);
      const before = await stored(id);
      expectLocked((await attempt(() => mcp().update('duly_task', id, { [field]: forged[field]() }))).thrown, field);
      expect((await stored(id))[field]).toEqual(before[field]);
    });

    it('bulk updateMany naming it does not land', async () => {
      const id = await ownTask(`${who}: bulk ${field}`);
      const before = await stored(id);
      const res = await attempt(() => kernel.getService('protocol').updateManyData({
        object: 'duly_task',
        records: [{ id, data: { [field]: forged[field]() } }],
        context: ctx().executionContext,
      }));
      if (res.thrown === undefined) {
        const rows = res.ok?.results ?? res.ok?.records ?? [];
        expect(rows.length, JSON.stringify(res.ok)).toBe(1);
        expect(rows[0].success, JSON.stringify(rows[0])).toBe(false);
      } else {
        expectLocked(res.thrown, field);
      }
      expect((await stored(id))[field]).toEqual(before[field]);
    });

    it('a predicate (multi) update naming it is refused', async () => {
      const subject = `${who}: predicate ${field}`;
      const id = await ownTask(subject);
      const before = await stored(id);
      expectLocked((await attempt(() => data.update('duly_task', { [field]: forged[field]() }, {
        where: { subject }, multi: true, context: ctx().executionContext,
      }))).thrown, field);
      expect((await stored(id))[field]).toEqual(before[field]);
    });
  });

  it('naming the stored or their own value is refused too: the lock is on the key, not the value', async () => {
    // Documented, not incidental. The console leaves locked fields out, so
    // only an API caller meets this, and the answer is to leave them out.
    expectLocked((await post({ subject: `${who}: own owner named`, owner: self })).thrown, 'owner');
    const id = await ownTask(`${who}: resend`);
    expectLocked((await patch(id, { source: 'self' })).thrown, 'source');
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
