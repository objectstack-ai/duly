// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePosition } from '@objectstack/spec/identity';

/**
 * The three positions Duly ships. Flat — there is no position tree.
 *
 * ── Why flat, and where the hierarchy actually lives ─────────────────────
 * ADR-0090 D3 finalises ADR-0057 D5: a position is a named DISTRIBUTION
 * point, nothing more. Depth — "my reports", "my unit and below", "the org" —
 * is resolved from the business-unit tree (`sys_business_unit`) and the
 * manager chain (`sys_user.manager_id`), never from a second tree hung off
 * positions. So `duly_manager` is not "above" `duly_member` in any structure
 * the platform reads; it is a different bundle of capability, and the reach
 * of that capability comes from where its holder sits in the org.
 *
 * ── A position declares WHO, never WHAT ──────────────────────────────────
 * `PositionSchema` has no `permissionSets`, no `permissions` and no `users`
 * key, and rejects all three with a named diagnostic. Capability reaches a
 * position only through `sys_position_permission_set` bindings, which are
 * RUNTIME rows an administrator creates in Setup — a package may not declare
 * them and, for a non-anchor position like these three, may not even suggest
 * them. That is a real gap in the authoring surface and it is filed upstream;
 * see `docs/deployment/security.md`, which carries the binding table a
 * rollout has to reproduce by hand.
 *
 * ── `delegatable` stays false on all three ───────────────────────────────
 * Default, and deliberate for `duly_admin`: ADR-0091 D3 forbids an
 * admin-ish position from being self-service delegatable, and the runtime
 * refuses the delegation rather than the authoring, so the only place this
 * gets decided correctly is here.
 */

/**
 * Everyone who owns duties — which, in a Duly deployment, is everyone.
 *
 * Not "the lowest tier". A manager and an administrator are both people with
 * duties of their own, so both hold this position too; their extra sets add
 * reach on top, and the union is what the runtime resolves.
 */
export const MemberPosition = definePosition({
  name: 'duly_member',
  label: 'Team member',
  description:
    'Anyone who owns duties and keeps a work log. Held by every Duly user, including managers and administrators.',
});

/**
 * Anyone with reports or a business unit.
 *
 * Reads down the line and writes nothing there. Assigning is a manager’s
 * only write in this product, and `duly_assignment` is the only object the
 * manager set opens a create/edit bit on.
 */
export const ManagerPosition = definePosition({
  name: 'duly_manager',
  label: 'Manager',
  description:
    'Holds reports or a business unit. Reads their tasks and duties; writes only assignments. Status entry stays with the person who owns the work.',
});

/**
 * Catalog owners and rollout administrators.
 *
 * The position that runs an onboarding: it owns the catalog and holds the two
 * capabilities that gate `duly_catalog_apply` and `duly_catalog_sync`. It is
 * NOT a super-user — it carries no View All / Modify All bit anywhere, and on
 * `duly_log_entry` it reads exactly what everybody else reads: their own rows.
 */
export const AdminPosition = definePosition({
  name: 'duly_admin',
  label: 'Duly administrator',
  description:
    'Owns the catalog and runs rollouts. Not a super-user: no View All / Modify All anywhere, and no widened read on the personal work log.',
});
