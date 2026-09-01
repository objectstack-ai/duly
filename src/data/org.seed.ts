// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { Seed } from '@objectstack/spec/data';

import { ADMIN, PEOPLE, UNITS, emailOf } from './demo-org.js';

/**
 * The org: `sys_business_unit` and `sys_user`.
 *
 * ── Why these two are plain `Seed` literals and not `defineSeed(...)` ─────
 * `defineSeed` infers its record keys from an `ObjectSchema`, and both objects
 * here are the PLATFORM's, declared in `@objectstack/platform-objects`, not in
 * `src/objects/`. There is no schema in this repo to hand it. Inventing a local
 * stand-in to satisfy the signature would be worse than typing the literal: it
 * would read as this app's description of a table it does not own, and would
 * silently stop matching the day the platform adds a column. Every `duly_*`
 * dataset in this directory does use `defineSeed`.
 *
 * Field names are the platform's actual ones (`manager_id`,
 * `primary_business_unit_id`, `manager_user_id`, `parent_business_unit_id`) —
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
 * References FROM a `duly_*` object INTO these two always resolve: the
 * reference is declared on the `duly_*` schema, which this app owns, so the
 * loader looks the target up in the database by name and finds it.
 *
 * References BETWEEN these two — `sys_user.manager_id`,
 * `sys_user.primary_business_unit_id`, `sys_business_unit.manager_user_id` and
 * `parent_business_unit_id` — only resolve where the platform objects are
 * actually registered. Under `objectstack dev` they are (`serve` mounts
 * `PlatformObjectsPlugin`), so the org chart and the manager chain link up.
 * Under the bare `createStandaloneStack` kernel the vitest suites boot, they
 * are not registered at all: the loader finds no field definitions for
 * `sys_user`, builds no reference list for it, and writes the natural key
 * through verbatim. That is why `test/seed.test.ts` asserts the manager chain
 * from THIS module rather than from the seeded rows — the fixture is the
 * contract; what a reference column resolves to is the runtime's business.
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
      primary_business_unit_id: person.unit,
    })),
  ],
};
