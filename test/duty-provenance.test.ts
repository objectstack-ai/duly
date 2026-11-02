// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin, buildContextForUser } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { extractHookBody } from '@objectstack/cli/hook-body';

import stack from '../objectstack.config.js';
import { CATALOG_APPLY_ACTION, CATALOG_SYNC_ACTION } from '../src/actions/catalog.handlers.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import { DutyBusinessUnitStamp, dulyHooks } from '../src/hooks/index.js';
import { AdminPermissionSet, ManagerPermissionSet, MemberPermissionSet } from '../src/security/index.js';
import { ensureUsers } from './support/users.js';

/**
 * Where a duty came from is the server's to say, not a member's (#178).
 *
 * Measured first on 18.2.0 against a live `pnpm demo`: a `duly_member` and a
 * `duly_manager` could create a duty with `source: catalog`, somebody else as
 * `owner` and a foreign `business_unit`, through data POST and MCP
 * `create_record`, and it was stored as sent. The fix is field-level security
 * on the three Duly permission sets plus one stamp hook; this suite proves it
 * door by door, as REAL holders resolved by the platform's own
 * `buildContextForUser` with `SecurityPlugin` and `SharingServicePlugin`
 * mounted:
 *
 *  - Owen holds `duly_member`.
 *  - Marek holds `duly_member` + `duly_manager`.
 *  - Ida holds `duly_member` + `duly_admin` — every Duly admin holds the member
 *    set too, so this is the co-holding that has to be lifted.
 *
 * Doors: data POST / PATCH (`HttpDispatcher.handleData`, the handler behind
 * `/api/v1/data/duly_duty`), MCP `create_record` / `update_record`
 * (`HttpDispatcher.buildMcpBridge`), and the `/actions` door Apply catalog and
 * Sync run through. The console form is the browser pass on the PR: on 18.2.0
 * it renders a locked field read-only and leaves it out of the POST, which is
 * the "plain create" case below.
 *
 * The stamp hook runs as it ships: lowered by the build's own extractor and
 * executed as a QuickJS `body` (see `test/task-hook-body.test.ts`).
 */

const SYSTEM = { isSystem: true } as const;
const PROVENANCE = ['source', 'owner', 'business_unit'] as const;

const lowered = extractHookBody(DutyBusinessUnitStamp.handler as (...a: unknown[]) => unknown, 'duty.hook.ts');

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;
let OWEN: HttpProtocolContext;
let MAREK: HttpProtocolContext;
let IDA: HttpProtocolContext;
/** Business units: each person's primary one, and one that is nobody's. */
const UNIT: Record<'central' | 'ops' | 'admin' | 'quality', string> = { central: '', ops: '', admin: '', quality: '' };

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

/** The id a create answered with, through `handleData` or the MCP bridge. */
const createdId = (res: Attempt): string => {
  const body = res.ok?.response?.body ?? res.ok;
  return String(body?.data?.id ?? body?.data?.record?.id ?? body?.id ?? body?.record?.id);
};

const post = (as: HttpProtocolContext, body: Record<string, unknown>) =>
  attempt(() => dispatcher.handleData('/duly_duty', 'POST', body, {}, as));
const patch = (as: HttpProtocolContext, id: string, body: Record<string, unknown>) =>
  attempt(() => dispatcher.handleData(`/duly_duty/${id}`, 'PATCH', body, {}, as));
const mcpCreate = (as: HttpProtocolContext, body: Record<string, unknown>) =>
  attempt(() => (dispatcher as any).buildMcpBridge(as).create('duly_duty', body));
const mcpUpdate = (as: HttpProtocolContext, id: string, body: Record<string, unknown>) =>
  attempt(() => (dispatcher as any).buildMcpBridge(as).update('duly_duty', id, body));
const action = async (as: HttpProtocolContext, name: string, params: Record<string, unknown>) => {
  const result = await dispatcher.handleActions(`/${name}`, 'POST', { params }, as);
  return result.response;
};

const stored = async (id: string) => data.findOne('duly_duty', { where: { id } }, { context: SYSTEM });
const dutiesNamed = async (name: string) => (await data.find('duly_duty', { where: { name } }, { context: SYSTEM })) ?? [];

let seq = 0;
const plain = (who: string) => ({ name: `#178 ${who} ${++seq}`, form: 'recurring', frequency: 'weekly' });

/** The platform's own refusal, naming exactly the fields the caller sent. */
const expectFieldDenied = (res: Attempt, fields: readonly string[]) => {
  expect(res.thrown, 'the write was refused').toBeDefined();
  const message = String(res.thrown?.message ?? res.thrown?.error?.message ?? res.thrown);
  expect(message).toContain('Field write denied');
  for (const field of fields) expect(message).toContain(field);
};

/** `ctx` for a real holder of `sets`, resolved by the platform. */
const holder = async (ql: any, userId: string, sets: string[]): Promise<HttpProtocolContext> => {
  let org = '';
  for (const permission_set of sets) {
    const grant = await data.insert('sys_user_permission_set', { user_id: userId, permission_set }, { context: SYSTEM });
    org = grant.organization_id;
  }
  return { request: {}, executionContext: await buildContextForUser(ql, userId, Date.now(), org) };
};

/** Poll until plugin-sharing has projected each person's primary unit onto `sys_user`. */
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
  // The stamp hook as it SHIPS: no function left to fall back to.
  const bodyOnly = {
    ...stack,
    hooks: (stack.hooks ?? []).map((hook: any) =>
      hook.name === DutyBusinessUnitStamp.name
        ? { ...hook, handler: undefined, body: { language: 'js', source: lowered.source, capabilities: lowered.capabilities } }
        : hook),
  };

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
  await kernel.use(new AppPlugin(bodyOnly as typeof stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  const ql = kernel.getService('objectql');
  registerDulyActionHandlers(data);
  dispatcher = new HttpDispatcher(kernel);

  await ensureUsers(data, ['user_owen', 'user_marek', 'user_ida', 'user_sami', 'user_nobody']);
  for (const key of Object.keys(UNIT) as Array<keyof typeof UNIT>) {
    UNIT[key] = String((await data.insert('sys_business_unit', { name: `Unit ${key}` }, { context: SYSTEM })).id);
  }
  const home = { user_owen: UNIT.central, user_marek: UNIT.ops, user_sami: UNIT.ops, user_ida: UNIT.admin };
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

describe('the declarations', () => {
  it('locks the three provenance fields for member and manager, and lifts them for the Duly admin', () => {
    for (const field of PROVENANCE) {
      const key = `duly_duty.${field}`;
      expect(MemberPermissionSet.fields?.[key], `member ${key}`).toEqual({ readable: true, editable: false });
      expect(ManagerPermissionSet.fields?.[key], `manager ${key}`).toEqual({ readable: true, editable: false });
      // Field permissions merge most-permissively and only a DECLARING set
      // votes: an admin also holds duly_member, so leaving these out of the
      // admin set would leave the admin locked too.
      expect(AdminPermissionSet.fields?.[key], `admin ${key}`).toEqual({ readable: true, editable: true });
    }
  });

  it('declares nothing but the duty and task provenance maps (#176 owns the task one)', () => {
    const expected = ['duly_duty', 'duly_task'].flatMap((object) => PROVENANCE.map((f) => `${object}.${f}`)).sort();
    for (const set of [MemberPermissionSet, ManagerPermissionSet, AdminPermissionSet]) {
      expect(Object.keys(set.fields ?? {}).sort(), set.name).toEqual(expected);
    }
  });

  it('registers the unit stamp: insert only, system read, abort on failure', () => {
    expect(dulyHooks).toContain(DutyBusinessUnitStamp);
    expect(DutyBusinessUnitStamp.object).toBe('duly_duty');
    expect(DutyBusinessUnitStamp.events).toEqual(['beforeInsert']);
    expect(DutyBusinessUnitStamp.runAs).toBe('system');
    expect(DutyBusinessUnitStamp.onError).toBe('abort');
  });

  it('lowers to a body whose only elevated call reads the owner\'s primary unit', () => {
    expect(lowered.capabilities).toEqual(['api.read']);
    const calls = (lowered.source.match(/ctx\.api\b[^;]*/g) ?? []).filter((c) => c.includes('.object('));
    expect(calls).toHaveLength(1);
    expect(calls[0].replace(/\s+/g, ' '))
      .toBe('ctx.api.object("sys_user").findOne({ where: { id: owner }, fields: ["primary_business_unit_id"] })');
  });
});

describe.each([
  ['a member', () => OWEN, 'user_owen', () => UNIT.central],
  ['a manager', () => MAREK, 'user_marek', () => UNIT.ops],
] as const)('%s', (_label, as, self, ownUnit) => {
  const forged: Array<[string, () => Record<string, unknown>]> = [
    ['source: catalog', () => ({ source: 'catalog' })],
    ['source: assigned', () => ({ source: 'assigned' })],
    // Even the value the default would have produced: naming the field is
    // the refusal, so no caller can lean on "it matched".
    ['source: self', () => ({ source: 'self' })],
    ['another person as owner', () => ({ owner: 'user_sami' })],
    ['themselves as owner', () => ({ owner: self })],
    ['a foreign business unit', () => ({ business_unit: UNIT.quality })],
    ['their own business unit', () => ({ business_unit: ownUnit() })],
  ];

  it.each(forged)('data POST naming %s is refused, and nothing is stored', async (_what, body) => {
    const name = `#178 forged POST ${++seq}`;
    const sent = body();
    expectFieldDenied(await post(as(), { name, frequency: 'weekly', ...sent }), Object.keys(sent));
    expect(await dutiesNamed(name)).toHaveLength(0);
  });

  it.each(forged)('MCP create_record naming %s is refused, and nothing is stored', async (_what, body) => {
    const name = `#178 forged MCP ${++seq}`;
    const sent = body();
    expectFieldDenied(await mcpCreate(as(), { name, frequency: 'weekly', ...sent }), Object.keys(sent));
    expect(await dutiesNamed(name)).toHaveLength(0);
  });

  it('a plain create — what the console form sends — lands self-declared, on the writer, in the writer\'s unit', async () => {
    const res = await post(as(), plain('form'));
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const duty = await stored(createdId(res));
    expect(duty.source).toBe('self');
    expect(duty.owner).toBe(self);
    expect(duty.business_unit).toBe(ownUnit());
    expect(duty.review_status).toBe('to_review');
  });

  it('a plain MCP create lands the same way', async () => {
    const res = await mcpCreate(as(), plain('mcp'));
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const duty = await stored(createdId(res));
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['self', self, ownUnit()]);
  });

  it('cannot change any of the three on their own duty, through PATCH or MCP update', async () => {
    const id = createdId(await post(as(), plain('own')));
    for (const body of [{ source: 'catalog' }, { owner: 'user_sami' }, { business_unit: UNIT.quality }]) {
      expect((await patch(as(), id, body)).thrown, `PATCH ${Object.keys(body)}`).toBeDefined();
      expect((await mcpUpdate(as(), id, body)).thrown, `MCP ${Object.keys(body)}`).toBeDefined();
    }
    const duty = await stored(id);
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['self', self, ownUnit()]);
  });
});

describe('a Duly admin (who also holds duly_member)', () => {
  it('may name all three, and the named unit stands', async () => {
    const res = await post(IDA, { ...plain('admin'), source: 'catalog', owner: 'user_sami', business_unit: UNIT.quality });
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const duty = await stored(createdId(res));
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['catalog', 'user_sami', UNIT.quality]);
  });

  it('may do the same through MCP', async () => {
    const res = await mcpCreate(IDA, { ...plain('admin mcp'), source: 'catalog', owner: 'user_sami', business_unit: UNIT.quality });
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const duty = await stored(createdId(res));
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['catalog', 'user_sami', UNIT.quality]);
  });

  it('naming an owner but no unit gets the OWNER\'s unit, not the admin\'s', async () => {
    const res = await post(IDA, { ...plain('admin for sami'), owner: 'user_sami' });
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    expect((await stored(createdId(res))).business_unit).toBe(UNIT.ops);
  });

  it('a plain create of their own lands in their own unit', async () => {
    const duty = await stored(createdId(await post(IDA, plain('admin own'))));
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['self', 'user_ida', UNIT.admin]);
  });

  it('may correct the three on a duty they own (the admin set has the edit bit)', async () => {
    const id = createdId(await post(IDA, plain('admin correct')));
    const res = await patch(IDA, id, { source: 'catalog', business_unit: UNIT.quality });
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    const duty = await stored(id);
    expect([duty.source, duty.business_unit]).toEqual(['catalog', UNIT.quality]);
  });
});

describe('the writers that put a duty on somebody else keep writing all three', () => {
  it('a system (seed-context) insert stores what it names, and is never stamped', async () => {
    const named = await data.insert('duly_duty', { ...plain('seed'), source: 'catalog', owner: 'user_sami', business_unit: UNIT.quality }, { context: SYSTEM });
    expect([named.source, named.owner, named.business_unit]).toEqual(['catalog', 'user_sami', UNIT.quality]);
    // The seed names each unit itself; a system write with none stays
    // unanchored rather than gaining a rung it did not ask for.
    const bare = await data.insert('duly_duty', { ...plain('seed bare'), source: 'catalog', owner: 'user_sami' }, { context: SYSTEM });
    expect(bare.business_unit ?? null).toBeNull();
  });

  it('Apply catalog, called by a Duly admin, writes source catalog on another person', async () => {
    const position = 'prov_178';
    const item = await data.insert('duly_catalog_item', {
      name: '#178 catalog item', position_code: position, form: 'recurring', frequency: 'monthly',
      due_anchor: 'period_start', due_offset_days: 5, lead_days: 7, grace_days: 0,
    }, { context: SYSTEM });
    await data.insert('sys_user_position', { user_id: 'user_sami', position, business_unit_id: UNIT.quality }, { context: SYSTEM });

    const response = await action(IDA, CATALOG_APPLY_ACTION, { position_code: position, users: ['user_sami'] });
    expect(response?.status, JSON.stringify(response?.body)).toBe(200);
    expect(response?.body?.data?.created).toBe(1);

    const [duty] = await data.find('duly_duty', { where: { catalog_item: item.id, owner: 'user_sami' } }, { context: SYSTEM });
    // The primary unit wins over the position anchor (#179, ruling R-A).
    expect([duty.source, duty.owner, duty.business_unit]).toEqual(['catalog', 'user_sami', UNIT.ops]);

    // Sync replays cadence onto it and leaves its provenance alone.
    await data.update('duly_catalog_item', { id: item.id, due_offset_days: 9 }, { context: SYSTEM });
    const synced = await action(IDA, CATALOG_SYNC_ACTION, { position_code: position });
    expect(synced?.status, JSON.stringify(synced?.body)).toBe(200);
    const after = await stored(String(duty.id));
    expect([after.source, after.owner, after.business_unit, after.due_offset_days]).toEqual(['catalog', 'user_sami', UNIT.ops, 9]);
  });

  it('a member still cannot call Apply catalog', async () => {
    const response = await action(OWEN, CATALOG_APPLY_ACTION, { position_code: 'prov_178', users: ['user_owen'] });
    expect(response?.status).toBe(403);
  });
});

describe('the stamp\'s edges', () => {
  it('leaves a duty unanchored when its owner has no primary unit', async () => {
    const res = await post(IDA, { ...plain('admin for nobody'), owner: 'user_nobody' });
    expect(res.thrown, JSON.stringify(res.thrown)).toBeUndefined();
    expect((await stored(createdId(res))).business_unit ?? null).toBeNull();
  });

  it('is written once, at create: an update does not re-anchor the duty', async () => {
    const id = createdId(await post(IDA, plain('admin anchor once')));
    await patch(IDA, id, { business_unit: null });
    expect((await stored(id)).business_unit ?? null).toBeNull();
  });
});
