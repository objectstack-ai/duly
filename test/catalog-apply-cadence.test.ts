// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';

import stack from '../objectstack.config.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import {
  CADENCE_FIELDS,
  CATALOG_APPLY_ACTION,
  GLOBAL_ACTION_OBJECT,
} from '../src/actions/catalog.handlers.js';
import type { CatalogApplyResult } from '../src/actions/catalog.handlers.js';

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
 * That suite's `FakeEngine` is a Map with a `where` matcher: it runs no
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
}, 180_000);

afterAll(async () => {
  await kernel?.shutdown?.();
});

// ── The two engine facades ──────────────────────────────────────────────────

interface Facade {
  insert(object: string, values: AnyRow): Promise<{ id: string }>;
  update(object: string, id: string, values: AnyRow): Promise<void>;
  delete(object: string, id: string): Promise<void>;
  find(object: string, query: AnyRow): Promise<AnyRow[]>;
}

/**
 * The facade `applyCatalogHandler` is WRITTEN against: `find(object, query)`
 * takes ObjectQL's own query envelope, `where` and all. It is the convention
 * `catalog-instantiate.test.ts`'s `FakeEngine` honours too, so this is the
 * shape every existing assertion about the handler is made under.
 *
 * `catalogItems`, when given, replaces the catalog read with rows handed
 * straight to the handler (unfiltered — the handler re-applies its own
 * `active` filter). That is how a row the object's own rules now REFUSE can
 * still be put in front of the handler, which one test below needs.
 */
function handlerFacade(catalogItems?: AnyRow[]): Facade {
  return {
    insert: async (object, values) => {
      const row = await data.insert(object, values);
      return { id: row?.id };
    },
    update: async (object, id, values) => {
      await data.update(object, values, { where: { id } });
    },
    delete: async (object, id) => {
      await data.delete(object, { where: { id } });
    },
    find: async (object, query) => {
      if (catalogItems && object === 'duly_catalog_item') return catalogItems.map((r) => ({ ...r }));
      return data.find(object, query);
    },
  };
}

/**
 * The facade the RUNTIME actually builds — `buildActionEngineFacade` in
 * @objectstack/runtime 17.2.0, reproduced line for line:
 *
 *     async find(object, query) {
 *       const where = query && Object.keys(query).length ? { where: query } : {};
 *       const rows = await ql.find(object, { ...where, context });
 *       ...
 *
 * It wraps whatever it is handed in a `where` of its own. Used by exactly one
 * test, the tripwire at the bottom.
 */
function runtimeFacade(): Facade {
  const base = handlerFacade();
  return {
    ...base,
    find: async (object, query) => {
      const where = query && Object.keys(query).length ? { where: query } : {};
      return data.find(object, { ...where });
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

const dutiesOf = async (owner: string): Promise<AnyRow[]> =>
  data.find('duly_duty', { where: { owner } });

let seq = 0;
const insertItem = async (over: AnyRow): Promise<AnyRow> =>
  data.insert('duly_catalog_item', { name: `Item ${++seq}`, ...over });

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

// ───────────────────────────────────────────────────────────────────────────
// A tripwire on a filed defect — NOT an assertion that this is correct
// ───────────────────────────────────────────────────────────────────────────
describe('the handler\'s query shape does not survive the runtime\'s own facade', () => {
  /**
   * Measured while covering the apply path for #65 and filed as #79 — a
   * different defect from the missing validation rule, and not fixed here.
   *
   * `applyCatalogHandler` calls `engine.find('duly_catalog_item', { where: …
   * })`. The runtime's `buildActionEngineFacade` wraps whatever it is given:
   * `ql.find(object, { where: query })`. So through the real dispatcher the
   * handler's own `where` becomes `{ where: { where: … } }`, no row has a
   * field called `where`, and the read comes back EMPTY — with no error. The
   * action then reports `{ created: 0 }` and a successful run.
   *
   * Pinned so the seam is visible rather than folklore. When #79 is fixed
   * this goes red: delete this describe block — do not adjust it — and
   * `handlerFacade` above becomes the only convention in the file.
   */
  it('finds nothing, creates nothing, and reports success', async () => {
    const position = 'apply_runtime_facade';
    await insertItem({ position_code: position, form: 'recurring', frequency: 'weekly' });

    // Same item, same params, the only difference being which facade.
    const viaHandlerConvention = await apply(handlerFacade(), {
      position_code: position,
      users: ['u_f1'],
    });
    expect(viaHandlerConvention.catalog_items).toBe(1);
    expect(viaHandlerConvention.created).toBe(1);

    const viaRuntime = await apply(runtimeFacade(), { position_code: position, users: ['u_f2'] });
    expect(viaRuntime.catalog_items).toBe(0);
    expect(viaRuntime.created).toBe(0);
    expect(await dutiesOf('u_f2')).toEqual([]);
  });
});
