// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { ActionEngineFacade, ActionHandler } from '@objectstack/spec/ui';

import type { HandlerRegistrationContext } from './register-handlers.js';

/**
 * Runtime handlers for the catalog-instantiation actions.
 *
 * Action METADATA (`catalog.actions.ts`) declares the button and the param
 * contract; THIS is the code that runs. The two are joined only by name, at
 * registration time — an action whose handler is not registered renders, is
 * clickable, and fails at call time with `Action '<name>' on object 'global'
 * not found`. `pnpm validate` cannot see that, so the wiring is asserted in
 * `test/catalog-instantiate.test.ts` instead.
 */

/** Action names. Exported so the metadata, the wiring and the tests agree by construction. */
export const CATALOG_APPLY_ACTION = 'duly_catalog_apply';
export const CATALOG_SYNC_ACTION = 'duly_catalog_sync';

/**
 * The OBJECT-BOUND twin of `duly_catalog_apply` — the same action, given a
 * place to be clicked. See `catalog.actions.ts` for why it exists and what it
 * is deliberately not.
 *
 * A DISTINCT name, not a second declaration of `duly_catalog_apply`, and that
 * is measured rather than stylistic: `defineStack` accepts two actions sharing
 * one `name` without a word — both survive into `stack.actions`, and it does
 * so even for two GLOBAL actions, where the `<object>:<name>` handler map then
 * has one silently shadow the other. Reported upstream rather than relied on.
 */
export const CATALOG_APPLY_TO_PEOPLE_ACTION = 'duly_catalog_apply_to_people';

/**
 * The object the twin binds to — and therefore the engine key its handler
 * registers under. `executeAction` is an exact-string `Map` lookup on
 * `<object>:<name>` and tries the action's OWN object before `global`, so an
 * object-bound action's handler filed under `global` is unreachable.
 */
export const CATALOG_ITEM_OBJECT = 'duly_catalog_item';

/**
 * The engine object key an object-less action registers under.
 *
 * `'global'` is the CANONICAL object-less key, not a wildcard: `executeAction`
 * is an exact-string `Map` lookup on `<object>:<name>`, so a handler filed
 * under anything else is unreachable no matter how the action is declared.
 */
export const GLOBAL_ACTION_OBJECT = 'global';

/**
 * The cadence fields the catalog owns, and the complete list of what `sync`
 * is allowed to write.
 *
 * Everything absent from this tuple is a LOCAL decision: `owner` (who actually
 * holds the duty), `status` (paused because the person is on leave),
 * `timezone`, and the `effective_*` window. A catalog edit must not silently
 * un-pause a duty or move it to someone else, so `sync` builds its patch from
 * this tuple alone rather than diffing whole records.
 */
export const CADENCE_FIELDS = [
  'frequency',
  'due_anchor',
  'due_offset_days',
  'lead_days',
  'grace_days',
] as const;

export type CadenceField = (typeof CADENCE_FIELDS)[number];

/**
 * Duty timezone for a newly instantiated duty.
 *
 * The mapping this implements is "the user's zone if resolvable, else the org
 * default, else UTC". Measured against @objectstack/spec 17.2.0 and
 * @objectstack/platform-objects 17.2.0, the first two rungs do not exist for an
 * action handler to read, so this resolves to the third:
 *
 *  1. THE USER'S ZONE — there is no such field. `sys_user` declares
 *     `name, email, email_verified, two_factor_enabled, role, banned,
 *     ban_reason, ban_expires, failed_login_count, locked_until,
 *     password_changed_at, phone_number, phone_number_verified,
 *     must_change_password, mfa_required_at, last_login_at, last_login_ip,
 *     ai_access, image, manager_id, primary_business_unit_id, source, id,
 *     created_at, updated_at` — no timezone, no locale. (`sys_user_preference`
 *     is an open key/value bag whose documented examples are theme and locale;
 *     inventing a `timezone` key there would be an application-level
 *     convention no platform surface writes.)
 *  2. THE ORG DEFAULT — real, but not reachable from here.
 *     `ExecutionContext.timezone` is the resolved tenant zone (localization
 *     settings: platform default → global → tenant, ADR-0053 Phase 2), and
 *     `buildSession()` does not propagate it: an action handler's `ctx.session`
 *     carries `userId`, `organizationId`, `positions`, `roles` and nothing else.
 *
 * So this returns `'UTC'` — deliberately as a named function with the ladder
 * written down, not as an inline literal, so that when the platform grows a
 * user zone or carries the tenant zone into the action context there is exactly
 * one place to add the rung. It is NOT a speculative read of an undeclared key:
 * a `ctx.user.timezone ?? ...` chain here would be a tolerant consumer standing
 * in for a producer that does not exist, which is how a wrong zone would ship
 * silently instead of being fixed where it belongs.
 *
 * `'UTC'` is also `duly_duty.timezone`'s own declared `defaultValue`, and the
 * test pins the two together so they cannot drift into two answers.
 */
export const DEFAULT_DUTY_TIMEZONE = 'UTC';

export function resolveDutyTimezone(): string {
  return DEFAULT_DUTY_TIMEZONE;
}

// ── The engine facade's query shape ───────────────────────────────────
//
// `ctx.engine.find(object, query)` takes a BARE FILTER, not an ObjectQL query
// envelope. The runtime builds the envelope itself — `buildActionEngineFacade`
// in @objectstack/runtime 17.2.0, read verbatim from its `dist/index.js`:
//
//     async find(object, query) {
//       const where = query && Object.keys(query).length ? { where: query } : {};
//       const rows = await ql.find(object, { ...where, context });
//
// So every read in this file passes `{ field: value }`, never
// `{ where: { field: value } }`. Handing it an envelope produces
// `{ where: { where: { … } } }`; no row has a field called `where`, so the read
// comes back EMPTY WITH NO ERROR. That is the failure this file shipped with:
// `duly_catalog_apply` reported a successful run of zero, `duly_catalog_sync`
// scanned nothing and called every duty unchanged, and `resolveBusinessUnit`
// anchored no duty at all — silently, because "no position row" is a legitimate
// day-one state. The ONE unfiltered read survived, because
// `Object.keys({}).length === 0` skips the wrapping entirely, which is exactly
// what made the handler look partially alive.
//
// `ActionEngineFacade.find` in @objectstack/spec types `query` as a plain
// record of string to unknown and says nothing about which of the two shapes it
// is — the runtime's implementation is the only thing that decides, and this
// app read it the other way. Filed upstream as
// **objectstack-ai/objectstack#14175** so the shape is DECLARED rather than
// discovered; until that lands this comment is the contract.
//
// ⛔ Do NOT add a tolerant `query.where ?? query` rung — not here, not in a
// test double. A consumer that accepts both shapes is precisely what let the
// wrong one ship green: `test/catalog-instantiate.test.ts`'s fake honoured the
// envelope, so 78 assertions passed against a shape production never produces.
// The test that can see this is one that dispatches through the REAL route and
// lets the runtime build its own facade — `test/catalog-engine-facade.test.ts`.

// ── Shapes ──────────────────────────────────────────────────────────────────

export interface CatalogApplyParams extends Record<string, unknown> {
  position_code?: unknown;
  users?: unknown;
}

export interface CatalogSyncParams extends Record<string, unknown> {
  position_code?: unknown;
}

/** One (catalog item × person) decision, so a run is legible row by row. */
export interface CatalogApplyEntry {
  catalog_item: string;
  catalog_item_name: string;
  owner: string;
  outcome: 'created' | 'skipped';
  /** Id of the duty created by THIS run. Absent for a skip. */
  duty?: string;
}

export interface CatalogApplyResult {
  action: typeof CATALOG_APPLY_ACTION;
  position_code: string;
  catalog_items: number;
  users: number;
  created: number;
  skipped: number;
  entries: CatalogApplyEntry[];
}

/** A single cadence field's before/after. Sync is destructive, so both sides are recorded. */
export interface CadenceChange {
  from: unknown;
  to: unknown;
}

export interface CatalogSyncChange {
  duty: string;
  owner: string;
  catalog_item: string;
  catalog_item_name: string;
  fields: Partial<Record<CadenceField, CadenceChange>>;
}

/** A duty whose catalog item has been deactivated. Reported, never deleted. */
export interface CatalogSyncRetired {
  duty: string;
  owner: string;
  catalog_item: string;
  catalog_item_name: string;
}

export interface CatalogSyncResult {
  action: typeof CATALOG_SYNC_ACTION;
  position_code: string | null;
  scanned: number;
  updated: number;
  unchanged: number;
  changes: CatalogSyncChange[];
  retired: CatalogSyncRetired[];
}

// ── Reading params ──────────────────────────────────────────────────────────
//
// The dispatcher validates params against the declared contract before the
// handler runs (ADR-0104 D2), so these guards are for the programmatic caller
// that bypasses it — a job, a test, another handler. They fail loudly rather
// than instantiating a catalog for nobody, which is the failure that would
// otherwise look like a successful run reporting zero.

function requireText(value: unknown, param: string): string {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) throw new Error(`Action param "${param}" is required and must be a non-empty string.`);
  return text;
}

function optionalText(value: unknown): string | null {
  const text = typeof value === 'string' ? value.trim() : '';
  return text ? text : null;
}

function requireUserIds(value: unknown, param: string): string[] {
  const raw = Array.isArray(value) ? value : [value];
  const ids: string[] = [];
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry.trim() : '';
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) {
    throw new Error(`Action param "${param}" is required and must name at least one user.`);
  }
  return ids;
}

function recordId(row: Record<string, unknown>): string {
  const id = row.id;
  if (typeof id !== 'string' || !id) {
    throw new Error('Encountered a record with no id — cannot build an idempotency key from it.');
  }
  return id;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * `(catalog_item, owner)` — the pair the issue makes `apply` idempotent on.
 *
 * The parts are joined with a NUL, which cannot occur in a record id. Plain
 * concatenation would collide: ('ab','c') and ('a','bc') produce the same
 * string, so two different pairs would share one key and the second duty
 * would be silently skipped as already taken.
 *
 * Written as the \u0000 ESCAPE, never as a raw byte. A literal NUL in the
 * source makes git treat the whole file as binary — no diff, no blame, no
 * review, for the life of the file — is invisible in an editor, and is dropped
 * silently by most tooling on copy-paste, which would degrade this back to
 * plain concatenation and reintroduce the collision with no error.
 */
export function pairKey(catalogItem: unknown, owner: unknown): string {
  return `${text(catalogItem)}\u0000${text(owner)}`;
}

// ── Business unit ───────────────────────────────────────────────────────────

/**
 * The duty's rollup anchor: the business unit of the person's position
 * assignment.
 *
 * `sys_user_position.business_unit_id` is a real, nullable lookup to
 * `sys_business_unit` — "[ADR-0090 Addendum] Assignment-level BU anchor: where
 * this position assignment applies … Null = unanchored". The object lives in
 * `@objectstack/plugin-security`, not `@objectstack/platform-objects`.
 *
 * Returns `undefined` when the person has no position row or no anchored one,
 * and the duty is then created WITHOUT a business unit. That is deliberate:
 * `position_code` is free text so a customer can load their catalog before
 * positions are modelled, which means "no `sys_user_position` row" is a normal
 * day-one state and must not fail the apply.
 *
 * (`sys_user.primary_business_unit_id` is a second, user-level anchor that
 * exists on the platform. It is NOT read here — the issue names the
 * assignment-level anchor, and adding a fallback rung is a product decision,
 * reported rather than taken.)
 *
 * ⚠️ That tolerance is why this read's query shape matters more than the other
 * three. The other reads fail into a visibly empty report — zero items, zero
 * scanned — but this one fails into a state the handler is WRITTEN to accept:
 * an envelope-shaped filter returned nothing, "nothing" reads as "not yet
 * modelled", and every duty was created unanchored with no error anywhere. The
 * rollups that the business unit exists to feed were simply empty. See the
 * facade-shape note above; the end-to-end coverage is in
 * `test/catalog-engine-facade.test.ts`.
 */
async function resolveBusinessUnit(
  engine: ActionEngineFacade,
  userId: string,
): Promise<string | undefined> {
  const rows = await engine.find('sys_user_position', { user_id: userId });
  for (const row of rows) {
    // A person can hold several positions; take the first anchored one.
    // Unanchored rows (`null`) are legacy/tenant-wide and carry no depth.
    const anchor = row?.business_unit_id;
    if (typeof anchor === 'string' && anchor) return anchor;
  }
  return undefined;
}

// ── duly_catalog_apply ──────────────────────────────────────────────────────

export const applyCatalogHandler: ActionHandler<CatalogApplyParams> = async (ctx) => {
  const engine = ctx.engine;
  const positionCode = requireText(ctx.params?.position_code, 'position_code');
  const users = requireUserIds(ctx.params?.users, 'users');

  // Only ACTIVE items instantiate. A deactivated template is one the org has
  // stopped asking for; handing it to a new hire on their first day is the
  // opposite of what deactivating it meant.
  const items = await engine.find('duly_catalog_item', {
    position_code: positionCode,
    active: true,
  });
  const activeItems = items.filter((item) => item?.active !== false);

  // One probe for the whole run, not one per (item, user). The pair set is
  // what makes a second apply create nothing.
  const existing = await engine.find('duly_duty', { owner: { $in: users } });
  const taken = new Set<string>();
  for (const duty of existing) {
    // Any duty already pointing at this catalog item for this person counts —
    // the issue's rule is the `(catalog_item, owner)` pair, unqualified by
    // source or status. A second row for the same pair is the duplicate the
    // rule exists to prevent, whatever wrote the first one.
    if (!users.includes(text(duty?.owner))) continue;
    const item = duty?.catalog_item;
    if (typeof item === 'string' && item) taken.add(pairKey(item, duty?.owner));
  }

  // Resolved once per person, not once per (item, person): a 26-item catalog
  // for 3 people is 3 lookups here, not 78.
  const businessUnits = new Map<string, string | undefined>();
  for (const userId of users) {
    businessUnits.set(userId, await resolveBusinessUnit(engine, userId));
  }

  const timezone = resolveDutyTimezone();
  const entries: CatalogApplyEntry[] = [];
  let created = 0;
  let skipped = 0;

  for (const item of activeItems) {
    const itemId = recordId(item);
    const itemName = text(item.name);

    for (const owner of users) {
      if (taken.has(pairKey(itemId, owner))) {
        skipped += 1;
        entries.push({ catalog_item: itemId, catalog_item_name: itemName, owner, outcome: 'skipped' });
        continue;
      }

      const businessUnit = businessUnits.get(owner);
      const duty: Record<string, unknown> = {
        // ── from the catalog item ──
        name: item.name,
        description: item.description,
        form: item.form,
        frequency: item.frequency,
        due_anchor: item.due_anchor,
        due_offset_days: item.due_offset_days,
        lead_days: item.lead_days,
        grace_days: item.grace_days,
        // ── from the person ──
        owner,
        ...(businessUnit ? { business_unit: businessUnit } : {}),
        timezone,
        // ── provenance and lifecycle ──
        // `source: 'catalog'` is the CALIBER field: it is what makes on-time
        // rates over these duties mean something, and it is the flag `sync`
        // dispatches on. `catalog_item` is what makes the edit replayable.
        source: 'catalog',
        catalog_item: itemId,
        status: 'active',
      };

      const inserted = await engine.insert('duly_duty', duty);
      created += 1;
      // Same-run guard: two identical items in one catalog cannot both land on
      // the same person just because the pre-probe ran before either existed.
      taken.add(pairKey(itemId, owner));
      entries.push({
        catalog_item: itemId,
        catalog_item_name: itemName,
        owner,
        outcome: 'created',
        duty: inserted?.id,
      });
    }
  }

  const result: CatalogApplyResult = {
    action: CATALOG_APPLY_ACTION,
    position_code: positionCode,
    catalog_items: activeItems.length,
    users: users.length,
    created,
    skipped,
    entries,
  };
  return result;
};

// ── duly_catalog_sync ───────────────────────────────────────────────────────

export const syncCatalogHandler: ActionHandler<CatalogSyncParams> = async (ctx) => {
  const engine = ctx.engine;
  const positionCode = optionalText(ctx.params?.position_code);

  // Deliberately NOT filtered on `active`: a deactivated item is exactly what
  // the retired report is made of, so it has to come back from this read.
  const items = await engine.find(
    'duly_catalog_item',
    positionCode ? { position_code: positionCode } : {},
  );
  const byId = new Map<string, Record<string, unknown>>();
  for (const item of items) {
    if (positionCode && text(item?.position_code) !== positionCode) continue;
    byId.set(recordId(item), item);
  }

  const duties = await engine.find('duly_duty', { source: 'catalog' });

  const changes: CatalogSyncChange[] = [];
  const retired: CatalogSyncRetired[] = [];
  let scanned = 0;
  let updated = 0;
  let unchanged = 0;

  for (const duty of duties) {
    // The `source` guard is re-applied in code, not left to the query.
    // "A duty whose source is 'self' is never touched by sync, even if its
    // catalog_item is somehow set" is a product invariant, and an invariant
    // that lives only in a `where` clause is one lenient driver away from
    // being untrue. A self-declared duty is the owner's own record-keeping;
    // the catalog does not get to rewrite it.
    if (text(duty?.source) !== 'catalog') continue;

    const itemId = text(duty?.catalog_item);
    if (!itemId) continue;

    const item = byId.get(itemId);
    // Not in scope for this sweep (another position, or an item that no longer
    // exists). Narrowing by `position_code` must not report the rest of the org
    // as retired.
    if (!item) continue;

    scanned += 1;
    const dutyId = recordId(duty);
    const owner = text(duty?.owner);
    const itemName = text(item.name);

    if (item.active === false) {
      // Report and move on. Deleting someone's duties because a template was
      // deactivated is a decision for a human, not a side effect of a sync.
      retired.push({ duty: dutyId, owner, catalog_item: itemId, catalog_item_name: itemName });
      continue;
    }

    const patch: Record<string, unknown> = {};
    const fields: Partial<Record<CadenceField, CadenceChange>> = {};
    for (const field of CADENCE_FIELDS) {
      const next = item[field];
      const current = duty?.[field];
      if (Object.is(current ?? null, next ?? null)) continue;
      patch[field] = next;
      fields[field] = { from: current, to: next };
    }

    if (Object.keys(patch).length === 0) {
      unchanged += 1;
      continue;
    }

    await engine.update('duly_duty', dutyId, patch);
    updated += 1;
    changes.push({ duty: dutyId, owner, catalog_item: itemId, catalog_item_name: itemName, fields });
  }

  const result: CatalogSyncResult = {
    action: CATALOG_SYNC_ACTION,
    position_code: positionCode,
    scanned,
    updated,
    unchanged,
    changes,
    retired,
  };
  return result;
};

// ── Wiring ──────────────────────────────────────────────────────────────────

/**
 * Register both catalog handlers on the engine.
 *
 * Called from `registerDulyActionHandlers` in `register-handlers.ts`, which
 * `objectstack.config.ts` invokes from `onEnable`. The two OBJECT-LESS actions
 * register under {@link GLOBAL_ACTION_OBJECT}; the object-bound twin registers
 * under {@link CATALOG_ITEM_OBJECT}, which is the only key its dispatch can
 * reach.
 *
 * THREE registrations, TWO handler functions. The twin passes the very same
 * `applyCatalogHandler` REFERENCE the global one does — not a copy, not a
 * wrapper. A second key on one function is the whole cost of giving the action
 * a button; a second function would be a second implementation to keep in step,
 * which is the thing this placement was explicitly not allowed to buy.
 */
export function registerCatalogActionHandlers(ql: HandlerRegistrationContext): void {
  ql.registerAction(GLOBAL_ACTION_OBJECT, CATALOG_APPLY_ACTION, applyCatalogHandler);
  ql.registerAction(GLOBAL_ACTION_OBJECT, CATALOG_SYNC_ACTION, syncCatalogHandler);
  ql.registerAction(CATALOG_ITEM_OBJECT, CATALOG_APPLY_TO_PEOPLE_ACTION, applyCatalogHandler);
}
