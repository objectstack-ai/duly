// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePermissionSet } from '@objectstack/spec/security';
import type { ObjectPermission } from '@objectstack/spec/security';

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
 * ── No `fields` block ────────────────────────────────────────────────────
 * Nothing in this schema needs masking: the server-owned columns
 * (`completed_at`, `last_update_at`, `last_dispatched_period`) are already
 * `readonly` on the object, which is the enforced surface. An FLS entry that
 * repeats a readonly flag is declared-and-unenforced twice over.
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
  systemPermissions: [DULY_TASK_UPDATE_STATUS, DULY_CATALOG_APPLY, DULY_CATALOG_SYNC],
  tabPermissions: { duly_app: 'visible' },
});
