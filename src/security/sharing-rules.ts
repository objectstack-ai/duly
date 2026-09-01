// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { SharingRuleParsed } from '@objectstack/spec/security';

/**
 * Record sharing rules — deliberately EMPTY, with the reason on the record.
 *
 * This file exists and is wired into the barrel because the absence is a
 * finding, not an oversight. Deleting it would leave the next author to
 * rediscover the same wall, and — far worse — to author their way past it with
 * the one recipient the surface does accept, which leaks.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT THE CARD ASKED FOR
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *   `duly_log_entry` where `visibility = 'manager'` → recipient: the owner's
 *   manager, and nobody else.
 *
 * The predicate half is trivially expressible: `record.visibility == "manager"`
 * lowers to a filter and is a property of the record. The RECIPIENT half is
 * not expressible at all on protocol 17.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY NOT — measured on @objectstack/spec 17.2.0 and the 17.2.0 runtime
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * 1. `ShareRecipientType` (spec `src/security/sharing.zod.ts`) is exactly five
 *    members: `user`, `team`, `position`, `unit_and_subordinates`,
 *    `business_unit`. `sharedWith.value` is documented as "ID or code of the
 *    recipient" — one static principal per rule.
 *
 * 2. `plugin-sharing`'s `expandRecipient` reads that static `recipient_id` and
 *    resolves it ONCE per rule, not once per record: `user` → `[recipient_id]`,
 *    `position` → every holder of the position, `business_unit` /
 *    `unit_and_subordinates` → the unit's (and descendants') members. The
 *    resulting `sys_record_share` rows name the same recipients for every
 *    record the criteria matched. There is no expansion that reads a FIELD of
 *    the matched record, so "the manager of THIS row's owner" has nothing to
 *    resolve through.
 *
 * 3. The only recipient that is even close — `position: 'duly_manager'` — is
 *    precisely the leak the product forbids. It would share every
 *    manager-visible log entry in the tenant with every holder of the manager
 *    position: the skip-level, the manager two teams over, everyone. That is
 *    the failure this invariant exists to prevent, so it is not a stopgap and
 *    it is not authored here.
 *
 * 4. The platform's own suggested alternative does not reach either. The
 *    author-time rule `sharing-rule-runtime-variable-condition` says, when a
 *    condition reads `current_user.*`: "Express per-user access with the
 *    mechanism that runs per request instead — an RLS policy on a permission
 *    set (`rowLevelSecurity[].using`, where `current_user.*` IS resolved)."
 *    That advice does not hold for a `private` object. `plugin-security`'s
 *    `getReadFilter` composes
 *
 *        andComposeLayers(andComposeLayers(rlsFilter, cbpFilter), sharingFilter)
 *
 *    and `plugin-sharing`'s `buildReadFilter` returns, for a private object
 *    with an owner column, `ownerMatch` OR'd only with the caller's
 *    `sys_record_share` grants. Because that filter is AND-composed, an RLS
 *    policy can only ever NARROW a private object's readable set — it cannot
 *    add a row the sharing layer already excluded. Widening a private object
 *    has exactly two doors: the ADR-0057 depth scopes (which the invariant
 *    forbids here, and which would expose `visibility: 'private'` rows too),
 *    and a `sys_record_share` row, which only a criteria sharing rule writes.
 *    Both doors are shut for this rule, by different bolts.
 *
 * 5. The same wall stands in a second place in this app, which is why it is
 *    worth a platform issue rather than a shrug: `duly_assignment` should be
 *    readable by "the people it is addressed to" (`assignees`), and that is
 *    the same shape — a recipient derived from a field of the matched record.
 *
 * Filed upstream as **objectstack-ai/objectstack#14103** — record-relative
 * sharing recipients (the owner's manager; the value of a user field on the
 * matched record). Until it lands, `duly_log_entry.visibility = 'manager'`
 * records nothing but an intention: the field is stored and honest, and no
 * manager can read the row.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THAT IS THE RIGHT PLACE TO STOP
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Failing closed costs a feature. Failing open costs the module: the moment
 * one person discovers their skip-level read a log entry they marked for their
 * manager, the honest logs stop, and every number downstream becomes a report
 * on a dataset nobody keeps. A missing grant is visible and fixable. A grant
 * that reached the wrong people is neither.
 *
 * `duly_catalog_item` needs no rule at all — it is `public_read`, and a rule
 * anchored there would be refused by `SharingService.assertNotInertGrant` and
 * flagged by the `sharing-rule-object-not-shareable` author-time rule.
 */
export const dulySharingRuleDefinitions: SharingRuleParsed[] = [];
