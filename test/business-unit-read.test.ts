// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

import stack from '../objectstack.config.js';
import { AdminPermissionSet, ManagerPermissionSet, MemberPermissionSet } from '../src/security/index.js';
import { ensureUsers } from './support/users.js';

/**
 * A Duly user reads business units, and only reads them (#180).
 *
 * `duly_task.business_unit` and `duly_duty.business_unit` are lookups the
 * console resolves under the VIEWER's read. Measured on 18.2.0 before the
 * grant: every Duly set got 403 on `sys_business_unit`, so a member's own task
 * and duty pages showed the unit as a raw id (`?expand=` silently returned the
 * id), and a `duly_admin` who is not a platform administrator could not Import
 * `samples/duties.csv` — the Import resolves the unit by name under the
 * importer's read and refused 19/19 rows.
 *
 * REAL holders, resolved by the platform's own `buildContextForUser` with
 * `SecurityPlugin` and `SharingServicePlugin` mounted:
 *  - Owen holds `duly_member`.
 *  - Marek holds `duly_member` + `duly_manager`.
 *  - Ida holds `duly_member` + `duly_admin` (the importer).
 *
 * The console rendering and the Import itself are the browser pass on the PR.
 */

const SYSTEM = { isSystem: true } as const;

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;
let OWEN: HttpProtocolContext;
let MAREK: HttpProtocolContext;
let IDA: HttpProtocolContext;
const UNIT: Record<'central' | 'ops' | 'quality', string> = { central: '', ops: '', quality: '' };
const NAME = { central: 'Central Office', ops: 'Northgate Operations', quality: 'Northgate Quality' };

type Attempt = { ok?: any; thrown?: any };

const attempt = async (fn: () => Promise<any>): Promise<Attempt> => {
  try {
    const ok = await fn();
    const status = ok?.response?.status;
    if (typeof status === 'number' && status >= 400) return { thrown: ok.response.body?.error ?? ok.response.body };
    return { ok };
  } catch (thrown) {
    return { thrown };
  }
};

const body = (res: Attempt) => res.ok?.response?.body ?? res.ok;
const recordOf = (res: Attempt) => {
  const b = body(res);
  return b?.data?.record ?? b?.record ?? b?.data ?? b;
};
const recordsOf = (res: Attempt): any[] => {
  const b = body(res);
  return b?.data?.records ?? b?.records ?? b?.data ?? [];
};

const holder = async (ql: any, userId: string, sets: string[]): Promise<HttpProtocolContext> => {
  let org = '';
  for (const permission_set of sets) {
    const grant = await data.insert('sys_user_permission_set', { user_id: userId, permission_set }, { context: SYSTEM });
    org = grant.organization_id;
  }
  return { request: {}, executionContext: await buildContextForUser(ql, userId, Date.now(), org) };
};

const settleProjection = async (expected: Record<string, string>) => {
  const deadline = Date.now() + 30_000;
  for (;;) {
    const users = await data.find('sys_user', { where: { id: { $in: Object.keys(expected) } } }, { context: SYSTEM });
    const pending = Object.entries(expected).filter(
      ([id, unit]) => users.find((u: any) => u.id === id)?.primary_business_unit_id !== unit,
    );
    if (pending.length === 0) return;
    if (Date.now() > deadline) throw new Error(`primary_business_unit_id never projected for ${pending.map(([id]) => id).join(', ')}`);
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
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

  await ensureUsers(data, ['user_owen', 'user_marek', 'user_ida']);
  for (const key of Object.keys(UNIT) as Array<keyof typeof UNIT>) {
    UNIT[key] = String(
      (await data.insert('sys_business_unit', { name: NAME[key], code: `C-${key}` }, { context: SYSTEM })).id,
    );
  }
  const home = { user_owen: UNIT.central, user_marek: UNIT.ops, user_ida: UNIT.quality };
  for (const [user_id, business_unit_id] of Object.entries(home)) {
    await data.insert('sys_business_unit_member', { user_id, business_unit_id, is_primary: true }, { context: SYSTEM });
  }
  await settleProjection(home);

  OWEN = await holder(ql, 'user_owen', ['duly_member']);
  MAREK = await holder(ql, 'user_marek', ['duly_member', 'duly_manager']);
  IDA = await holder(ql, 'user_ida', ['duly_member', 'duly_admin']);
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

describe('the declaration', () => {
  it('every Duly set reads business units, and that is the whole grant', () => {
    for (const set of [MemberPermissionSet, ManagerPermissionSet, AdminPermissionSet]) {
      // As the schema parses it: every other bit false, and no scope key.
      expect(set.objects.sys_business_unit, set.name).toEqual({
        allowRead: true,
        allowCreate: false,
        allowEdit: false,
        allowDelete: false,
        allowTransfer: false,
        viewAllRecords: false,
        modifyAllRecords: false,
      });
    }
  });

  it('no Duly set declares a field permission on sys_business_unit (objectstack#29106)', () => {
    // A name-only mask is declarable and works for the member, but field
    // permissions merge among DECLARING sets only, so it would also mask every
    // administrator who holds a Duly set: measured, Setup → Business Units lost
    // Kind, Head and Active. Until #29106 lands, the read is unmasked.
    for (const set of [MemberPermissionSet, ManagerPermissionSet, AdminPermissionSet]) {
      const onUnit = Object.keys(set.fields ?? {}).filter((key) => key.startsWith('sys_business_unit.'));
      expect(onUnit, set.name).toEqual([]);
    }
  });
});

describe.each([
  ['a member', () => OWEN, () => UNIT.central],
  ['a manager', () => MAREK, () => UNIT.ops],
  ['a Duly admin', () => IDA, () => UNIT.quality],
] as const)('%s', (_label, as, ownUnit) => {
  it('lists every unit in the tenant, by name', async () => {
    const res = await attempt(() => dispatcher.handleData('/sys_business_unit', 'GET', {}, {}, as()));
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    expect(recordsOf(res).map((u) => u.name).sort()).toEqual(Object.values(NAME).sort());
  });

  it('reads their own unit by id, name included', async () => {
    const res = await attempt(() => dispatcher.handleData(`/sys_business_unit/${ownUnit()}`, 'GET', {}, {}, as()));
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    expect(recordOf(res).id).toBe(ownUnit());
    expect(typeof recordOf(res).name).toBe('string');
  });

  it('resolves a unit BY NAME under their own read — the lookup the Import makes', async () => {
    const rows = await data.find(
      'sys_business_unit',
      { where: { name: NAME.quality }, fields: ['id', 'name'] },
      { context: as().executionContext },
    );
    expect(rows.map((r: any) => r.id)).toEqual([UNIT.quality]);
  });

  it('sees the unit\'s name on their own hand-made duty when the lookup is expanded', async () => {
    const created = await attempt(() =>
      dispatcher.handleData('/duly_duty', 'POST', { name: `#180 ${_label}`, form: 'recurring', frequency: 'weekly' }, {}, as()),
    );
    expect(created.thrown, JSON.stringify(created.thrown)).toBeUndefined();
    const id = String(body(created)?.data?.id ?? body(created)?.id);
    const res = await attempt(() =>
      dispatcher.handleData(`/duly_duty/${id}`, 'GET', {}, { expand: 'business_unit' }, as()),
    );
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const unit = recordOf(res).business_unit;
    expect(unit?.id, 'the lookup is expanded, not left as a raw id').toBe(ownUnit());
    expect(unit?.name).toBe(Object.entries(UNIT).map(([k, v]) => (v === ownUnit() ? NAME[k as keyof typeof NAME] : ''))
      .find(Boolean));
  });

  it.each([
    ['create', () => dispatcher.handleData('/sys_business_unit', 'POST', { name: 'Forged unit' }, {}, as())],
    ['edit', () => dispatcher.handleData(`/sys_business_unit/${ownUnit()}`, 'PATCH', { name: 'Renamed' }, {}, as())],
    ['delete', () => dispatcher.handleData(`/sys_business_unit/${UNIT.quality}`, 'DELETE', {}, {}, as())],
  ])('is refused %s', async (_verb, write) => {
    const res = await attempt(write);
    expect(res.thrown, `${_verb} must be refused`).toBeDefined();
  });

  it('left every unit exactly as seeded', async () => {
    const rows = await data.find('sys_business_unit', {}, { context: SYSTEM });
    expect(rows.map((r: any) => r.name).sort()).toEqual(Object.values(NAME).sort());
  });
});
