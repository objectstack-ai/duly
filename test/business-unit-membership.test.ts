// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { AppPlugin, ObjectKernel, createStandaloneStack } from '@objectstack/runtime';
import { PlatformObjectsPlugin } from '@objectstack/platform-objects/plugin';
import { SharingServicePlugin } from '@objectstack/plugin-sharing';

import { PEOPLE } from '../src/data/demo-org.js';
import { businessUnitMemberSeed, userSeed } from '../src/data/org.seed.js';

/**
 * `sys_user.primary_business_unit_id` is DERIVED, and this suite is the one
 * that proves it.
 *
 * ── Why this file exists apart from `test/seed.test.ts` ───────────────────
 * Every other suite boots the bare `createStandaloneStack` kernel, which
 * mounts exactly three plugins — datasource, metadata, objectql. Neither
 * `@objectstack/platform-objects` (which declares `sys_user` and
 * `sys_business_unit_member`) nor `@objectstack/plugin-sharing` (which owns
 * the projection) is in it, so in those suites the platform tables are
 * schemaless memory collections and nothing computes anything: the seed's
 * natural keys are written through verbatim and read back unchanged.
 *
 * That is fine for what those suites assert, and useless for this one. A real
 * `objectstack dev` boot mounts BOTH — `serve` auto-registers
 * `PlatformObjectsPlugin`, and `sharing` is in
 * `PLATFORM_ALWAYS_ON_CAPABILITIES` so `SharingServicePlugin` is mounted
 * whether or not the app names it in `requires`. This suite mounts the same
 * two, because the value under test is one only they produce.
 *
 * ── The assertion that decides whether the fix is real ────────────────────
 * The defect (#74) was that the seed wrote `sys_user.primary_business_unit_id`
 * directly and left `sys_business_unit_member` empty. That seed passes any
 * test that reads the column back and compares it to what the seed said — the
 * value is there, it is correct, and it is correct for the wrong reason: no
 * membership row has ever existed, so the recompute hook has never fired.
 *
 * So `follows the junction` below does not read the seeded value at all. It
 * MOVES a membership row to another business unit and asserts the projection
 * moves with it, then moves it back and asserts it comes back. Nothing a seed
 * writes can satisfy that; only a live hook can. It is the same property
 * `packages/qa/dogfood/test/primary-bu-projection.dogfood.test.ts` asserts
 * upstream, restated against this app's own data.
 */

const DEMO_SEED_ENV_VAR = 'DULY_DEMO_SEED';
const SYSTEM = { isSystem: true } as const;

let kernel: any;
let data: any;

const all = async (object: string): Promise<any[]> =>
  (await data.find(object, {}, { context: SYSTEM })) ?? [];

const one = async (object: string, where: Record<string, unknown>): Promise<any> => {
  const rows = (await data.find(object, { where }, { context: SYSTEM })) ?? [];
  expect(rows.length, `exactly one ${object} matching ${JSON.stringify(where)}`).toBe(1);
  return rows[0];
};

/** Poll until `check` is true, or fail naming what was actually observed. */
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
  // The demo is opt-in and the gate is read at module-evaluation time, so the
  // variable must be set before anything imports the config. Same reasoning,
  // and the same literal, as `test/seed.test.ts`.
  vi.stubEnv(DEMO_SEED_ENV_VAR, '1');
  const stack = (await import('../objectstack.config.js')).default as unknown as Record<string, unknown>;

  const { plugins } = await createStandaloneStack({
    databaseDriver: 'memory',
    skipSeedData: true,
    // Point the artifact lookup at a path that cannot exist, or a local
    // `pnpm build` leaves `dist/objectstack.json` where the kernel loads
    // metadata from the last BUILD rather than from the config imported above.
    artifactPath: 'dist/objectstack.this-suite-must-not-load-an-artifact.json',
  });
  kernel = new ObjectKernel();
  for (const plugin of plugins) await kernel.use(plugin);
  // The two the bare standalone stack leaves out, in the order `serve` mounts
  // them: the object declarations first, then the plugin whose hooks act on
  // them.
  await kernel.use(new PlatformObjectsPlugin());
  await kernel.use(new SharingServicePlugin());
  await kernel.use(new AppPlugin(stack as any, undefined, { skipSeedData: false }));
  await kernel.bootstrap();
  data = kernel.getService('data');

  // The inline seed is raced against a budget rather than awaited by
  // bootstrap, so wait for the junction to be fully populated rather than for
  // a fixed delay.
  await settle('the membership seed', async () => {
    const rows = await all('sys_business_unit_member');
    return rows.length >= PEOPLE.length ? null : `${rows.length} of ${PEOPLE.length} member rows`;
  });
}, 240_000);

afterAll(async () => {
  await kernel?.shutdown?.();
  vi.unstubAllEnvs();
});

// ───────────────────────────────────────────────────────────────────────────
describe('the seed writes membership, not the projection', () => {
  it('declares no primary_business_unit_id anywhere in the user dataset', () => {
    // The direct write is the defect. A seed record carrying this column would
    // land — the loader writes under `{ isSystem: true }`, which exempts it
    // from the readonly strip — and would then be silently replaced the first
    // time anything touched that user's membership. Absence is the fix, so
    // absence is what is pinned.
    const offenders = (userSeed.records as Record<string, unknown>[]).filter(
      (record) => 'primary_business_unit_id' in record,
    );
    expect(offenders.map((record) => record.name)).toEqual([]);
  });

  it('writes one primary membership row per person, and none for the admin', async () => {
    const members = await all('sys_business_unit_member');
    expect(members.length, 'one row per person in PEOPLE').toBe(PEOPLE.length);
    expect(members.every((row) => row.is_primary === true), 'every seeded row is the primary one').toBe(true);
    // One row per user, or "the primary one" is not a single answer.
    expect(new Set(members.map((row) => String(row.user_id))).size).toBe(PEOPLE.length);
    // `Dev Admin` is deliberately absent: a membership row for them would make
    // the projection hook UPDATE the live credential-bearing account, which is
    // the one thing `userSeed` is shaped to avoid. See `org.seed.ts`.
    expect(businessUnitMemberSeed.records.length).toBe(PEOPLE.length);
  });
});

// ───────────────────────────────────────────────────────────────────────────
describe('the projection is derived from it', () => {
  it('every person reads back the unit their membership row names', async () => {
    // Read BOTH sides out of the database and compare them to each other —
    // never to the fixture. The fixture is what the seed said; these two rows
    // are what the platform did with it.
    for (const person of PEOPLE) {
      const user = await one('sys_user', { name: person.name });
      const member = await one('sys_business_unit_member', { user_id: String(user.id) });
      expect(
        String(user.primary_business_unit_id ?? ''),
        `${person.name}: projection vs membership`,
      ).toBe(String(member.business_unit_id));
      // And it is the unit the fixture meant — otherwise both sides could
      // agree on a wrong value.
      const unit = await one('sys_business_unit', { id: String(member.business_unit_id) });
      expect(unit.name, `${person.name}'s unit`).toBe(person.unit);
    }
  });

  it('follows the junction when a membership moves, and back again', async () => {
    // The assertion the old seed could not have passed. Nothing here reads a
    // seeded value: the projection is compared against a membership row this
    // test moves at runtime, so it can only match if plugin-sharing's
    // afterUpdate hook recomputed it.
    const person = PEOPLE.find((candidate) => candidate.manager)!;
    const user = await one('sys_user', { name: person.name });
    // Captured before the move; asserted unchanged after it. See the
    // `manager_id` describe below for why that half is here at all.
    const managerBefore = user.manager_id ?? null;
    const member = await one('sys_business_unit_member', { user_id: String(user.id) });
    const home = String(member.business_unit_id);

    const elsewhere = (await all('sys_business_unit')).find((unit) => String(unit.id) !== home);
    expect(elsewhere, 'the fixture must contain a second unit to move to').toBeTruthy();
    const away = String(elsewhere.id);
    expect(away).not.toBe(home);

    const readProjection = async (): Promise<string> =>
      String((await one('sys_user', { name: person.name })).primary_business_unit_id ?? '');

    // Baseline, so a projection that was ALREADY `away` cannot read as a pass.
    expect(await readProjection(), 'baseline before the move').toBe(home);

    try {
      await data.update(
        'sys_business_unit_member',
        { id: String(member.id), business_unit_id: away },
        { context: SYSTEM },
      );
      await settle('the projection after the move', async () => {
        const now = await readProjection();
        return now === away ? null : `still ${now || '(empty)'}, expected ${away}`;
      }, 30_000);
    } finally {
      // Restore, and assert the restore — the projection following BOTH ways
      // is the difference between a live hook and a one-off coincidence, and
      // leaving the row moved would hand every later assertion a mutated tree.
      await data.update(
        'sys_business_unit_member',
        { id: String(member.id), business_unit_id: home },
        { context: SYSTEM },
      );
    }
    await settle('the projection after the restore', async () => {
      const now = await readProjection();
      return now === home ? null : `still ${now || '(empty)'}, expected ${home}`;
    }, 30_000);

    // The other half of the same observation: `manager_id` sat through both
    // moves untouched. One membership write moved one column and not the
    // other, in one kernel, at one moment — which is the difference between
    // the two `readonly` columns stated as a measurement rather than as a
    // claim about the platform's source.
    const after = await one('sys_user', { name: person.name });
    expect(after.manager_id ?? null, 'manager_id is not a projection of membership').toEqual(managerBefore);
  }, 120_000);
});

// ───────────────────────────────────────────────────────────────────────────
describe('manager_id is NOT the same kind of column', () => {
  it('is still declared by the seed, and primary_business_unit_id is not', () => {
    // Both columns are `readonly: true` on `sys_user`, and reading that as one
    // fact is exactly the inference #74 was filed about. `manager_id` is
    // readonly because org-structure maintenance is its own admin surface
    // (ADR-0092 — `SYS_USER_PROFILE_EDIT_FIELDS` excludes it), not because
    // anything recomputes it: measured on `@objectstack/*` 17.2.0, the only
    // writes to `primary_business_unit_id` in the whole platform are the two
    // `engine.update` calls in plugin-sharing's `primary-bu-projection.ts`,
    // and there is NO writer of `manager_id` anywhere — every occurrence in
    // the plugins is a read. So one of these columns is seeded through its
    // source table and the other is seeded directly, and that asymmetry is
    // deliberate.
    const declared = (userSeed.records as Record<string, unknown>[])
      .filter((record) => record.name !== 'Dev Admin');
    expect(declared.length).toBe(PEOPLE.length);
    expect(declared.every((record) => 'manager_id' in record), 'manager_id is written directly').toBe(true);
    expect(declared.some((record) => 'primary_business_unit_id' in record), 'the projection is not').toBe(false);
  });

  it('lands on the row, with the top of the chain terminating', async () => {
    // ⚠️ What `manager_id` HOLDS here is not asserted, and the omission is the
    // point. This kernel mounts `PlatformObjectsPlugin` and
    // `SharingServicePlugin`, which between them declare
    // `sys_business_unit_member` — so the junction's `user_id` /
    // `business_unit_id` resolve to real ids above. Neither declares
    // `sys_user` (that is `plugin-auth`, on a real `objectstack dev` boot),
    // so the loader builds no reference list for it and writes `manager_id`'s
    // natural key through VERBATIM here. `test/seed.test.ts` states the same
    // boundary: the fixture is the contract, and what a reference column
    // resolves to is the runtime's business. `pnpm demo` is where the
    // resolved chain is measured.
    //
    // What IS asserted is the part that holds in every kernel: the column is
    // populated for everyone who has a manager, and empty for the one person
    // who does not.
    const managed = PEOPLE.filter((person) => person.manager);
    expect(managed.length).toBeGreaterThanOrEqual(10);
    for (const person of managed) {
      const user = await one('sys_user', { name: person.name });
      expect(Boolean(user.manager_id), `${person.name} carries a manager`).toBe(true);
    }
    const top = await one('sys_user', { name: PEOPLE.find((person) => !person.manager)!.name });
    expect(top.manager_id ?? null, 'the chain terminates rather than pointing at itself').toBeNull();
  });
});
