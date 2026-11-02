// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppPlugin, HttpDispatcher, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import type { HttpProtocolContext } from '@objectstack/runtime';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { SecurityPlugin } from '@objectstack/plugin-security';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';
import { createIdentityObjectsPlugin } from '@objectstack/plugin-auth';

import { dulyActions } from '../src/actions/index.js';
import { registerDulyActionHandlers } from '../src/actions/register-handlers.js';
import {
  CATALOG_APPLY_ACTION,
  CATALOG_APPLY_TO_PEOPLE_ACTION,
} from '../src/actions/catalog.handlers.js';
import type { CatalogApplyOutcome, CatalogApplyResult } from '../src/actions/catalog.handlers.js';
import { ADMIN, PEOPLE, POSITIONS } from '../src/data/demo-org.js';
import { dulyChinese } from '../src/translations/zh-CN.js';

/**
 * #179 — Apply catalog gives every applied DEMO duty its owner's unit.
 *
 * Measured on 18.2.0 before the fix (project file
 * `duly-179-apply-unit/step0.md`): Apply to demo people created 13 duties and
 * all 13 had no business unit. The handler read only the position-assignment
 * anchor, and no demo position assignment is anchored. The demo seed writes
 * its own duties' units directly, which hid the gap.
 *
 * The demo relies on the fallback rather than anchoring its positions: each
 * of the twelve has a primary membership row (`org.seed.ts`), which
 * plugin-sharing projects onto `sys_user.primary_business_unit_id`, the first
 * rung Apply now reads. The account you sign in as has no unit BY DESIGN (a
 * membership row would make the projection hook update the live login
 * account; `test/business-unit-membership.test.ts` pins its absence), so its
 * applied duties stay unanchored — and the run has to say so.
 *
 * Booted with the demo seed through the real action route, so the units come
 * from the same membership rows and the same projection a `pnpm demo` has.
 */

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const SYSTEM = { isSystem: true } as const;

let kernel: any;
let data: any;
let dispatcher: HttpDispatcher;

const all = async (object: string, where?: Record<string, unknown>): Promise<any[]> =>
  (await data.find(object, where ? { where } : {}, { context: SYSTEM })) ?? [];

const settle = async (label: string, check: () => Promise<string | null>, ms = 120_000): Promise<void> => {
  const deadline = Date.now() + ms;
  let last: string | null = 'never evaluated';
  for (;;) {
    last = await check();
    if (last === null) return;
    if (Date.now() > deadline) throw new Error(`${label} did not settle in ${ms}ms — ${last}`);
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
};

beforeAll(async () => {
  // Read at module-evaluation time, so set before the config is imported.
  vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
  const stack = (await import('../objectstack.config.js')).default as unknown as Record<string, unknown>;

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'sqlite',
    databaseUrl: ':memory:',
    skipSeedData: true,
    // Must not resolve to a real path, or a local `pnpm build` makes this suite
    // report on the last BUILD instead of on `src/`.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  await kernel.use(createIdentityObjectsPlugin());
  await kernel.use(new PlatformObjectsPlugin());
  // The projection hook that derives `primary_business_unit_id` from the
  // membership rows, and `sys_user_position`'s owner.
  await kernel.use(new SharingServicePlugin());
  await kernel.use(new SecurityPlugin());
  await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
  await kernel.bootstrap();
  data = kernel.getService('data');
  registerDulyActionHandlers(data);
  dispatcher = new HttpDispatcher(kernel);

  // The inline seed races a budget rather than being awaited by bootstrap:
  // wait for every person's projection, not for a fixed delay.
  await settle('the primary-unit projection', async () => {
    const users = await all('sys_user');
    const projected = PEOPLE.filter((person) =>
      users.some((user) => user.name === person.name && user.primary_business_unit_id));
    return projected.length === PEOPLE.length ? null : `${projected.length} of ${PEOPLE.length} projected`;
  });
  await settle('the catalog seed', async () => {
    const items = await all('duly_catalog_item', { position_code: POSITIONS.compliance });
    return items.length > 0 ? null : 'no catalog items yet';
  });
}, 240_000);

afterAll(async () => {
  await kernel?.shutdown?.();
  vi.unstubAllEnvs();
});

const ADMIN_CALLER: HttpProtocolContext = {
  request: {},
  executionContext: { userId: 'admin_179', systemPermissions: ['duly.catalog.apply'] },
};

describe('Apply catalog on the demo organisation (#179)', () => {
  let result: CatalogApplyResult;
  let userIdOf: Map<string, string>;
  let unitIdOf: Map<string, string>;

  beforeAll(async () => {
    const users = await all('sys_user');
    userIdOf = new Map(users.map((user) => [String(user.name), String(user.id)]));
    unitIdOf = new Map((await all('sys_business_unit')).map((unit) => [String(unit.name), String(unit.id)]));

    // Everyone at once, the admin included, on a position whose items the
    // seed has not already given to most of them.
    const people = [...PEOPLE.map((person) => person.name), ADMIN];
    const response = (await dispatcher.handleActions(
      `/${CATALOG_APPLY_ACTION}`,
      'POST',
      { params: { position_code: POSITIONS.compliance, users: people.map((name) => userIdOf.get(name)) } },
      ADMIN_CALLER,
    )).response;
    expect(response?.status, JSON.stringify(response?.body)).toBe(200);
    result = response?.body?.data as CatalogApplyResult;
  });

  it('creates duties for every demo person', () => {
    const owners = new Set(result.entries.filter((entry) => entry.outcome === 'created').map((entry) => entry.owner));
    for (const person of PEOPLE) expect(owners.has(userIdOf.get(person.name)!), person.name).toBe(true);
  });

  it('anchors every one of the twelve people\'s applied duties in their seeded unit', async () => {
    let anchored = 0;
    for (const person of PEOPLE) {
      const owner = userIdOf.get(person.name)!;
      const unit = unitIdOf.get(person.unit);
      expect(unit, `${person.unit} exists`).toBeTruthy();
      const created = result.entries.filter((entry) => entry.outcome === 'created' && entry.owner === owner);
      for (const entry of created) {
        expect(entry.business_unit, `${person.name} · ${entry.catalog_item_name} (result)`).toBe(unit);
        const [duty] = await all('duly_duty', { id: entry.duty });
        expect(duty?.business_unit, `${person.name} · ${entry.catalog_item_name} (stored)`).toBe(unit);
        anchored += 1;
      }
    }
    // Every created duty that is not the admin's is anchored.
    const admin = userIdOf.get(ADMIN)!;
    expect(anchored).toBe(result.entries.filter((e) => e.outcome === 'created' && e.owner !== admin).length);
    expect(anchored).toBeGreaterThan(0);
  });

  it('leaves the admin\'s duties without a unit, and says so', async () => {
    const admin = userIdOf.get(ADMIN)!;
    const created = result.entries.filter((entry) => entry.outcome === 'created' && entry.owner === admin);
    expect(created.length).toBeGreaterThan(0);
    for (const entry of created) {
      expect(entry.business_unit).toBeNull();
      const [duty] = await all('duly_duty', { id: entry.duty });
      expect(duty?.business_unit ?? null).toBeNull();
    }
    expect(result.outcome).toBe('created_unanchored');
    expect(result.unanchored).toBe(created.length);
    expect(result.unanchored_owners).toEqual([admin]);
  });
});

describe('the toast the console shows for each outcome', () => {
  const OUTCOMES: CatalogApplyOutcome[] = ['created', 'created_unanchored', 'nothing_created'];
  const RESULT_KEYS = new Set<keyof CatalogApplyResult>(['created', 'skipped', 'unanchored']);

  for (const name of [CATALOG_APPLY_ACTION, CATALOG_APPLY_TO_PEOPLE_ACTION]) {
    it(`${name} declares one message per outcome, each reading only real result keys`, () => {
      const action = dulyActions.find((candidate) => candidate.name === name) as { outcomeMessages?: Record<string, string> };
      expect(Object.keys(action.outcomeMessages ?? {}).sort()).toEqual([...OUTCOMES].sort());
      for (const message of Object.values(action.outcomeMessages ?? {})) {
        for (const [, key] of message.matchAll(/\$\{result\.(\w+)\}/g)) {
          expect(RESULT_KEYS.has(key as keyof CatalogApplyResult), `${name}: \${result.${key}}`).toBe(true);
        }
      }
      expect(action.outcomeMessages?.created_unanchored).toContain('${result.unanchored}');
    });
  }

  it('zh-CN carries the same outcomes and placeholders on both addresses', () => {
    const bundle = (dulyChinese as any)['zh-CN'];
    const zh = [
      bundle.globalActions?.[CATALOG_APPLY_ACTION]?.outcomeMessages,
      bundle.objects?.duly_catalog_item?._actions?.[CATALOG_APPLY_TO_PEOPLE_ACTION]?.outcomeMessages,
    ];
    const en = (dulyActions.find((candidate) => candidate.name === CATALOG_APPLY_ACTION) as any).outcomeMessages;
    const placeholders = (text: string) => [...text.matchAll(/\$\{result\.\w+\}/g)].map((m) => m[0]).sort();
    for (const messages of zh) {
      expect(Object.keys(messages ?? {}).sort()).toEqual([...OUTCOMES].sort());
      for (const outcome of OUTCOMES) expect(placeholders(messages[outcome])).toEqual(placeholders(en[outcome]));
    }
  });
});
