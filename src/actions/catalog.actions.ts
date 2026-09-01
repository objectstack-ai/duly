// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec';

import {
  CATALOG_APPLY_ACTION,
  CATALOG_APPLY_TO_PEOPLE_ACTION,
  CATALOG_ITEM_OBJECT,
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
 * ── And why apply ALSO has an object-bound twin ───────────────────────────
 * Honest is not the same as reachable. Onboarding — "apply this customer's
 * existing catalog to these people" — is the adoption path the product lives
 * or dies on, and headless left it with no button at all. The answer is not to
 * make the global action render somewhere it cannot: it is
 * {@link CatalogApplyToPeopleAction}, a SECOND DECLARATION bound to
 * `duly_catalog_item` and placed on that list's toolbar, wired to the SAME
 * handler function. Two placements of one action, never two implementations.
 * `duly_catalog_sync` gets no twin — it rewrites authored cadence on duties
 * people are already working to, org-wide by default, and a one-click button
 * beside the catalog is the wrong affordance for that.
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
 * `duly_catalog_apply_to_people` — the SAME action, on a button.
 *
 * ── The gap this closes ───────────────────────────────────────────────────
 * `duly_catalog_apply` above is object-less, and in protocol 17 an object-less
 * action has no UI home: `global_nav` was retired and every surviving location
 * is object-bound. So the product's single biggest adoption path — "apply the
 * catalog this customer already has to these people" — was reachable only over
 * `POST /api/v1/actions/global/duly_catalog_apply` or MCP. A pilot whose first
 * step is writing curl does not happen.
 *
 * The catalog list IS where an admin is standing when they want this, so the
 * action is bound to `duly_catalog_item` and placed on its `list_toolbar`.
 *
 * ── Spread from the global, deliberately ──────────────────────────────────
 * Everything except the four keys placement actually changes — `params`,
 * `requiredPermissions`, `description`, `icon`, `variant`, `type` — is spread
 * from {@link CatalogApplyAction} rather than restated. Two hand-written copies
 * of a param contract drift, and the drift is silent in the direction that
 * matters: the dispatcher validates the params of the action you CALLED
 * (ADR-0104 D2), so a twin that fell behind would 400 on a dialog the global
 * route accepts, or — worse — quietly stop requiring `users`. `defineAction`
 * deep-copies on parse, so the two declarations share no mutable state.
 *
 * `requiredPermissions` rides that spread on purpose. An object-bound action
 * that skipped the capability its global twin requires would not be a
 * convenience, it would be a bypass: the same 403 gate on the platform action
 * route, and the same hide on the toolbar (objectui's `action:bar` filters its
 * own set through the shared capability gate before placement).
 *
 * ── What this is NOT ──────────────────────────────────────────────────────
 * Not `ai: { exposed: true }`. Arming an agent to bulk-create duties for
 * arbitrary people is a decision to take deliberately, and it belongs to the
 * capability work, not to a card about where a button goes.
 *
 * Not a replacement for the global. `duly_catalog_apply` stays registered and
 * headless: it is what the REST route and MCP use, and nothing about giving
 * the flow a button makes those paths less true.
 *
 * ── Why the input is one dialog and not two steps ─────────────────────────
 * Measured before it was written, because the alternative (select catalog rows
 * in the list, then a modal for the people) is a different action with a
 * different handler contract. A `list_toolbar` action CAN carry this input:
 *
 *  - The spec couples `locations` to nothing — `ActionSchema` has no
 *    refinement relating a location to `params`, and this exact declaration
 *    parses clean.
 *  - Param collection is location-blind: objectui's `ActionRunner.execute`
 *    opens the param dialog on `Array.isArray(action.params) && length > 0`,
 *    before dispatch, with no location gate
 *    (`packages/core/src/actions/ActionRunner.ts`).
 *  - `type: 'user'` + `multiple` really is a multi-person picker on that path:
 *    `resolveActionParams` carries `multiple` through the inline branch,
 *    `paramToField` maps `user` onto the user widget with it, and `UserField`
 *    delegates to `LookupField`, whose multi-select is the picker itself.
 *  - And the bag the dialog submits — `{ position_code, users: [...] }` —
 *    passes the dispatcher's own `validateActionParams`, which refuses a
 *    scalar in `users`. The contract is enforced, not merely declared.
 *
 * So the one-step form is what ships. The two-step fallback would have needed
 * the handler to read `_selectedIds` instead of `position_code` — a second
 * implementation of the thing this action already does.
 */
export const CatalogApplyToPeopleAction = defineAction({
  ...CatalogApplyAction,
  name: CATALOG_APPLY_TO_PEOPLE_ACTION,
  objectName: CATALOG_ITEM_OBJECT,
  // `target` names the registered handler and must move with the name: the
  // engine key is `<object>:<name>`, so this one resolves to
  // `duly_catalog_item:duly_catalog_apply_to_people` — registered in
  // `catalog.handlers.ts` to the very same `applyCatalogHandler` function.
  target: CATALOG_APPLY_TO_PEOPLE_ACTION,
  // Contextual, and the reason the label is not simply inherited: standing on
  // the Role catalog, "Apply role catalog" asks the reader to apply the thing
  // they are already looking at. The choice being made here is WHO.
  label: 'Apply to people',
  locations: ['list_toolbar'],
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
