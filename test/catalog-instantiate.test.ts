// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { beforeEach, describe, expect, it } from 'vitest';

import type { ActionEngineFacade, ActionHandlerContext } from '@objectstack/spec/ui';

import { Duty } from '../src/objects/index.js';
import { dulyActions } from '../src/actions/index.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import type { HandlerRegistrationContext } from '../src/actions/register-handlers.js';
import {
  CADENCE_FIELDS,
  CATALOG_APPLY_ACTION,
  CATALOG_SYNC_ACTION,
  DEFAULT_DUTY_TIMEZONE,
  GLOBAL_ACTION_OBJECT,
  applyCatalogHandler,
  pairKey,
  resolveDutyTimezone,
  syncCatalogHandler,
} from '../src/actions/catalog.handlers.js';
import type { CatalogApplyResult, CatalogSyncResult } from '../src/actions/catalog.handlers.js';

// ─── A fake engine ──────────────────────────────────────────────────────────
//
// `ActionEngineFacade` is four methods, so the handlers can be driven directly
// without a kernel. The fake HONOURS `where` (equality plus `$in`) rather than
// returning everything: a fake that ignored filters would make every test pass
// for the wrong reason, and would hide a handler that forgot to narrow its
// read. The one test that needs an unfiltered read builds its own lenient
// engine, deliberately — see "the source guard is in the code".

interface Row extends Record<string, unknown> {
  id: string;
}

function matches(row: Row, where: Record<string, unknown> | undefined): boolean {
  if (!where) return true;
  for (const [field, expected] of Object.entries(where)) {
    const actual = row[field];
    if (expected !== null && typeof expected === 'object' && '$in' in (expected as object)) {
      const set = (expected as { $in: unknown[] }).$in;
      if (!Array.isArray(set) || !set.includes(actual)) return false;
      continue;
    }
    if (actual !== expected) return false;
  }
  return true;
}

class FakeEngine implements ActionEngineFacade {
  readonly tables = new Map<string, Row[]>();
  readonly inserts: Array<{ object: string; data: Record<string, unknown> }> = [];
  readonly updates: Array<{ object: string; id: string; data: Record<string, unknown> }> = [];
  readonly deletes: Array<{ object: string; id: string }> = [];
  private seq = 0;

  seed(object: string, rows: Array<Record<string, unknown>>): void {
    const table = this.tables.get(object) ?? [];
    for (const row of rows) table.push({ ...row, id: String(row.id ?? `${object}_${++this.seq}`) });
    this.tables.set(object, table);
  }

  async insert(object: string, data: Record<string, unknown>): Promise<{ id: string }> {
    const id = `${object}_${++this.seq}`;
    const table = this.tables.get(object) ?? [];
    table.push({ ...data, id });
    this.tables.set(object, table);
    this.inserts.push({ object, data });
    return { id };
  }

  async update(object: string, id: string, data: Record<string, unknown>): Promise<void> {
    const row = (this.tables.get(object) ?? []).find((r) => r.id === id);
    if (!row) throw new Error(`update: no ${object} row ${id}`);
    Object.assign(row, data);
    this.updates.push({ object, id, data });
  }

  async delete(object: string, id: string): Promise<void> {
    this.deletes.push({ object, id });
  }

  async find(object: string, query: Record<string, unknown>): Promise<Array<Record<string, unknown>>> {
    const where = query?.where as Record<string, unknown> | undefined;
    return (this.tables.get(object) ?? []).filter((row) => matches(row, where)).map((row) => ({ ...row }));
  }

  rows(object: string): Row[] {
    return this.tables.get(object) ?? [];
  }
}

function contextFor(engine: ActionEngineFacade, params: Record<string, unknown>): ActionHandlerContext {
  return {
    record: {},
    params,
    user: { id: 'admin_1', organizationId: 'org_1' },
    session: { userId: 'admin_1', organizationId: 'org_1' },
    engine,
  };
}

/** A 26-item catalog, the size the issue uses as the adoption bar. */
function seedCatalog(engine: FakeEngine, positionCode: string, count = 26, idPrefix = 'item'): void {
  engine.seed(
    'duly_catalog_item',
    Array.from({ length: count }, (_, i) => ({
      id: `${idPrefix}_${i + 1}`,
      name: `Duty ${i + 1}`,
      description: `What done means for duty ${i + 1}`,
      position_code: positionCode,
      form: 'recurring',
      frequency: 'monthly',
      due_anchor: 'period_start',
      due_offset_days: 5,
      lead_days: 7,
      grace_days: 0,
      active: true,
    })),
  );
}

const THREE_USERS = ['user_a', 'user_b', 'user_c'];

describe('duly_catalog_apply', () => {
  let engine: FakeEngine;

  beforeEach(() => {
    engine = new FakeEngine();
    seedCatalog(engine, 'plant_compliance_officer');
  });

  it('applying a 26-item catalog to 3 users creates 78 duties, all catalog-sourced', async () => {
    const result = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: THREE_USERS }),
    )) as CatalogApplyResult;

    expect(result.created).toBe(78);
    expect(result.skipped).toBe(0);
    expect(result.catalog_items).toBe(26);
    expect(result.users).toBe(3);

    const duties = engine.rows('duly_duty');
    expect(duties).toHaveLength(78);
    for (const duty of duties) {
      expect(duty.source).toBe('catalog');
      expect(typeof duty.catalog_item).toBe('string');
      expect(duty.catalog_item).toBeTruthy();
      expect(duty.status).toBe('active');
    }

    // Every (item, owner) pair exactly once — 78 rows could still be 26
    // duplicates of three.
    const pairs = new Set(duties.map((d) => `${String(d.catalog_item)} ${String(d.owner)}`));
    expect(pairs.size).toBe(78);
  });

  it('copies the catalog item\'s content and cadence onto the duty', async () => {
    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    );

    const duty = engine.rows('duly_duty').find((d) => d.catalog_item === 'item_1');
    expect(duty).toBeDefined();
    expect(duty).toMatchObject({
      name: 'Duty 1',
      description: 'What done means for duty 1',
      form: 'recurring',
      frequency: 'monthly',
      due_anchor: 'period_start',
      due_offset_days: 5,
      lead_days: 7,
      grace_days: 0,
      owner: 'user_a',
      source: 'catalog',
      status: 'active',
    });
  });

  it('applying the same input again creates 0 and reports 78 skipped', async () => {
    const first = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: THREE_USERS }),
    )) as CatalogApplyResult;
    expect(first.created).toBe(78);

    const insertsAfterFirst = engine.inserts.length;

    const second = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: THREE_USERS }),
    )) as CatalogApplyResult;

    expect(second.created).toBe(0);
    expect(second.skipped).toBe(78);
    // Counting the report is not enough — assert nothing was written.
    expect(engine.inserts.length).toBe(insertsAfterFirst);
    expect(engine.rows('duly_duty')).toHaveLength(78);
    expect(second.entries.every((e) => e.outcome === 'skipped')).toBe(true);
  });

  it('adding a person to an already-applied position creates only their duties', async () => {
    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a', 'user_b'] }),
    );

    const result = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: THREE_USERS }),
    )) as CatalogApplyResult;

    expect(result.created).toBe(26);
    expect(result.skipped).toBe(52);
    expect(result.entries.filter((e) => e.outcome === 'created').every((e) => e.owner === 'user_c')).toBe(true);
  });

  it('instantiates only ACTIVE items, and only for the requested position', async () => {
    engine.seed('duly_catalog_item', [
      { id: 'item_off', name: 'Retired duty', position_code: 'plant_compliance_officer', form: 'recurring', active: false },
      { id: 'item_other', name: 'Someone else\'s duty', position_code: 'shift_supervisor', form: 'recurring', active: true },
    ]);

    const result = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    )) as CatalogApplyResult;

    expect(result.created).toBe(26);
    const items = engine.rows('duly_duty').map((d) => d.catalog_item);
    expect(items).not.toContain('item_off');
    expect(items).not.toContain('item_other');
  });

  it('anchors business_unit on sys_user_position.business_unit_id', async () => {
    engine.seed('sys_user_position', [
      { id: 'up_1', user_id: 'user_a', position: 'plant_compliance_officer', business_unit_id: 'bu_north' },
    ]);

    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    );

    for (const duty of engine.rows('duly_duty')) expect(duty.business_unit).toBe('bu_north');
  });

  it('does NOT require a sys_user_position row — day one, before positions are modelled', async () => {
    const result = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    )) as CatalogApplyResult;

    expect(result.created).toBe(26);
    // Absent, not null: an unanchored duty must not claim a business unit.
    for (const duty of engine.rows('duly_duty')) expect(duty.business_unit).toBeUndefined();
  });

  it('ignores an unanchored position row rather than writing a null business unit', async () => {
    engine.seed('sys_user_position', [
      { id: 'up_1', user_id: 'user_a', position: 'plant_compliance_officer', business_unit_id: null },
    ]);

    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    );

    for (const duty of engine.rows('duly_duty')) expect(duty.business_unit).toBeUndefined();
  });

  it('refuses a blank position_code or an empty user list instead of reporting a no-op run', async () => {
    await expect(
      applyCatalogHandler(contextFor(engine, { position_code: '  ', users: THREE_USERS })),
    ).rejects.toThrow(/position_code/);

    await expect(
      applyCatalogHandler(contextFor(engine, { position_code: 'plant_compliance_officer', users: [] })),
    ).rejects.toThrow(/users/);

    expect(engine.inserts).toHaveLength(0);
  });

  it('de-duplicates a repeated user id in one call', async () => {
    const result = (await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a', 'user_a'] }),
    )) as CatalogApplyResult;

    expect(result.users).toBe(1);
    expect(result.created).toBe(26);
  });
});

describe('duly_catalog_sync', () => {
  let engine: FakeEngine;

  async function applyThenEdit(edit: Record<string, unknown>): Promise<void> {
    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: THREE_USERS }),
    );
    const item = engine.rows('duly_catalog_item').find((i) => i.id === 'item_1');
    Object.assign(item as Row, edit);
  }

  beforeEach(() => {
    engine = new FakeEngine();
    seedCatalog(engine, 'plant_compliance_officer');
  });

  it('replays an edited due_offset_days onto every derived duty', async () => {
    await applyThenEdit({ due_offset_days: 12 });

    const result = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(result.updated).toBe(3);
    expect(result.unchanged).toBe(75);
    expect(result.scanned).toBe(78);

    const derived = engine.rows('duly_duty').filter((d) => d.catalog_item === 'item_1');
    expect(derived).toHaveLength(3);
    for (const duty of derived) expect(duty.due_offset_days).toBe(12);
  });

  it('leaves owner, status, timezone and the effective window untouched', async () => {
    await applyThenEdit({ due_offset_days: 12, frequency: 'quarterly' });

    // Local decisions made after instantiation: a paused duty, a moved window.
    for (const duty of engine.rows('duly_duty')) {
      if (duty.catalog_item !== 'item_1') continue;
      duty.status = 'paused';
      duty.timezone = 'Europe/Berlin';
      duty.effective_from = '2026-01-01';
      duty.effective_to = '2026-12-31';
    }

    await syncCatalogHandler(contextFor(engine, {}));

    for (const duty of engine.rows('duly_duty')) {
      if (duty.catalog_item !== 'item_1') continue;
      expect(duty.due_offset_days).toBe(12);
      expect(duty.frequency).toBe('quarterly');
      // untouched
      expect(duty.status).toBe('paused');
      expect(duty.timezone).toBe('Europe/Berlin');
      expect(duty.effective_from).toBe('2026-01-01');
      expect(duty.effective_to).toBe('2026-12-31');
      expect(THREE_USERS).toContain(duty.owner);
    }

    // The patch itself must never name a non-cadence key — asserting the
    // written record is not enough, since a patch could rewrite a field to the
    // value it already had and look untouched.
    for (const update of engine.updates) {
      expect(Object.keys(update.data).sort()).toEqual(
        Object.keys(update.data).filter((k) => (CADENCE_FIELDS as readonly string[]).includes(k)).sort(),
      );
    }
  });

  it('writes every cadence field the catalog owns, and only those', async () => {
    await applyThenEdit({
      frequency: 'weekly',
      due_anchor: 'period_end',
      due_offset_days: -3,
      lead_days: 2,
      grace_days: 4,
    });

    const result = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(result.updated).toBe(3);
    for (const change of result.changes) {
      expect(Object.keys(change.fields).sort()).toEqual([...CADENCE_FIELDS].sort());
      expect(change.fields.due_offset_days).toEqual({ from: 5, to: -3 });
    }
    for (const duty of engine.rows('duly_duty')) {
      if (duty.catalog_item !== 'item_1') continue;
      expect(duty).toMatchObject({
        frequency: 'weekly',
        due_anchor: 'period_end',
        due_offset_days: -3,
        lead_days: 2,
        grace_days: 4,
      });
    }
  });

  it('reports each change with a legible from/to — sync is destructive to authored cadence', async () => {
    await applyThenEdit({ due_offset_days: 12 });

    const result = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(result.changes).toHaveLength(3);
    for (const change of result.changes) {
      expect(change.catalog_item).toBe('item_1');
      expect(change.catalog_item_name).toBe('Duty 1');
      expect(THREE_USERS).toContain(change.owner);
      expect(change.fields.due_offset_days).toEqual({ from: 5, to: 12 });
    }
  });

  it('a self-declared duty is never touched, even with catalog_item set', async () => {
    await applyThenEdit({ due_offset_days: 12 });

    engine.seed('duly_duty', [
      {
        id: 'duty_self',
        name: 'My own note to self',
        owner: 'user_a',
        source: 'self',
        catalog_item: 'item_1',
        due_offset_days: 0,
        frequency: 'daily',
        status: 'active',
      },
    ]);

    const result = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(result.updated).toBe(3);
    expect(engine.updates.some((u) => u.id === 'duty_self')).toBe(false);
    const self = engine.rows('duly_duty').find((d) => d.id === 'duty_self');
    expect(self?.due_offset_days).toBe(0);
    expect(self?.frequency).toBe('daily');
  });

  it('the source guard is in the code, not only in the query filter', async () => {
    // A driver that ignores `where` must not be able to make a self-declared
    // duty catalog-writable. The product invariant lives in the handler.
    await applyThenEdit({ due_offset_days: 12 });
    engine.seed('duly_duty', [
      { id: 'duty_self', owner: 'user_a', source: 'self', catalog_item: 'item_1', due_offset_days: 0 },
    ]);

    const lenient: ActionEngineFacade = {
      insert: (o, d) => engine.insert(o, d),
      update: (o, i, d) => engine.update(o, i, d),
      delete: (o, i) => engine.delete(o, i),
      // Deliberately filter-blind: returns every row whatever the query says.
      find: async (o) => engine.rows(o).map((r) => ({ ...r })),
    };

    const result = (await syncCatalogHandler(contextFor(lenient, {}))) as CatalogSyncResult;

    expect(engine.updates.some((u) => u.id === 'duty_self')).toBe(false);
    expect(result.changes.some((c) => c.duty === 'duty_self')).toBe(false);
  });

  it('deactivating a catalog item and syncing reports it and changes nothing', async () => {
    await applyThenEdit({ active: false, due_offset_days: 12 });

    const before = engine.rows('duly_duty').map((d) => ({ ...d }));
    const result = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(result.retired).toHaveLength(3);
    expect(result.updated).toBe(0);
    for (const entry of result.retired) {
      expect(entry.catalog_item).toBe('item_1');
      expect(entry.catalog_item_name).toBe('Duty 1');
      expect(THREE_USERS).toContain(entry.owner);
    }

    // Reported, never deleted, never edited.
    expect(engine.deletes).toHaveLength(0);
    expect(engine.updates).toHaveLength(0);
    expect(engine.rows('duly_duty')).toEqual(before);
  });

  it('narrowing by position_code leaves other positions alone', async () => {
    await applyThenEdit({ due_offset_days: 12 });

    seedCatalog(engine, 'shift_supervisor', 2, 'sup');
    const other = engine.rows('duly_catalog_item').filter((i) => i.position_code === 'shift_supervisor');
    await applyCatalogHandler(contextFor(engine, { position_code: 'shift_supervisor', users: ['user_d'] }));
    Object.assign(other[0] as Row, { due_offset_days: 99 });

    const result = (await syncCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer' }),
    )) as CatalogSyncResult;

    expect(result.position_code).toBe('plant_compliance_officer');
    expect(result.updated).toBe(3);
    // The other position was neither updated nor reported as retired.
    const otherDuty = engine.rows('duly_duty').find((d) => d.catalog_item === other[0].id);
    expect(otherDuty?.due_offset_days).toBe(5);
    expect(result.retired).toHaveLength(0);
    expect(result.changes.every((c) => c.catalog_item === 'item_1')).toBe(true);
  });

  it('is idempotent — a second sync with no catalog edit writes nothing', async () => {
    await applyThenEdit({ due_offset_days: 12 });
    await syncCatalogHandler(contextFor(engine, {}));
    const writesAfterFirst = engine.updates.length;

    const second = (await syncCatalogHandler(contextFor(engine, {}))) as CatalogSyncResult;

    expect(second.updated).toBe(0);
    expect(second.unchanged).toBe(78);
    expect(engine.updates.length).toBe(writesAfterFirst);
  });
});

describe('pairKey — the idempotency key', () => {
  // The separator is deliberate and the reason is not obvious, so it is pinned
  // rather than left to be "simplified" away.

  it('does not collide across a shifted boundary', () => {
    // Plain concatenation makes these the same string, which would make apply
    // skip a duty it has never created.
    expect(pairKey('ab', 'c')).not.toBe(pairKey('a', 'bc'));
    expect(pairKey('item', '1_user')).not.toBe(pairKey('item_1', 'user'));
  });

  it('is stable and distinguishes each component', () => {
    expect(pairKey('item_1', 'user_a')).toBe(pairKey('item_1', 'user_a'));
    expect(pairKey('item_1', 'user_a')).not.toBe(pairKey('item_1', 'user_b'));
    expect(pairKey('item_1', 'user_a')).not.toBe(pairKey('item_2', 'user_a'));
  });

  it('separates with an escaped NUL, which no record id can contain', () => {
    // Asserted via the escape, never a raw byte in this file either.
    expect(pairKey('a', 'b')).toBe('a' + '\u0000' + 'b');
    expect(pairKey('a', 'b')).toHaveLength(3);
  });
});

describe('handler wiring', () => {
  // The failure mode with no author-time gate: an action whose handler is not
  // registered renders, is clickable, and 404s at call time. `pnpm validate`
  // checks the declaration and knows nothing about the registry, so the
  // declaration↔handler bijection is asserted here.

  function registered(): Array<{ object: string; action: string; handler: unknown }> {
    const calls: Array<{ object: string; action: string; handler: unknown }> = [];
    const ql: HandlerRegistrationContext = {
      registerAction: (...args: unknown[]) => {
        calls.push({ object: String(args[0]), action: String(args[1]), handler: args[2] });
      },
    };
    registerDulyActionHandlers(ql);
    return calls;
  }

  /** The catalog actions, which is what the claims in this file are about. */
  const CATALOG_ACTIONS = [CATALOG_APPLY_ACTION, CATALOG_SYNC_ACTION];

  it('every declared script action has a handler under a key that can reach it', () => {
    // Widened from "the wired names equal the declared names" when the first
    // OBJECT-BOUND actions landed (duly#4): that spelling asserted the app had
    // no actions but these two, so it failed on the next feature rather than on
    // a real defect. The bijection is the invariant worth holding, and this is
    // it — `executeAction` is an exact-string Map lookup on `<object>:<name>`,
    // and the dispatcher tries the action's own object before `global`.
    const wired = new Set(registered().map((c) => `${c.object}:${c.action}`));

    for (const action of dulyActions) {
      if (action.type !== 'script') continue;
      const keys = [`${action.objectName ?? GLOBAL_ACTION_OBJECT}:${action.name}`, `${GLOBAL_ACTION_OBJECT}:${action.name}`];
      expect(
        keys.some((k) => wired.has(k)),
        `${action.name} renders, is clickable and 404s without one of ${keys.join(' or ')}`,
      ).toBe(true);
    }
  });

  it('object-less actions register under the canonical "global" key', () => {
    // `executeAction` is an exact-string Map lookup on `<object>:<name>` — a
    // handler filed under any other key is unreachable, however the action is
    // declared.
    for (const call of registered()) {
      if (!CATALOG_ACTIONS.includes(call.action)) continue;
      expect(call.object).toBe(GLOBAL_ACTION_OBJECT);
      expect(typeof call.handler).toBe('function');
    }
  });

  it('the catalog actions are object-less and headless, matching that key', () => {
    for (const action of dulyActions) {
      if (!CATALOG_ACTIONS.includes(action.name)) continue;
      expect(action.objectName).toBeUndefined();
      // `global_nav` was retired in protocol 17 and every surviving location is
      // object-bound, so `locations: []` is the only honest declaration here.
      expect(action.locations).toEqual([]);
    }
  });

  it('each script action names a target, so it cannot 404 for want of a binding', () => {
    for (const action of dulyActions) {
      if (action.type !== 'script') continue;
      expect(action.target).toBe(action.name);
    }
  });

  it('duly_catalog_apply declares the position_code + multi-user input the flow needs', () => {
    const apply = dulyActions.find((a) => a.name === CATALOG_APPLY_ACTION);
    const params = apply?.params ?? [];

    const position = params.find((p) => p.name === 'position_code');
    expect(position?.type).toBe('text');
    expect(position?.required).toBe(true);

    const users = params.find((p) => p.name === 'users');
    expect(users?.type).toBe('user');
    expect(users?.multiple).toBe(true);
    expect(users?.required).toBe(true);
  });

  it('duly_catalog_sync scopes by an OPTIONAL position_code', () => {
    const sync = dulyActions.find((a) => a.name === CATALOG_SYNC_ACTION);
    const position = (sync?.params ?? []).find((p) => p.name === 'position_code');
    expect(position?.type).toBe('text');
    expect(position?.required).toBe(false);
  });
});

describe('duty timezone resolution', () => {
  it('falls back to UTC — sys_user carries no zone and the org default is not in the action context', () => {
    expect(resolveDutyTimezone()).toBe(DEFAULT_DUTY_TIMEZONE);
    expect(DEFAULT_DUTY_TIMEZONE).toBe('UTC');
  });

  it('agrees with duly_duty.timezone\'s own declared default', () => {
    // Two answers to one question is the drift this pins: if the field default
    // moves, the instantiated duties must move with it.
    expect(Duty.fields.timezone.defaultValue).toBe(DEFAULT_DUTY_TIMEZONE);
  });

  it('stamps the resolved zone on every instantiated duty', async () => {
    const engine = new FakeEngine();
    seedCatalog(engine, 'plant_compliance_officer', 2);
    await applyCatalogHandler(
      contextFor(engine, { position_code: 'plant_compliance_officer', users: ['user_a'] }),
    );
    for (const duty of engine.rows('duly_duty')) expect(duty.timezone).toBe(DEFAULT_DUTY_TIMEZONE);
  });
});
