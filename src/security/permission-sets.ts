// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePermissionSet } from '@objectstack/spec/security';
import type { FieldPermission, ObjectPermission } from '@objectstack/spec/security';

/**
 * The three capability bundles. Permission sets are the ONLY capability
 * container on the platform (ADR-0090): positions distribute them, business
 * units give them depth, and nothing else grants anything.
 *
 * ── How "inherit" is spelled here ────────────────────────────────────────
 * There is no `extends` key on `PermissionSetSchema`, and there cannot be one
 * that means what it says: at runtime a caller's capability is the UNION of
 * every set they resolve, merged most-permissively, so "inheritance" is not a
 * schema feature — it is what happens when a person holds two sets.
 *
 * What this file does instead is compose the AUTHORED grants: `MANAGER_OBJECTS`
 * spreads `MEMBER_OBJECTS` and overrides the two entries that differ, and
 * `ADMIN_OBJECTS` spreads `MANAGER_OBJECTS`. Two things follow, and both are
 * the point:
 *
 *   1. A grant is written once. Nobody can widen `duly_log_entry` for managers
 *      by editing a copy of the member entry, because there is no copy.
 *   2. Each set is self-contained, so binding ONE set to ONE position is a
 *      correct deployment. A manager who somehow holds only `duly_manager`
 *      still gets every member grant.
 *
 * `test/security.test.ts` asserts the composition itself — that the entries
 * the card does not widen are byte-identical across the three sets — so a
 * future edit that restates instead of inheriting fails a test rather than
 * drifting quietly.
 *
 * ── Object-level bits and DEPTH are two different axes ───────────────────
 * `allowRead`/`allowEdit`/… answer "may this caller use this verb on this
 * object at all". `readScope`/`writeScope` (ADR-0057 D1) answer "over whose
 * rows". Both must be right; neither implies the other. Every widening in
 * this file is on the READ axis. The write axis never leaves `own` on
 * `duly_task` and `duly_duty` — see the invariant note on ADMIN_OBJECTS.
 *
 * ── The manager's DEPTH, and what makes it authorable ────────────────────
 * `readScope: 'unit_and_below'` on the manager grants for `duly_task` and
 * `duly_duty` is declared, not deferred. It loads because
 * `objectstack.config.ts` declares `requires: ['hierarchy-security']`;
 * `defineStack`'s `validateHierarchyScopeCapability` refuses any grant using
 * `own_and_reports` / `unit` / `unit_and_below` without it, as an
 * AUTHORING-TIME error deliberately put in place of a silent fail-closed to
 * owner-only (ADR-0049 — the metadata would otherwise lie). The declaration
 * installs nothing: on an open-edition checkout the scopes resolve to
 * owner-only and `validate` prints one warning naming
 * `@objectstack/security-enterprise`. That warning is the expected state.
 *
 * ⛔ `org` is NOT a hierarchy scope, so it passes that check with no
 * declaration at all. It is the wrong answer here and the reason this note
 * exists: `org` on `duly_task` would hand every manager every task in the
 * tenant. Depth for managers is `unit_and_below`.
 *
 * ── Depth on `duly_catalog_item` ─────────────────────────────────────────
 * `duly_catalog_item` is `public_read`, so `readScope` there would be inert:
 * plugin-sharing's `buildReadFilter` returns `null` for any object whose
 * effective model is not `private`, before depth is consulted. It is
 * deliberately not declared (ADR-0049 — a key that cannot enforce does not
 * get authored). `writeScope` is NOT inert on the same object: the WRITE
 * filter applies to `private` and `public_read` alike (public_read is
 * read-open, write-owned), which is why the admin entry has to say `org` for
 * "full control" to mean anything at all.
 *
 * ── One platform object: read on `sys_business_unit` (#180) ─────────────
 * Every other entry is a `duly_*` object. Business units are read so the
 * unit lookups on tasks and duties render as names; see the entry's note.
 *
 * ── Two `fields` maps: task and duty provenance (#176, #178) ─────────────
 * Nothing in this schema needs MASKING: the server-owned columns
 * (`completed_at`, `last_update_at`, `last_dispatched_period`) are already
 * `readonly` on the object, which is the enforced surface. An FLS entry that
 * repeats a readonly flag is declared-and-unenforced twice over.
 *
 * Both maps are WRITE locks, there because `readonly` cannot do that job:
 * `TASK_PROVENANCE_LOCK` (identical on all three sets — nobody lifts it) and
 * the duty map (locked for member and manager, lifted by `duly_admin` for
 * the Import and corrections). Each set's `fields` is the two spread
 * together. See each map's note.
 */

/**
 * Capabilities this package defines, by declaring them on the sets below.
 *
 * These strings are the `requiredPermissions` gate on the five actions
 * (ADR-0066 D4: 403 on the platform action route and the MCP bridge, mirrored
 * as a UI hide). They are deliberately NOT imported by the action files — the
 * card's file surface there is the `requiredPermissions` key and nothing else
 * — so the link between "the action requires it" and "a set grants it" is held
 * by two independent checks: the `capability-reference-unknown` author-time
 * rule, and an explicit assertion in `test/security.test.ts`.
 *
 * ── Why apply and sync are two capabilities, not one ─────────────────────
 * Applying a catalog to a new hire is routine onboarding. Syncing rewrites
 * authored cadence on duties people are already working to, org-wide when
 * `position_code` is omitted, and is reportable only after the fact. Both are
 * granted to `duly_admin` here, so nothing is harder to deploy — but a
 * customer who wants an onboarding administrator who cannot rewrite the org's
 * cadence can express that by binding a set that grants only the first, which
 * a single merged capability would make impossible.
 */
export const DULY_TASK_UPDATE_STATUS = 'duly.task.update_status';
export const DULY_CATALOG_APPLY = 'duly.catalog.apply';
export const DULY_CATALOG_SYNC = 'duly.catalog.sync';

/**
 * ⛔ `duly_log_entry` — the entry that must never be widened.
 *
 * `readScope: 'own'` here, and the same object entry is inherited unchanged by
 * `duly_manager` and `duly_admin`. There is no unit scope, no org scope and no
 * admin override anywhere in this file, and `test/security.test.ts` walks every
 * set to prove it.
 *
 * This is a product invariant, not a default someone tightened. A log people
 * believe their skip-level can read is a log nobody keeps, and the module then
 * stops producing the one record it exists to produce. The single widening the
 * product allows is a record's OWN `visibility: 'manager'`, reaching that
 * person's manager and nobody else — and that widening is NOT expressible on
 * this platform version. See `src/security/sharing-rules.ts`, which carries the
 * evidence and the upstream reference; the fail-closed state it leaves behind
 * is why this entry can stay `own` without a hole opening somewhere else.
 */
const MEMBER_OBJECTS = {
  // The whole day's work. Create, read and edit their own rows; delete is not
  // granted — a dispatched task is a record of what was owed, and "cancelled"
  // is a status, not a deletion.
  duly_task: {
    allowCreate: true,
    allowRead: true,
    allowEdit: true,
    readScope: 'own',
    writeScope: 'own',
  },

  // Read their own duties; create their own. No edit bit: a duty is what the
  // organisation (or the person, once) declared is owed, and editing cadence
  // after the fact is a correction, which belongs to `duly_admin` and to
  // `duly_catalog_sync`.
  duly_duty: {
    allowCreate: true,
    allowRead: true,
    readScope: 'own',
    writeScope: 'own',
  },

  // Full control of their own log, delete included. This is the one object
  // where delete is right: a personal note the author wants gone should go.
  duly_log_entry: {
    allowCreate: true,
    allowRead: true,
    allowEdit: true,
    allowDelete: true,
    readScope: 'own',
    writeScope: 'own',
  },

  // Read-only. The catalog describes positions, not people, and its OWD is
  // already `public_read`; the grant here is the object-level bit that makes
  // the tab usable at all.
  duly_catalog_item: {
    allowRead: true,
  },

  // A member reads assignments they own — i.e. ones they raised. The card asks
  // for "the ones they are on", which needs a per-record recipient the sharing
  // surface cannot name; it is the second instance of the same gap the log
  // entry hits, and it is filed with it. Failing closed here is the safe half:
  // an assignee still sees their own fanned-out `duly_task`, which is the row
  // they actually work.
  duly_assignment: {
    allowRead: true,
    readScope: 'own',
  },

  /**
   * The one platform object this package grants: READ on business units, so
   * a unit renders as its name (#180).
   *
   * `duly_task.business_unit` and `duly_duty.business_unit` are lookups to
   * `sys_business_unit`, and the console resolves a lookup by reading the
   * target AS THE VIEWER. Measured on 18.2.0 before this entry: every Duly set
   * got `403` on the object (the platform baseline does not name it either),
   * so a member's own task and duty pages showed the unit as a raw id, and a
   * `duly_admin` who is not a platform administrator could not Import
   * `samples/duties.csv` at all — the Import resolves `business_unit` BY NAME
   * under the importer's read, and refused 19/19 rows with "no record
   * matches". With this entry: names render, the Import lands 19/19.
   *
   * ── What it discloses ───────────────────────────────────────────────────
   * `sys_business_unit` declares no `sharingModel`, and a `sys_` object's
   * unset model is public, so this reaches EVERY unit in the tenant, with
   * every column: name, code, kind, parent unit, unit head, timezone,
   * active / effective dates and `external_ref` (the HRIS id). Read only:
   * no create, edit or delete bit, so every write stays `403`.
   * The tree's shape is not new to a member — the platform's baseline already
   * lets every member read each colleague's `primary_business_unit_id` and
   * `manager_id` on `sys_user`. The names are what this adds.
   *
   * ⛔ Why not a name-only read. It is declarable — `readable: false` on
   * every other column in `fields` — and it works for the member, but field
   * permissions merge most-permissively among DECLARING sets only, and the
   * platform's admin set declares nothing on these columns. So the mask also
   * binds every administrator who holds a Duly set: measured, Setup → Business
   * Units lost Kind, Business Unit Head and Active, and the org chart went
   * flat. Filed as objectstack-ai/objectstack#29106. Until it lands, no Duly
   * set declares a field permission on `sys_business_unit`, and
   * `test/business-unit-read.test.ts` pins that.
   *
   * No row narrowing either: a predicate cannot reach across a relation, so
   * "the viewer's own unit tree" is not expressible; a manager reads tasks
   * across `unit_and_below`; and the importer needs every unit by name. No
   * scope keys: on a public-default object `readScope` is inert (ADR-0049),
   * and there is no write bit for a `writeScope` to bound.
   */
  sys_business_unit: {
    allowRead: true,
  },
} satisfies Record<string, ObjectPermission>;

/**
 * Manager = member, plus depth on the read axis and the one write a manager
 * makes.
 *
 * ⛔ Both depth overrides below change `readScope` ONLY. Each spreads the
 * member entry, so `writeScope: 'own'` is inherited rather than retyped — the
 * "a manager writes nothing below them" invariant is held by the absence of
 * an override, not by remembering to repeat a value. Widening either of these
 * to a write depth is the one edit `test/security.test.ts` will not let
 * through.
 */
const MANAGER_OBJECTS = {
  ...MEMBER_OBJECTS,

  // Reads down the unit and everything under it (ADR-0057). This is the
  // manager's whole job: answer "what is late across my unit" having entered
  // no data. Write depth is inherited `own` — untouched, deliberately.
  duly_task: {
    ...MEMBER_OBJECTS.duly_task,
    readScope: 'unit_and_below',
  },

  // Same depth on the obligations behind those tasks: a manager who can see a
  // late task and not the duty that produced it cannot act on it.
  duly_duty: {
    ...MEMBER_OBJECTS.duly_duty,
    readScope: 'unit_and_below',
  },

  // Assigning is a manager's only write. Create and edit their own
  // assignments; the fan-out then produces one independently-owned task per
  // assignee, which is where status entry lives.
  duly_assignment: {
    ...MEMBER_OBJECTS.duly_assignment,
    allowCreate: true,
    allowEdit: true,
    writeScope: 'own',
  },
} satisfies Record<string, ObjectPermission>;

/**
 * Administrator = manager, plus the catalog and an org-wide view of duties.
 *
 * ── The two entries worth reading twice ──────────────────────────────────
 * `duly_duty` gets `readScope: 'org'` and `allowEdit` — but `writeScope` stays
 * `'own'`, inherited. That pair is deliberate and it is the card's own
 * acceptance line ("no position grants a write scope on duly_task/duly_duty
 * wider than own") winning over its permission-set line ("edit for
 * corrections"). The bit is not inert: an administrator can edit their own
 * duties, which a member cannot. What it does not do is let one person quietly
 * rewrite another person's obligations one record at a time.
 *
 * The org-wide correction path is not missing, it is somewhere better:
 * `duly_catalog_sync`, which replays cadence from the catalog, is bounded to
 * cadence fields, is gated by a capability only this set grants, and reports
 * what it touched. A correction that goes through it is auditable; a
 * correction typed into somebody's duty record is not.
 *
 * `duly_task` is inherited untouched and therefore reads `unit_and_below` —
 * the administrator's depth on tasks arrives through the manager set rather
 * than being restated here, which is why widening it is a one-line edit in
 * one place.
 *
 * `duly_log_entry` is inherited untouched. There is no admin override, and
 * that is the whole point of the invariant.
 */
const ADMIN_OBJECTS = {
  ...MANAGER_OBJECTS,

  // Full control of the catalog. `writeScope: 'org'` is required, not
  // decorative: `public_read` is read-open but WRITE-OWNED, so without it an
  // administrator could only edit catalog items they personally created.
  duly_catalog_item: {
    ...MANAGER_OBJECTS.duly_catalog_item,
    allowCreate: true,
    allowEdit: true,
    allowDelete: true,
    writeScope: 'org',
  },

  duly_duty: {
    ...MANAGER_OBJECTS.duly_duty,
    allowEdit: true,
    readScope: 'org',
  },
} satisfies Record<string, ObjectPermission>;

/**
 * `duly_task.source`, `owner` and `business_unit` — where a task came from,
 * whose it is, and which unit it is filed under — are not a caller's to write
 * (#176).
 *
 * Measured on 18.2.0 before this lock: a member and a manager could each set
 * all three on their own tasks through data POST and PATCH and MCP create and
 * update. `source: catalog` put self-made work into every governed reading
 * (`src/datasets/governed.ts`). `owner` naming someone else put a row into
 * that person's Overdue that they could not see (#143), and `business_unit`
 * filed it under any unit.
 *
 * With this lock the platform's field-level write gate refuses any payload
 * that NAMES one of the three: `403 Field write denied: not permitted to edit
 * [<field>]`, on every door. Nobody needs to name them:
 *
 *  - `owner` defaults to the writer (`current_user`), so a caller's task is
 *    theirs. A manager is no different: "Assigning is their only write", and
 *    the door for a report's work is `duly_assignment` and its fan-out.
 *  - `source` defaults to `self`, which is what a hand-made task is.
 *  - `business_unit` is stamped by `duly_task_lifecycle_stamps` from the
 *    owner's unit. The gate judges the caller's payload, not a hook's write.
 *
 * The console honours it: on the task form Source and Business unit render
 * read-only and are left out of the POST and PATCH, so the form keeps saving
 * (measured in en-US and zh-CN). Owner is not on the form at all.
 *
 * The writers that put work on other people are SYSTEM writes, which the gate
 * does not judge: the dispatcher, the assignment fan-out (`runAs: 'system'`),
 * and the seed.
 *
 * ⛔ Why not `readonly` on the object. Measured: a `readonly` field is
 * validated shape-only, so `required` stops being checked, and a system
 * insert with `owner: null` then commits an ownerless task. The #148 fan-out
 * depends on that refusal to report a removed assignee. And a readonly strip
 * is silent, where this is a refusal the caller can see.
 *
 * The same map is on all three sets, because the gate is a most-permissive
 * merge in which only declaring sets vote: a set that says nothing lifts
 * nothing, while a set that said `editable: true` would lift the others.
 * No Duly role hand-writes another person's task, so no set lifts it. A
 * platform administrator is not bound by field permissions.
 */
const TASK_PROVENANCE_LOCK = {
  'duly_task.source': { readable: true, editable: false },
  'duly_task.owner': { readable: true, editable: false },
  'duly_task.business_unit': { readable: true, editable: false },
};

/**
 * Who may write where a duty CAME FROM (#178).
 *
 * Three `duly_duty` columns say who put a duty on someone, and on whom:
 * `source` (the caliber every metric filters on — `catalog` and `assigned`
 * are scored, `self` is not), `owner` (who owes it) and `business_unit` (the
 * rollup anchor). Measured on 18.2.0 before this map existed: a member or a
 * manager could create a duty with `source: catalog`, somebody else as
 * `owner` and a foreign unit, through data POST and MCP `create_record`, and
 * it was stored exactly as sent — a scored duty on a person who never saw it.
 *
 * ── Who writes them instead ─────────────────────────────────────────────
 *  - `duly_catalog_apply` / `duly_catalog_sync` and the seed: system writes,
 *    which field-level security never sees (an action body runs elevated; the
 *    seed loader runs `isSystem`).
 *  - The console Import of `samples/duties.csv`, and any correction by hand:
 *    a `duly_admin`, whose set lifts the lock below.
 *  - Everybody else gets the defaults: `source: 'self'`, `owner` = the
 *    writer, and the unit `duly_duty_unit_stamp` (src/hooks/duty.hook.ts)
 *    reads off the owner. A member or manager owns only what they write; the
 *    manager's door to a report's work is `duly_assignment`, which makes tasks.
 *
 * ── Why field-level security and not `readonly` ─────────────────────────
 *  - The console Import maps a `readonly` field as "match only" and never
 *    writes it (`docs/import/walkthrough.md`). `duties.csv` carries all three,
 *    so `readonly` would land every imported catalog duty as `self`, with no
 *    unit and nothing erroring.
 *  - `readonly` validates a field shape-only, so `owner`'s `required` would
 *    stop being checked for the system writers that rely on it (#176).
 *  - FLS REFUSES a caller who names the field — `403 Field write denied` on
 *    REST and MCP — instead of silently rewriting it. And the console honours
 *    it: measured on 18.2.0, the create form renders Source and Business unit
 *    read-only and leaves them out of the POST, so a member's form create
 *    still lands (`self`, their own unit).
 *
 * ── How the three sets combine ──────────────────────────────────────────
 * Field permissions merge most-permissively across a caller's sets, and only
 * a set that DECLARES a field votes on it. Every Duly admin also holds
 * `duly_member`, so `duly_admin` must declare the same three fields as
 * editable — leaving them out would not lift the member's lock. A position
 * that binds `duly_admin` alone gets the same answer.
 */
const DUTY_PROVENANCE_FIELDS = ['source', 'owner', 'business_unit'] as const;

const dutyProvenance = (editable: boolean): Record<string, FieldPermission> =>
  Object.fromEntries(
    DUTY_PROVENANCE_FIELDS.map((field) => [`duly_duty.${field}`, { readable: true, editable }]),
  );

/** Member and manager: the defaults decide. */
const DUTY_PROVENANCE_LOCKED = dutyProvenance(false);
/** Duly admin: Import and corrections. */
const DUTY_PROVENANCE_EDITABLE = dutyProvenance(true);

/**
 * `duly_member` — the baseline every Duly user holds.
 *
 * Not `isDefault: true`, and that is forced rather than chosen: the ADR-0090
 * D5/D9 anchor tier refuses any set carrying `systemPermissions` (and any set
 * carrying a delete bit), both of which this set needs. Binding it is
 * therefore a rollout step; `docs/deployment/security.md` is the table an
 * administrator reproduces in Setup.
 */
export const MemberPermissionSet = definePermissionSet({
  name: 'duly_member',
  label: 'Duly — team member',
  description:
    'Owns duties, works tasks, keeps a personal work log. Everything is scoped to the holder’s own records.',
  objects: MEMBER_OBJECTS,
  fields: { ...TASK_PROVENANCE_LOCK, ...DUTY_PROVENANCE_LOCKED },
  systemPermissions: [DULY_TASK_UPDATE_STATUS],
  tabPermissions: { duly_app: 'visible' },
});

/**
 * `duly_manager` — reads down the line, writes assignments.
 */
export const ManagerPermissionSet = definePermissionSet({
  name: 'duly_manager',
  label: 'Duly — manager',
  description:
    'Everything a team member has, plus unit-and-below read on tasks and duties and the ability to raise assignments. Writes no one else’s status.',
  objects: MANAGER_OBJECTS,
  fields: { ...TASK_PROVENANCE_LOCK, ...DUTY_PROVENANCE_LOCKED },
  systemPermissions: [DULY_TASK_UPDATE_STATUS],
  tabPermissions: { duly_app: 'visible' },
});

/**
 * `duly_admin` — the catalog and the rollout.
 *
 * Carries no `viewAllRecords` / `modifyAllRecords` anywhere. A Duly
 * administrator is a person with a job, not a super-user, and the personal
 * work log is closed to them exactly as it is to everyone else.
 */
export const AdminPermissionSet = definePermissionSet({
  name: 'duly_admin',
  label: 'Duly — administrator',
  description:
    'Everything a manager has, plus full control of the catalog and an org-wide read of duties. No View All / Modify All, and no widened read on the personal work log.',
  objects: ADMIN_OBJECTS,
  fields: { ...TASK_PROVENANCE_LOCK, ...DUTY_PROVENANCE_EDITABLE },
  systemPermissions: [DULY_TASK_UPDATE_STATUS, DULY_CATALOG_APPLY, DULY_CATALOG_SYNC],
  tabPermissions: { duly_app: 'visible' },
});
