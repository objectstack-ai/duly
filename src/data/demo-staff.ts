// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The demo's twelve people, as accounts that can sign in (#131).
 *
 * `defineStack({ demoStaff })` is the platform's own answer to "the seed deals
 * work to people, so the people have to exist first" (objectstack#25830,
 * shipped in `@objectstack/*` 18.2.0). On an `objectstack dev` boot,
 * `@objectstack/plugin-auth` creates each entry at `kernel:ready`, through the
 * real sign-up pipeline, with the development seed password (`admin123` by
 * default), AFTER it has minted the development admin. And because a
 * declaration is present, the app's inline seed is deferred to
 * `kernel:bootstrapped`, which is what makes `pnpm demo` one boot:
 *
 *  - The admin and the twelve exist before the seed runs, so the seed's
 *    `sys_user` rows, keyed on `name`, land on those live accounts instead of
 *    inserting credential-less copies of them.
 *  - Without a declaration the seed runs first, as it always did, and the
 *    admin is minted afterwards as a SECOND row. The demo account's own
 *    duties, tasks, assignment and work log then belong to a person nobody can
 *    sign in as: measured on 17.3.0 for #131 (23 tasks, 6 duties, 8 log
 *    entries, 1 assignment on the ghost row). The two-boot script was the
 *    workaround; this declaration replaces it.
 *
 * ── Development only, end to end ─────────────────────────────────────────
 * Each entry signs in with a password everybody knows, so the platform keeps
 * the key out of every artifact (`os build` deletes it) and provisions it on a
 * local development boot only. This module adds one more gate of its own: the
 * list is empty unless the demo was asked for (`DULY_DEMO_SEED`, read in
 * `index.ts`), so `pnpm dev` stays a zero-user database that mints only the
 * admin, exactly as it did before.
 *
 * ── Why the admin is NOT an entry ────────────────────────────────────────
 * The account you sign in as is the platform's development admin, minted by
 * `maybeSeedDevAdmin` (its name comes from `OS_SEED_ADMIN_NAME`, which
 * `scripts/demo.mjs` sets to {@link ADMIN}). Listing it here as well would
 * switch every demo account off: plugin-auth provisions `demoStaff` only once
 * some account OUTSIDE the list can already sign in, so that the first login
 * (which becomes platform admin) is never a demo account. With the admin's
 * address in the list there is no such account and the twelve are refused.
 * The admin's Duly sets stay in `adminPermissionSetSeed` (`org.seed.ts`).
 *
 * ── What each account holds ──────────────────────────────────────────────
 * Everyone owns duties, so everyone holds the `duly_member` position and
 * permission set. The five who have reports hold `duly_manager` instead as
 * their position, and the manager set on top of the member set. Positions
 * carry no capability by themselves (see `src/security/positions.ts`), so the
 * sets are what let a demo person sign in at all.
 *
 * ⚠️ Signing in as one of them does NOT yet show their own week. Measured on
 * 18.2.0 for #131: `duly_member` reads `own` rows, the platform resolves "own"
 * through `owner_id` rather than Duly's `owner` field, and the seed's rows
 * carry the admin's `owner_id`, so a demo person reads 0 tasks. That is the
 * open decision in duly#143, unchanged by this declaration; the account the
 * demo is built around remains the admin.
 */

import type { DemoStaff } from '@objectstack/spec/system';

import { ManagerPosition, MemberPosition } from '../security/positions.js';
import { ManagerPermissionSet, MemberPermissionSet } from '../security/permission-sets.js';
import { PEOPLE } from './demo-org.js';

const MANAGERS = new Set(PEOPLE.map((person) => person.manager).filter((name): name is string => name !== null));

/** The twelve, in this compile's language. `name` is what the seed's references resolve on. */
export const DEMO_STAFF: DemoStaff[] = PEOPLE.map((person) => {
  const manages = MANAGERS.has(person.name);
  return {
    name: person.name,
    email: person.email,
    position: manages ? ManagerPosition.name : MemberPosition.name,
    permissionSets: manages
      ? [MemberPermissionSet.name, ManagerPermissionSet.name]
      : [MemberPermissionSet.name],
  };
});
