// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpDispatcherResult, HttpProtocolContext } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import {
  CATALOG_APPLY_ACTION,
  CATALOG_APPLY_TO_PEOPLE_ACTION,
  CATALOG_ITEM_OBJECT,
  CATALOG_SYNC_ACTION,
} from '../src/actions/catalog.handlers.js';
import type { CatalogApplyResult, CatalogSyncResult } from '../src/actions/catalog.handlers.js';

/**
 * #79 — the catalog actions driven through the REAL action route, with the
 * engine facade the RUNTIME builds.
 *
 * ── Why this suite exists at all ──────────────────────────────────────────
 * `duly_catalog_apply` shipped reporting a successful run of zero. Every
 * `engine.find` in `catalog.handlers.ts` passed an ObjectQL query ENVELOPE
 * (`{ where: { … } }`), while `buildActionEngineFacade` (@objectstack/runtime
 * 17.2.0) treats its second argument as a bare FILTER and adds the envelope
 * itself — so in production the query arrived as `{ where: { where: { … } } }`,
 * no row has a field called `where`, and every filtered read came back empty
 * with no error. Apply created nothing, sync scanned nothing, and
 * `resolveBusinessUnit` anchored nothing.
 *
 * Four green gates said otherwise for the life of the defect, and the reason is
 * the shape of the coverage, not its quantity: `catalog-instantiate.test.ts`'s
 * `FakeEngine` and `catalog-apply-cadence.test.ts`'s facade are both DOUBLES,
 * and a double can only encode its author's belief about the contract. Both
 * honoured the handler's convention, so 78 duty assertions passed against a
 * query shape production never produced.
 *
 * So the rule this suite exists to enforce is: **no facade is written here.**
 * The request goes to `HttpDispatcher.handleActions`, the runtime constructs
 * `ctx.engine` itself, and the only shape assertion in the file is what comes
 * back out of the database. If the handler ever goes back to the envelope, the
 * counts below fall to zero and this suite is what says so.
 *
 * ── What layer this is, precisely ─────────────────────────────────────────
 * `handleActions(path, …)` is the `/actions` domain handler itself — the exact
 * function `createActionsDomain`'s route delegates to, with the API prefix
 * already stripped (`req.path.substring(8)`), which is why the paths below
 * start at `/duly_catalog_apply`. It resolves the action declaration, enforces
 * `requiredPermissions`, validates params against the declared contract, and
 * builds the engine facade — the whole server-side dispatch. What it does NOT
 * include is the transport above it (`dispatch()`'s auth gate and scope
 * resolution), which needs an `auth` service this open-edition boot has none
 * of. That layer decides WHO is calling; it has nothing to do with the query
 * shape, and the capability control at the bottom of this file pins that the
 * gate below it is real rather than bypassed.
 */

type AnyRow = Record<string, unknown>;

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Must not resolve to a real path: a local `pnpm build` would make this
    // suite report on the last BUILD instead of on `src/`. See the sibling
    // suites' identical note.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');

  // Through the REAL registration function, so a handler dropped from
  // `registerDulyActionHandlers` surfaces here as the 404 the console gets.
  registerDulyActionHandlers(data);

  dispatcher = new HttpDispatcher(kernel);
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── Calling the route ───────────────────────────────────────────────────────

/** An authenticated admin holding both catalog capabilities. */
const ADMIN: HttpProtocolContext = {
  request: {},
  executionContext: {
    userId: 'admin_1',
    systemPermissions: ['duly.catalog.apply', 'duly.catalog.sync'],
  },
};

async function post(
  path: string,
  params: AnyRow,
  as: HttpProtocolContext = ADMIN,
): Promise<HttpDispatcherResult['response']> {
  const result = await dispatcher.handleActions(path, 'POST', { params }, as);
  return result.response;
}

/** The success body of an action call, asserted 200 before it is read. */
async function run<T>(path: string, params: AnyRow): Promise<T> {
  const response = await post(path, params);
  expect(response?.status, JSON.stringify(response?.body)).toBe(200);
  expect(response?.body?.success).toBe(true);
  return response?.body?.data as T;
}

const dutiesOf = async (owner: string): Promise<AnyRow[]> =>
  data.find('duly_duty', { where: { owner } });

let seq = 0;
const insertItem = async (over: AnyRow): Promise<AnyRow> =>
  data.insert('duly_catalog_item', {
    name: `Item ${++seq}`,
    form: 'recurring',
    frequency: 'monthly',
    due_anchor: 'period_start',
    due_offset_days: 5,
    lead_days: 7,
    grace_days: 0,
    ...over,
  });

// ────────────────────────────────────────────────────────────────────────────

describe('duly_catalog_apply through the runtime\'s own facade (#79)', () => {
  it('creates the duties for a matching position_code', async () => {
    // Acceptance 1. Before the fix this returned `catalog_items: 0,
    // created: 0` with HTTP 200 — a successful run of nothing.
    const position = 'facade_apply';
    const wanted = await insertItem({ position_code: position, frequency: 'quarterly' });
    // Two rows the read must NOT return, so a passing count cannot come from
    // a filter-blind engine handing back the whole table.
    await insertItem({ position_code: position, active: false });
    await insertItem({ position_code: 'facade_other_position' });

    const result = await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_fa1', 'u_fa2'],
    });

    expect(result.catalog_items).toBe(1);
    expect(result.users).toBe(2);
    expect(result.created).toBe(2);
    expect(result.skipped).toBe(0);

    for (const owner of ['u_fa1', 'u_fa2']) {
      const duties = await dutiesOf(owner);
      expect(duties, owner).toHaveLength(1);
      expect(duties[0]?.name).toBe(wanted.name);
      expect(duties[0]?.catalog_item).toBe(wanted.id);
      expect(duties[0]?.frequency).toBe('quarterly');
      expect(duties[0]?.source).toBe('catalog');
      expect(duties[0]?.status).toBe('active');
    }
  });

  it('anchors the duty to the business unit of the owner\'s position', async () => {
    // The read that fails SILENTLY. `resolveBusinessUnit` tolerates "no
    // `sys_user_position` row" as a legitimate day-one state, so its broken
    // read produced no error and no report — just duties with nothing to roll
    // up to. Both people are applied in ONE run: the anchored one proves the
    // read returns, the unanchored one proves the tolerated state is still
    // tolerated and did not turn into a refusal.
    const position = 'facade_anchor';
    await insertItem({ position_code: position });
    const unit = await data.insert('sys_business_unit', { name: 'Plant A' });
    await data.insert('sys_user_position', { user_id: 'u_anchored', business_unit_id: unit.id });

    const result = await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_anchored', 'u_unanchored'],
    });
    expect(result.created).toBe(2);

    const [anchored] = await dutiesOf('u_anchored');
    expect(anchored?.business_unit).toBe(unit.id);

    const [unanchored] = await dutiesOf('u_unanchored');
    expect(unanchored?.business_unit ?? null).toBeNull();
  });

  it('is idempotent on (catalog_item, owner) across two dispatched runs', async () => {
    // The pre-probe read of `duly_duty` is the second of the four filtered
    // reads, and this is what can see it: when it came back empty, `taken` was
    // empty, and a second apply would have duplicated every duty rather than
    // skipping it.
    const position = 'facade_idempotent';
    await insertItem({ position_code: position });

    const first = await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_fi1'],
    });
    expect(first.created).toBe(1);

    const second = await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_fi1'],
    });
    expect(second.created).toBe(0);
    expect(second.skipped).toBe(1);
    expect(second.entries.every((e) => e.outcome === 'skipped')).toBe(true);
    // Counting the report is not enough — assert nothing was written.
    expect(await dutiesOf('u_fi1')).toHaveLength(1);
  });

  it('the object-bound twin reaches the same handler over its own route', async () => {
    // `duly_catalog_apply_to_people` is the button an admin actually presses
    // (`list_toolbar` on the catalog). Same handler function, different engine
    // key — and it dispatches on `<object>:<name>`, so it is a genuinely
    // different route resolution, not a re-run of the test above.
    const position = 'facade_twin';
    await insertItem({ position_code: position });

    const result = await run<CatalogApplyResult>(
      `/${CATALOG_ITEM_OBJECT}/${CATALOG_APPLY_TO_PEOPLE_ACTION}`,
      { position_code: position, users: ['u_ft1'] },
    );

    expect(result.action).toBe(CATALOG_APPLY_ACTION);
    expect(result.catalog_items).toBe(1);
    expect(result.created).toBe(1);
    expect(await dutiesOf('u_ft1')).toHaveLength(1);
  });
});

describe('duly_catalog_sync through the runtime\'s own facade (#79)', () => {
  it('scans the catalog-sourced duties and replays a cadence edit', async () => {
    // Acceptance 2. Before the fix the `{ source: 'catalog' }` read came back
    // empty, so a sync scanned 0 and reported every duty unchanged — which
    // reads exactly like "nothing to do".
    const position = 'facade_sync';
    const item = await insertItem({ position_code: position, grace_days: 0 });
    await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_fs1', 'u_fs2'],
    });

    const clean = await run<CatalogSyncResult>(`/${CATALOG_SYNC_ACTION}`, {
      position_code: position,
    });
    expect(clean.scanned).toBe(2);
    expect(clean.unchanged).toBe(2);
    expect(clean.updated).toBe(0);

    await data.update('duly_catalog_item', { grace_days: 4 }, { where: { id: item.id } });

    const replayed = await run<CatalogSyncResult>(`/${CATALOG_SYNC_ACTION}`, {
      position_code: position,
    });
    expect(replayed.scanned).toBe(2);
    expect(replayed.updated).toBe(2);
    expect(replayed.changes).toHaveLength(2);
    for (const change of replayed.changes) {
      expect(change.fields.grace_days).toEqual({ from: 0, to: 4 });
    }
    for (const owner of ['u_fs1', 'u_fs2']) {
      const [duty] = await dutiesOf(owner);
      expect(duty?.grace_days, owner).toBe(4);
    }
  });

  it('narrowed to one position, it leaves another position\'s duties alone', async () => {
    // The catalog read has TWO shapes — `{ position_code }` when narrowed and
    // `{}` when not — and only the narrowed one was ever wrapped, which is why
    // the unfiltered one kept working and made the handler look half-alive.
    // This drives the narrowed one and pins that it narrows.
    const mine = 'facade_narrow_mine';
    const theirs = 'facade_narrow_theirs';
    const mineItem = await insertItem({ position_code: mine, lead_days: 7 });
    const theirsItem = await insertItem({ position_code: theirs, lead_days: 7 });
    await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: mine,
      users: ['u_fn1'],
    });
    await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: theirs,
      users: ['u_fn2'],
    });

    await data.update('duly_catalog_item', { lead_days: 1 }, { where: { id: mineItem.id } });
    await data.update('duly_catalog_item', { lead_days: 2 }, { where: { id: theirsItem.id } });

    const result = await run<CatalogSyncResult>(`/${CATALOG_SYNC_ACTION}`, { position_code: mine });
    expect(result.scanned).toBe(1);
    expect(result.updated).toBe(1);
    expect(result.changes[0]?.owner).toBe('u_fn1');

    const [ours] = await dutiesOf('u_fn1');
    expect(ours?.lead_days).toBe(1);
    // Untouched: the other position's edit is still pending its own sweep.
    const [others] = await dutiesOf('u_fn2');
    expect(others?.lead_days).toBe(7);
  });

  it('org-wide, it reports a deactivated item\'s duties as retired without deleting them', async () => {
    // The unfiltered (`{}`) catalog read — the one call the defect spared,
    // kept here as the control that both branches of that read work.
    const position = 'facade_retired';
    const item = await insertItem({ position_code: position });
    await run<CatalogApplyResult>(`/${CATALOG_APPLY_ACTION}`, {
      position_code: position,
      users: ['u_fr1'],
    });

    await data.update('duly_catalog_item', { active: false }, { where: { id: item.id } });

    const result = await run<CatalogSyncResult>(`/${CATALOG_SYNC_ACTION}`, {});
    const retired = result.retired.filter((r) => r.owner === 'u_fr1');
    expect(retired).toHaveLength(1);
    expect(retired[0]?.catalog_item).toBe(item.id);
    // Reported, never deleted.
    expect(await dutiesOf('u_fr1')).toHaveLength(1);
  });
});

// ── The control ─────────────────────────────────────────────────────────────

describe('the route these tests use is the gated platform route', () => {
  it('refuses a caller without the declared capability, and writes nothing', async () => {
    // Everything above claims to run "through the real dispatcher". This is
    // what makes that claim falsifiable: a hand-rolled harness that merely
    // called the handler would happily run for this caller too.
    const position = 'facade_ungated';
    await insertItem({ position_code: position });

    const response = await post(
      `/${CATALOG_APPLY_ACTION}`,
      { position_code: position, users: ['u_denied'] },
      { request: {}, executionContext: { userId: 'nobody_1' } },
    );

    expect(response?.status).toBe(403);
    expect(String(response?.body?.error?.message ?? response?.body?.error)).toContain(
      'duly.catalog.apply',
    );
    expect(await dutiesOf('u_denied')).toEqual([]);
  });
});
