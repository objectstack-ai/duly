// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec';

import {
  CATALOG_APPLY_ACTION,
  CATALOG_SYNC_ACTION,
} from './catalog.handlers.js';

/**
 * Catalog instantiation — the onboarding path.
 *
 * Customers arrive with their catalog already written, usually as a
 * spreadsheet. Taking a position has to mean "apply the list", not "hand-type
 * 26 duties", or the rollout dies in week one.
 *
 * ── Why these are OBJECT-LESS and headless ────────────────────────────────
 * Neither action operates on a record: `duly_catalog_apply` reads a whole
 * position's worth of `duly_catalog_item` rows and writes `duly_duty` rows for
 * several people at once. That makes it a GLOBAL action — no `objectName` — and
 * an object-less action in protocol 17 has no UI home to declare.
 * `global_nav` was removed from `ACTION_LOCATIONS` in @objectstack/spec 17
 * (#6888, ADR-0049 enforce-or-remove): the console's ⌘K palette reads no action
 * metadata, so the location never rendered. Every surviving location
 * (`list_toolbar`, `list_item`, `record_*`) is bound to an object.
 *
 * So `locations: []` is the honest declaration the spec itself prescribes for
 * this case — it keeps the param contract, the capability gate and the audit
 * trail, and the action is invoked over the platform action route
 * (`POST /api/v1/actions/global/duly_catalog_apply`) or MCP rather than from a
 * button. Declaring a location a renderer does not serve would be the
 * ADR-0078 declares-renders-does-nothing shape.
 *
 * ── Why `type: 'script'` with a `target` and no `body` ────────────────────
 * The cadence maths and the idempotency probe are real code with real tests,
 * not a sandboxed L1/L2 snippet. `target` names the handler registered from
 * `src/actions/register-handlers.ts`; a `script` action with neither `body`
 * nor `target` is rejected at author time precisely because it would otherwise
 * render, be clickable, and 404 at call time.
 */

/**
 * `duly_catalog_apply` — instantiate a position's catalog onto people.
 *
 * `position_code` is free text on purpose: a customer can load their catalog on
 * day one, before positions are modelled in the platform, so this deliberately
 * does NOT pick from `sys_position` and does NOT require a `sys_user_position`
 * row to exist for the selected people.
 */
export const CatalogApplyAction = defineAction({
  name: CATALOG_APPLY_ACTION,
  label: 'Apply role catalog',
  // Dialog copy, not the confirm prompt: an action that collects params and
  // also sets `confirmText` shows two dialogs for one decision (#7278). The
  // question is asked here, and the user's own Confirm sends it.
  description:
    'Create the duties this position owes for each person selected. Runs again safely — anyone who already has a duty from a catalog item is skipped, not duplicated.',
  icon: 'user-plus',
  type: 'script',
  target: CATALOG_APPLY_ACTION,
  locations: [],
  variant: 'primary',
  // [ADR-0066 D4] The ONLY boundary this action has. The handler runs against
  // `ctx.engine`, the trusted facade — context-less and RLS/FLS-bypassing by
  // design — so object permissions never see the write. Ungated, anyone who
  // could reach the route could mint a duty for any `sys_user` id they typed,
  // in bulk. Granted by the `duly_admin` permission set (src/security/).
  requiredPermissions: ['duly.catalog.apply'],
  params: [
    {
      name: 'position_code',
      label: 'Position',
      type: 'text',
      required: true,
      placeholder: 'plant_compliance_officer',
      helpText:
        'Matches duly_catalog_item.position_code exactly. Free text — the position does not have to be modelled in the platform yet.',
    },
    {
      name: 'users',
      label: 'People',
      type: 'user',
      multiple: true,
      required: true,
      helpText: 'Each person gets their own copy of every active duty in this position\'s catalog.',
    },
  ],
});

/**
 * `duly_catalog_sync` — replay catalog cadence edits onto instantiated duties.
 *
 * Cadence only (`frequency`, `due_anchor`, `due_offset_days`, `lead_days`,
 * `grace_days`). `owner`, `status`, `timezone` and the `effective_*` window are
 * local decisions the catalog has no business overwriting, and a retired
 * catalog item is REPORTED rather than acted on — deleting someone's duties
 * because a template was deactivated is a decision for a human.
 *
 * `position_code` is optional here and narrows the sweep. Sync rewrites
 * authored cadence, so being able to run it for one position instead of the
 * whole org is the difference between a correction and an incident.
 */
export const CatalogSyncAction = defineAction({
  name: CATALOG_SYNC_ACTION,
  label: 'Sync duties from catalog',
  description:
    'Replay cadence changes from the role catalog onto the duties created from it. Owner, status, timezone and the effective window are left alone; duties from a deactivated catalog item are reported, never deleted.',
  icon: 'refresh-cw',
  type: 'script',
  target: CATALOG_SYNC_ACTION,
  locations: [],
  // [ADR-0066 D4] A SEPARATE capability from apply, though `duly_admin` grants
  // both. Applying a catalog to a new hire is onboarding; syncing rewrites
  // authored cadence on duties people are already working to — org-wide when
  // `position_code` is omitted — and is reportable only after the fact. Two
  // strings cost nothing and let a deployment hand out the first without the
  // second; one merged string would make that distinction unexpressible.
  requiredPermissions: ['duly.catalog.sync'],
  params: [
    {
      name: 'position_code',
      label: 'Position',
      type: 'text',
      required: false,
      placeholder: 'plant_compliance_officer',
      helpText: 'Limit the sync to one position. Leave blank to sync every catalog-sourced duty.',
    },
  ],
});
