// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Seed } from '@objectstack/spec/data';

import { ADMIN, PEOPLE, UNITS, emailOf } from './demo-org.js';

/**
 * The org: `sys_business_unit`, `sys_user`, and the membership junction
 * between them.
 *
 * ── Why these are plain `Seed` literals and not `defineSeed(...)` ─────────
 * `defineSeed` infers its record keys from an `ObjectSchema`, and all three
 * objects here are the PLATFORM's, declared in `@objectstack/platform-objects`,
 * not in `src/objects/`. There is no schema in this repo to hand it. Inventing
 * a local stand-in to satisfy the signature would be worse than typing the
 * literal: it would read as this app's description of a table it does not own,
 * and would silently stop matching the day the platform adds a column. Every
 * `duly_*` dataset in this directory does use `defineSeed`.
 *
 * Field names are the platform's actual ones (`manager_id`, `manager_user_id`,
 * `parent_business_unit_id`, `user_id`, `business_unit_id`, `is_primary`) —
 * not guesses. `sys_user` has no `username` column, so there is none here.
 *
 * ── These must be seeded FIRST, and it is not a style preference ──────────
 * `duly_task.owner` and `duly_duty.owner` are `Field.user` references, and the
 * seed loader resolves them as NATURAL KEYS against `sys_user.name`. A name
 * that matches no row does not resolve; `owner` is `required: true`; the whole
 * task row is refused with `Owner is required`. Measured on #32: without the
 * user dataset, `inserted: 0, errored: 4`. The loader's own topological sort
 * puts these ahead of `duly_*` anyway (both are reference targets), but the
 * barrel lists them first so the ordering is legible without knowing that.
 *
 * ── One asymmetry worth knowing before you read a test ────────────────────
 * References FROM a `duly_*` object INTO these objects always resolve: the
 * reference is declared on the `duly_*` schema, which this app owns, so the
 * loader looks the target up in the database by name and finds it.
 *
 * References BETWEEN the platform objects — `sys_user.manager_id`,
 * `sys_business_unit.manager_user_id`, `parent_business_unit_id`, and the
 * junction's `user_id` / `business_unit_id` — only resolve where the platform
 * objects are actually registered. Under `objectstack dev` they are (`serve`
 * mounts `PlatformObjectsPlugin`, and `sharing` is in
 * `PLATFORM_ALWAYS_ON_CAPABILITIES` so `SharingServicePlugin` is mounted too),
 * so the org chart, the manager chain and the membership rows all link up.
 * Under the bare `createStandaloneStack` kernel most vitest suites boot, they
 * are not registered at all: the loader finds no field definitions for
 * `sys_user`, builds no reference list for it, and writes the natural key
 * through verbatim. That is why `test/seed.test.ts` asserts the manager chain
 * from THIS module rather than from the seeded rows — the fixture is the
 * contract; what a reference column resolves to is the runtime's business.
 * `test/business-unit-membership.test.ts` is the suite that boots the two
 * platform plugins on purpose, because the value it reads back is one only
 * they compute.
 */

/** Three levels: one company, three sites, two teams under one of them. */
export const businessUnitSeed: Seed = {
  object: 'sys_business_unit',
  externalId: 'name',
  // Re-running the seed over a populated database must not duplicate. `upsert`
  // matches on the natural key above and updates in place; the loader's
  // no-op-replay check skips the write entirely when nothing has changed.
  mode: 'upsert',
  records: UNITS.map((unit) => ({
    name: unit.name,
    code: unit.code,
    kind: unit.kind,
    parent_business_unit_id: unit.parent,
    // Set at EVERY level, which is the point of seeding a tree at all: an
    // ADR-0057 hierarchy scope has nothing to resolve against a tree whose
    // nodes have no head.
    manager_user_id: unit.manager,
    active: true,
  })),
};

/**
 * Twelve people, plus the account you are logged in as.
 *
 * ⚠️ The `Dev Admin` row carries its natural key and nothing else. On a real
 * `objectstack dev` boot that account already exists — `plugin-auth` seeds it
 * before the app plugin starts — so the loader matches it by name, finds the
 * one field the seed declares unchanged, and SKIPS without writing. Adding an
 * `email` or a `manager_id` here would turn that skip into an UPDATE against a
 * live credential-bearing account. See `demo-org.ts` for the full reasoning.
 *
 * ── `manager_id` is written directly; `primary_business_unit_id` is NOT ────
 * Both columns are `readonly: true` on `sys_user`, and reading that as one
 * fact is the mistake #74 was filed about. `readonly` marks two different
 * things and only one of them fights back:
 *
 *  - **`primary_business_unit_id` is a projection another component owns.**
 *    `@objectstack/plugin-sharing` recomputes it from
 *    `sys_business_unit_member.is_primary` — `primary-bu-projection.ts` binds
 *    afterInsert/afterUpdate/afterDelete hooks on the junction and runs a
 *    `backfillPrimaryBu` sweep at every plugin start (ADR-0057 addendum D12).
 *    Those hooks fire for system-context writes too, deliberately: "the
 *    projection must stay correct regardless of who mutates membership
 *    (seeds, HRIS sync, admin UI)". So this seed writes the SOURCE — see
 *    {@link businessUnitMemberSeed} — and lets the platform derive the
 *    column. It is not declared here at all.
 *  - **`manager_id` is a projection of nothing.** It is `readonly` because
 *    org-structure maintenance is its own admin surface (ADR-0092 —
 *    `SYS_USER_PROFILE_EDIT_FIELDS` deliberately excludes it), not because
 *    something recomputes it. Measured on `@objectstack/*` 17.2.0: the only
 *    writes to `sys_user.primary_business_unit_id` anywhere in the platform
 *    are the two `engine.update` calls in `primary-bu-projection.ts`, and
 *    there is NO writer of `manager_id` at all — every occurrence in the
 *    plugins is a read (`fields: ['id', 'manager_id']` in
 *    `business-unit-graph.ts`, `team-graph.ts`, `approval-service.ts`). So
 *    the direct system-context write below is the sanctioned way to seed it,
 *    and there is no junction to write instead.
 */
export const userSeed: Seed = {
  object: 'sys_user',
  externalId: 'name',
  mode: 'upsert',
  records: [
    { name: ADMIN },
    ...PEOPLE.map((person) => ({
      name: person.name,
      email: emailOf(person.name),
      manager_id: person.manager,
    })),
  ],
};

/**
 * Which unit each person belongs to — the SOURCE `sys_user.
 * primary_business_unit_id` is derived from.
 *
 * ── Why this dataset exists at all ────────────────────────────────────────
 * Before #74 the seed set `sys_user.primary_business_unit_id` directly and
 * left this junction empty. That worked, and the reason it worked is the
 * reason it had to change: plugin-sharing recomputes the projection from
 * `sys_business_unit_member`, our table had zero rows, so no hook ever fired
 * and the hand-written value simply survived. The app looked correct because
 * the mechanism that would correct it had never been triggered. Two ways that
 * ends, neither of them loud:
 *
 *  - Someone writes a membership row — console, import, a later feature, a
 *    customer's own setup — and the hook recomputes THAT user's projection
 *    from the junction. The seeded value is replaced by whatever the junction
 *    says, or cleared when the new row is not primary. `assignment.flow.ts`
 *    reads `primary_business_unit_id` to stamp `duly_task.business_unit` on
 *    fan-out, so a cleared projection silently stamps nothing.
 *  - Anything resolving people THROUGH membership rather than through the
 *    projection sees nobody in any unit — sharing rules and hierarchy scopes
 *    being the obvious candidates. Our permission sets happen to read the
 *    projection today, which is luck, not design.
 *
 * ── Twelve rows, not thirteen ─────────────────────────────────────────────
 * `Dev Admin` gets no membership row, for the same reason their `sys_user`
 * row carries nothing but a name: a membership row would make the projection
 * hook UPDATE the live credential-bearing account. The reachable state is
 * unchanged from before this dataset existed — twelve users with a primary
 * unit, the admin without one — which is what makes this a change of
 * MECHANISM and not of data.
 *
 * ── The composite external id is what makes a replay idempotent ───────────
 * `sys_business_unit_member` has no single-column natural key (no `name`, and
 * its unique index is `(business_unit_id, user_id)`), so the dataset is keyed
 * on both foreign keys — the spelling `Seed.externalId` documents for exactly
 * this case: "a join / junction table keyed by both of its foreign keys …
 * The reference fields are matched by their RESOLVED ids, so a composite of
 * foreign keys dedupes correctly across restarts." With a single-field key
 * (or none) the dataset would fall back to `mode: 'insert'` semantics and
 * duplicate the whole table on every boot.
 *
 * `is_primary` is stated on every row even though the platform defaults it to
 * `true`: it is the exact flag the projection reads, and a seed that leaned
 * on the default would leave the one load-bearing column implicit.
 */
export const businessUnitMemberSeed: Seed = {
  object: 'sys_business_unit_member',
  externalId: ['user_id', 'business_unit_id'],
  mode: 'upsert',
  records: PEOPLE.map((person) => ({
    user_id: person.name,
    business_unit_id: person.unit,
    is_primary: true,
  })),
};
