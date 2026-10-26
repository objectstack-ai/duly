// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { EngineQueryOptionsSchema } from '@objectstack/spec/data';

import stack from '../objectstack.config.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import {
  CADENCE_FIELDS,
  CATALOG_APPLY_ACTION,
  GLOBAL_ACTION_OBJECT,
} from '../src/actions/catalog.handlers.js';
import type { CatalogApplyResult } from '../src/actions/catalog.handlers.js';
import { ensureUsers } from './support/users.js';

/**
 * #65 — what the catalog APPLY path does with a cadence value.
 *
 * `duly_catalog_item` now carries `recurring_needs_frequency`
 * (`catalog-item.object.ts`). `test/cadence-conditional-defaults.test.ts`
 * proves the rule refuses the write that produces a blank. This suite covers
 * the other half, and it is the half that decides whether the rule belongs on
 * the catalog item at all: a rule that fires on a direct write but leaves the
 * apply path unprotected is half a fix.
 *
 * ── Why a REAL booted engine and not `catalog-instantiate.test.ts`'s fake ──
 * That suite's `FakeEngine` is a Map with a filter matcher: it runs no
 * validation rules and stamps no defaults, so every claim below would pass on
 * it for the wrong reason. Validation and `applyFieldDefaults` are precisely
 * what is under test here, so the handler is dispatched through the app's own
 * `executeAction` against an in-memory ObjectQL engine — the same harness
 * `task-actions.test.ts` uses, and for the same reason.
 */

type AnyRow = Record<string, unknown>;

let kernel: any;
let data: any;

beforeAll(async () => {
  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Must not resolve to a real path: a local `pnpm build` would make this
    // suite report on the last BUILD instead of on `src/`. See the sibling
    // suites' identical note.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  // The reduced kernel's identity objects (`sys_user`, `sys_member`,
  // `sys_organization`) and, with them, the Default Organization a real
  // `single` install creates at boot: from @objectstack 18 every
  // tenant-scoped table carries `organization_id` NOT NULL, and a system
  // write is stamped with that organization (ADR-0131 D3/D9).
  await kernel.use(createIdentityObjectsPlugin());
  // `sys_user_position`, which the apply's business-unit anchor reads, is
  // SecurityPlugin's — mounted on every real boot of this app, which `requires`
  // `hierarchy-security`. Through 17.x the memory driver answered a read of an
  // undeclared table with an empty list; from 18 the engine refuses the name.
  await kernel.use(new SecurityPlugin());
  await kernel.use(new AppPlugin(stack, undefined, { skipSeedData: true }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  await ensureUsers(data, ['u_b1', 'u_b2', 'u_p1', 'u_p2', 'u_s1']);

  // Through the REAL registration function, so a handler dropped from
  // `registerDulyActionHandlers` surfaces here as the 404 the console gets.
  registerDulyActionHandlers(data);
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── The engine facade ───────────────────────────────────────────────────────

interface Facade {
  insert(object: string, values: AnyRow): Promise<{ id: string }>;
  update(object: string, id: string, values: AnyRow): Promise<void>;
  delete(object: string, id: string): Promise<void>;
  find(object: string, query: AnyRow): Promise<AnyRow[]>;
}

/**
 * The facade the RUNTIME builds, reproduced line for line —
 * `buildActionEngineFacade` in @objectstack/runtime 18.1.0:
 *
 *     const context = { ...executionContext, isSystem: true };
 *     async find(object, query) {
 *       assertActionEngineFindEnvelope(object, query);
 *       const rows = await ql.find(object, { ...query ?? {}, context });
 *
 * `find(object, query)` takes the engine's own query ENVELOPE (since 17.5,
 * #19223) and refuses a key the envelope does not carry. Through 17.4 it took
 * a BARE FILTER and wrapped it itself, which is the shape this double used to
 * reproduce; the handler moved back to `{ where: { … } }` with the upgrade.
 * The refusal is reproduced against the spec's own key set rather than a list
 * copied here, so the double cannot drift from the schema the runtime reads.
 *
 * It is still a double, which is all it can be: the second test below has to
 * put a row in front of the handler that `duly_catalog_item`'s own rules
 * refuse, and only a hand-supplied facade can do that. What a double cannot do
 * is prove the wire shape is right — it encodes the author's belief about it.
 * That proof lives in `test/catalog-engine-facade.test.ts`, which dispatches
 * through the real action route and lets the runtime build its own facade.
 *
 * `catalogItems`, when given, replaces the catalog read with rows handed
 * straight to the handler (unfiltered — the handler re-applies its own
 * `active` filter).
 */
const FACADE_CONTEXT = { userId: 'admin_1', isSystem: true } as const;
const ENVELOPE_KEYS = new Set(Object.keys(EngineQueryOptionsSchema.shape));

function handlerFacade(catalogItems?: AnyRow[]): Facade {
  return {
    insert: async (object, values) => {
      const row = await data.insert(object, values, { context: FACADE_CONTEXT });
      return { id: row?.id ?? values.id };
    },
    update: async (object, id, values) => {
      await data.update(object, values, { where: { id }, context: FACADE_CONTEXT });
    },
    delete: async (object, id) => {
      await data.delete(object, { where: { id }, context: FACADE_CONTEXT });
    },
    find: async (object, query) => {
      if (catalogItems && object === 'duly_catalog_item') return catalogItems.map((r) => ({ ...r }));
      const stray = Object.keys(query ?? {}).filter((key) => !ENVELOPE_KEYS.has(key));
      if (stray.length > 0) throw new Error(`find('${object}'): keys the query envelope does not carry: ${stray.join(', ')}`);
      return data.find(object, { ...(query ?? {}), context: FACADE_CONTEXT });
    },
  };
}

/** Dispatch `duly_catalog_apply` the way the platform dispatcher does. */
async function apply(
  engine: Facade,
  params: { position_code: string; users: string[] },
): Promise<CatalogApplyResult> {
  return (await data.executeAction(GLOBAL_ACTION_OBJECT, CATALOG_APPLY_ACTION, {
    record: {},
    user: { id: 'admin_1' },
    session: { userId: 'admin_1' },
    engine,
    params,
  })) as CatalogApplyResult;
}

/**
 * The suite's own reads and fixture writes, as platform plumbing: with
 * SecurityPlugin mounted a context-less call carries no principal and is
 * refused. None of them is the call under test.
 */
const SYSTEM = { isSystem: true } as const;

const dutiesOf = async (owner: string): Promise<AnyRow[]> =>
  data.find('duly_duty', { where: { owner } }, { context: SYSTEM });

let seq = 0;
const insertItem = async (over: AnyRow): Promise<AnyRow> =>
  data.insert('duly_catalog_item', { name: `Item ${++seq}`, ...over }, { context: SYSTEM });

// ────────────────────────────────────────────────────────────────────────────

describe('duly_catalog_apply — the cadence it replicates (#65)', () => {
  it('copies a recurring item\'s frequency onto every duty it creates', async () => {
    // The positive: whatever the catalog item holds is what every person who
    // takes the role gets. This is the mechanism that turns ONE bad catalog
    // row into N bad duties, and the reason #65's rule is on this object.
    const position = 'apply_positive';
    await insertItem({ position_code: position, form: 'recurring', frequency: 'quarterly' });

    const result = await apply(handlerFacade(), { position_code: position, users: ['u_p1', 'u_p2'] });
    expect(result.created).toBe(2);

    for (const owner of ['u_p1', 'u_p2']) {
      const [duty] = await dutiesOf(owner);
      expect(duty?.form).toBe('recurring');
      expect(duty?.frequency).toBe('quarterly');
      expect(duty?.source).toBe('catalog');
    }
  });

  it('a blank recurring item is replicated as a SILENT monthly — not as N refusals', async () => {
    // The claim #65's issue makes about the downstream half is that each
    // person's duty would "individually trip `duly_duty`'s own
    // `recurring_needs_frequency` on their first save". Measured on
    // @objectstack/runtime 17.2.0, it does not: the handler's insert carries
    // `frequency: null` explicitly, `applyFieldDefaults` reads an explicit
    // null as ABSENT, and the duty is stamped `"monthly"` from its own CEL
    // default before any rule sees it. `duly_duty`'s rule never fires.
    //
    // So the fan-out is not N loud refusals — it is N duties dispatching on a
    // monthly cadence nobody chose, diverged from the catalog that is
    // supposed to define them. That makes the catalog item the LAST place the
    // blank can be caught, not merely the tidiest, which is the whole
    // argument for the rule.
    //
    // The row below is REAL — inserted through the object, so `duly_duty`'s
    // `catalog_item` lookup resolves (a synthetic id is refused outright by
    // `assertReferencesResolve`, which is its own good news) — and only the
    // value #65 now forbids is substituted in transit. That is exactly the
    // state the unrefused UPDATE used to leave behind: same row, same id,
    // frequency gone.
    const real = await insertItem({
      position_code: 'apply_blank',
      form: 'recurring',
      frequency: 'monthly',
    });
    const forbidden: AnyRow = { ...real, frequency: null };

    const result = await apply(handlerFacade([forbidden]), {
      position_code: 'apply_blank',
      users: ['u_b1', 'u_b2'],
    });

    // Nothing refused anything.
    expect(result.created).toBe(2);
    expect(result.entries.every((e) => e.outcome === 'created')).toBe(true);

    for (const owner of ['u_b1', 'u_b2']) {
      const [duty] = await dutiesOf(owner);
      expect(duty?.form).toBe('recurring');
      // The silent divergence, pinned: 'monthly' was never in the catalog.
      expect(duty?.frequency).toBe('monthly');
    }
  });

  it('a standing item applies to standing duties with no cadence at all', async () => {
    // The control against over-firing THROUGH apply. A standing item's blank
    // frequency is required (`standing_no_frequency`), it is copied onto the
    // duty verbatim, and #65's recurring-only rule must stay silent on both
    // objects — a rule that fired here would make the catalog's standing
    // items un-appliable, which is a worse failure than the gap it closes.
    const position = 'apply_standing';
    const item = await insertItem({ position_code: position, form: 'standing' });
    for (const field of CADENCE_FIELDS) expect(item[field] ?? null, field).toBeNull();

    const result = await apply(handlerFacade(), { position_code: position, users: ['u_s1'] });
    expect(result.created).toBe(1);

    const [duty] = await dutiesOf('u_s1');
    expect(duty?.form).toBe('standing');
    for (const field of CADENCE_FIELDS) expect(duty?.[field] ?? null, field).toBeNull();
  });
});
