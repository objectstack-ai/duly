// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { definePage } from '@objectstack/spec/ui';

/**
 * `duly_member` — the manager's view of ONE person, entered by nobody.
 *
 * The screen that removes the "can you send me a status update" mail. A manager
 * opens a person and reads six things in order: who they are, what is on fire
 * right now, what this period asks of them, what they hold permanently, what
 * has moved lately, and what was put on them by someone else.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT IS DELIBERATELY NOT HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * **The person's work log. Not filtered, not counted, not "0 entries".** The
 * object is `readScope: 'own'` for every position
 * (`src/security/permission-sets.ts`), and the only widening the product allows
 * is a record's own `visibility: 'manager'` flag. A count is not a redaction: a
 * manager shown "14 entries" has learned that the log exists, that it is being
 * watched, and roughly how much is in it — which is enough to stop people
 * keeping one, and the log is the one record this module exists to produce.
 *
 * Its machine name is deliberately absent from this file, including from this
 * comment, because the card's acceptance is a GREP and a grep cannot read
 * intent: a hit is a hit, and the next author to run it should get silence
 * rather than a paragraph to judge. The name, the reasoning and the guard live
 * together in `test/member-page.test.ts`, which greps this source and walks the
 * parsed page.
 *
 * **Any editable control.** A manager's only write in this product is
 * assigning, and that lives on `duly_assignment` with its own action. So this
 * page authors no `record:details` (whose `inlineEdit` defaults ON where the
 * object is editable), no `record:quick_actions`, no `element:form` /
 * `element:button` / `element:text_input` / `element:record_picker`, no `add`
 * picker and no `actions` list on any related list. The highlight chips carry
 * `readonly: true`, which the renderer's `HeaderHighlight` gate enforces.
 * See "MEASURED PLATFORM GAPS" §3 for the one affordance this page cannot
 * close from metadata.
 *
 * **Any comparison to other people.** No percentile, no team average, no rank,
 * no "N of M". Their own trend over time is fine; a position in a distribution
 * is a performance score, and item counts are never ranked or compared anywhere
 * in this product (`AGENTS.md` — product invariants).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHY THIS IS A `record` PAGE OVER `sys_user`, AND HOW IT IS REACHED
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything on this page has to be scoped to the person being read. Measured
 * on `@objectstack/spec` 17.2.0, exactly ONE authorable component binds itself
 * to the record in context: `record:related_list`, via `relationshipField` (the
 * child field holding this record's `relationshipValueField`, default `id`).
 * Every other data-bearing component takes a `FilterCondition`, whose entire
 * dynamic vocabulary is `CONTEXT_TOKENS` — `{current_user_id}` and
 * `{current_org_id}` (`@objectstack/spec/data`, `context-tokens.zod.ts`) — both
 * of which name the VIEWER, never the record. See gap §1.
 *
 * So the page is `type: 'record'`, `object: 'sys_user'`, and it is reached the
 * way record pages are reached: by opening a person. The Team nav group gains a
 * `sys_user` entry ("People") for that; a `type: 'page'` nav item would route
 * through `PageView`, which mounts no `RecordContextProvider`, so every related
 * list below would have a null parent and render nothing.
 *
 * `kind: 'full'` with explicit regions, NOT `kind: 'slotted'`, and that is a
 * product decision rather than a style one. A slotted page falls through to
 * `buildDefaultPageSchema`, whose `tabs` synthesizer generates one related list
 * per object holding an FK to `sys_user` — which on this stack includes the
 * work-log object named above. The one thing this page must never show is the
 * thing the default layout would add for free.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * MEASURED PLATFORM GAPS — filed, not worked around (AGENTS.md rule 9)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Each of these was measured against the installed 17.2.0 packages before it
 * was written down, and each is filed at `objectstack-ai/objectui` rather than
 * faked here. What the page does INSTEAD is named in each entry.
 *
 * **§1 — No record-context token for filter values.** `element:number`
 * (`object` + `aggregate: 'count'` + `filter`) is the component that renders a
 * number, and its `filter` is a plain `FilterCondition`. `resolveContextTokens`
 * (`@object-ui/core`, `filter-tokens.ts`) re-exports the spec's `CONTEXT_TOKENS`
 * verbatim and resolves those two names only; `ElementNumberRenderer` passes
 * `props.filter` straight to the adapter with nothing record-shaped added. So a
 * count of THIS person's open tasks is not authorable — an `element:number` on
 * this page would count the whole org, which is both wrong and the
 * comparison-to-peers this card forbids.
 *   → INSTEAD: "Right now" is three `record:related_list`s. Each is correctly
 *     record-scoped, and each renders a real count: `RelatedList` draws a badge
 *     carrying the server `total` for the collection, not the loaded page.
 *
 * **§2 — `record:related_list` cannot group.** `RecordRelatedListProps` has
 * `sort`, `filter`, `limit` and `columns`, and no `groupBy`; `grouping` exists
 * only on a grid LIST VIEW, which a related list does not render (it draws its
 * own table). "Grouped by frequency" is therefore not authorable at this
 * position.
 *   → INSTEAD: "This period" leads with the `frequency` column and sorts on it,
 *     so each rhythm reads as a contiguous block. That is weaker than grouping
 *     and it is not pretended otherwise.
 *
 * **§3 — A page cannot declare its related lists read-only.** There is no
 * `readonly` on `PageComponentSchema` — deliberately, ruled 2026-08-12:
 * "editability lives on fields". That ruling does not reach a related list's
 * "+ New" / row-edit / row-delete affordances, which are not fields: they are
 * resolved by the HOST (`RelatedRecordActionsBridge`) from the CHILD object's
 * `userActions` intersected with the principal's grant, and `duly_task` grants
 * `allowCreate` / `allowEdit` to every Duly position. So a viewer of this page
 * can be offered "+ New" on a task list, and no key on this page can say
 * otherwise. Object-level `userActions` would close it everywhere, which is a
 * different (and wrong) change.
 *   → INSTEAD: this page declares nothing editable it CAN decline (no `add`, no
 *     `actions`, no editable component types, `readonly` chips) and the residue
 *     is filed. `test/member-page.test.ts` pins the authorable half.
 *
 * **§4 — Related-list columns cannot cross a lookup.** `RelatedList` resolves
 * lookup LABELS but has no dotted-path column support, so "who assigned each"
 * cannot be `assignment.assigner` on a `duly_task` list.
 *   → INSTEAD: the task list carries the `assignment` column, which names the
 *     fan-out the task came out of. One click from the assigner, not zero.
 *
 * **§6 — `record:related_list` cannot bind to a multi-value field.** The other
 * route to the assigner was a list of `duly_assignment` bound on `assignees`
 * (`multiple: true`) — the field that actually names this person. It was
 * authored, run against the seeded demo, and REFUSED by the driver, because
 * `RelatedList` builds its parent filter as bare equality
 * (`{[relationshipField]: parentId}`) with no membership spelling available to
 * the author:
 *
 *     GET /api/v1/data/duly_assignment?filter=["assignees","=","<id>"]
 *     400 INVALID_FILTER — The bare equality spelling { "assignees": value }
 *     WAS NOT APPLIED: "assignees" is a multi-value (or otherwise JSON-valued)
 *     field, stored by this driver as a JSON TEXT column … Use "$contains" for
 *     membership …
 *
 * Credit where it is due: the driver refuses LOUDLY and names the working
 * spelling, so this is a gap rather than a silent wrong answer. But
 * `$contains` is not reachable from `RecordRelatedListProps` — the parent
 * filter is the component's, not the author's — so the list cannot be written
 * correctly at all.
 *   → INSTEAD: nothing. The list was removed rather than left rendering an
 *     error, and "showing who assigned each" is the one line of this card that
 *     is not fully delivered. Recorded on the issue and filed upstream.
 *
 * **§5 — Two record pages for one object resolve by declaration order.**
 * `@objectstack/platform-objects` ships `sys_user_detail`
 * (`type: 'record'`, `object: 'sys_user'`, `isDefault: true`), and
 * `usePageAssignment` picks among candidates by `(b.priority ?? 0) -
 * (a.priority ?? 0)` — but `priority` is not a key `PageSchema` declares, so an
 * author cannot write the tiebreaker the renderer reads. With both pages at 0
 * the winner is metadata load order.
 *   → INSTEAD: nothing, because there is nothing authorable. `isDefault` is
 *     left `false` here so this page never claims to be the default while the
 *     platform's page claims the same thing, and the observed resolution on
 *     this checkout is recorded in the PR.
 *
 * **§7 — The auto-appended discussion panel cannot be declined by a page, and
 * it carries a comment box.** Found in the browser, not in the schema.
 * `RecordDetailView` appends a `RecordChatterPanel` to every record page when
 * the object does not set `enable.feeds: false`, hard-coded with
 * `showCommentInput: true`, `enableReactions: true`, `enableThreading: true`.
 * `sys_user` is a platform object under `protection: { lock: 'full' }`, so the
 * object-side switch is not ours; the renderer's own opt-out —
 * `assignedPage.disableDiscussion === true`, named in its comment — is NOT a
 * key `PageSchema` declares, and `PageSchema` is a `strictObject`, so writing
 * it is a hard parse error. Same shape as §5: the renderer reads a key the
 * author cannot write.
 *   → INSTEAD, and this one IS closed: placing an EXPLICIT
 *     `record:discussion` suppresses the auto-append
 *     (`hasExplicitDiscussion`), and the explicit node's config is the
 *     author's. `feed.showCommentInput: false` is honoured — the composer is
 *     gated on `config?.showCommentInput !== false` in
 *     `RecordActivityTimeline`, with objectui's own test pinning
 *     "hides it even when the host CAN persist a comment". So the page ships
 *     the record's history with every write affordance off, which is what
 *     "read-only" has to mean here. Filed anyway: closing a write surface
 *     should not require declaring the component that opens it.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT AN EMPTY PAGE MEANS HERE
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Every list below reads `duly_task` / `duly_duty`, both `sharingModel:
 * 'private'`, both granted to managers at `readScope: 'unit_and_below'`
 * (ADR-0057). This checkout is open-edition: `@objectstack/security-enterprise`
 * is absent, the depth scopes fall back to owner-only, and the page therefore
 * looks EMPTY for anyone but yourself. That is the edition, not a defect
 * (AGENTS.md rule 7). `test/member-page.test.ts` asserts the authored scopes
 * and filters, never resolved rows — resolved rows here would only ever pin the
 * fallback.
 */
export const MemberPage = definePage({
  name: 'duly_member',
  label: 'Member',
  description:
    'One person, whole: what is open right now, what this period asks of them, what they hold permanently, and what has moved lately — read-only, entered by nobody.',
  icon: 'user-round',

  type: 'record',
  object: 'sys_user',
  template: 'default',
  kind: 'full',

  // Left FALSE deliberately — see gap §5. The platform's own `sys_user_detail`
  // already declares `isDefault: true` for this object, and two pages both
  // claiming it would make the flag a lie on whichever one loses.
  isDefault: false,

  regions: [
    // ── 1. Header — who this is ───────────────────────────────────────────
    {
      name: 'header',
      width: 'full',
      components: [
        {
          id: 'member_identity',
          type: 'record:highlights',
          properties: {
            // `readonly: true` is not decoration on these three: the chip
            // renderer's own gate refuses inline editing on a chip carrying it
            // (`HeaderHighlight`), which is the enforced half of "nothing on
            // this page is editable". All three are `readonly` on `sys_user`
            // too — `manager_id` and `primary_business_unit_id` under ADR-0092
            // — and saying it here keeps the page's promise independent of the
            // platform object's flags.
            fields: [
              { name: 'name', readonly: true },
              { name: 'primary_business_unit_id', readonly: true },
              { name: 'manager_id', readonly: true },
            ],
            layout: 'horizontal',
          },
        },
        {
          // Position is the fourth thing the header owes, and it is NOT a
          // column on `sys_user`: a position is assigned through the
          // `sys_user_position` junction, whose `position` holds
          // `sys_position.name` (ADR-0057 D4 / ADR-0090 D3). A junction is a
          // related list or it is nothing — there is no scalar to promote into
          // a chip. This is the same shape the platform's own user page uses.
          id: 'member_position',
          type: 'record:related_list',
          properties: {
            objectName: 'sys_user_position',
            relationshipField: 'user_id',
            title: 'Position',
            columns: ['position', 'business_unit_id'],
            limit: 3,
            // A person holds one or two positions, not a list worth paging.
            showViewAll: false,
          },
        },
      ],
    },

    // ── The body, in reading order ────────────────────────────────────────
    {
      name: 'main',
      width: 'full',
      components: [
        // ── 2. Right now ──────────────────────────────────────────────────
        {
          id: 'heading_right_now',
          type: 'element:text',
          properties: {
            content: { en: 'Right now', 'zh-CN': '当下' },
            variant: 'heading',
          },
        },
        {
          id: 'right_now_note',
          type: 'element:text',
          properties: {
            content: {
              en: 'Open work, then the part of it that is past its grace, then the part that has not been touched in a fortnight. The third is the one worth acting on: it is the only one that fires before a deadline does.',
              'zh-CN': '先是未完成的工作,再是其中已过宽限期的部分,最后是两周无人触碰的部分。值得立刻处理的是第三项——只有它会在到期之前就发出信号。',
            },
            variant: 'caption',
          },
        },
        {
          id: 'right_now_open',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_task',
            relationshipField: 'owner',
            title: 'Open',
            // `status` is stored and indexed; there is no `is_open` to ask and
            // there never will be (AGENTS.md rule 5).
            filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }],
            columns: ['subject', 'status', 'due_date', 'period_key'],
            sort: [{ field: 'due_date', order: 'asc' }],
            limit: 5,
          },
        },
        {
          id: 'right_now_late',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_task',
            relationshipField: 'owner',
            title: 'Late',
            // Late = past the grace the duty granted AT DISPATCH, and still
            // open. `late_after` is `due_date + duty.grace_days` stamped once
            // on the row, so this is an ordinary date comparison against a
            // stored, indexed column — the same filter `duly_task`'s `late`
            // view asks, deliberately, so one person is not late on one screen
            // and on time on another (#48).
            filter: [
              { field: 'late_after', operator: 'less_than', value: '{today}' },
              { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
            ],
            // `late_after` is carried, not just filtered on: a list that will
            // not show you why it thinks a task is late is the complaint #48
            // was about.
            columns: ['subject', 'status', 'late_after', 'period_key'],
            sort: [{ field: 'late_after', order: 'asc' }],
            limit: 5,
          },
        },
        {
          id: 'right_now_stalled',
          type: 'record:related_list',
          // The emphasis the card asks for, expressed in the one styling
          // channel that is build-independent on a metadata-authored page
          // (ADR-0065 scoped styles — an authored Tailwind `className` would
          // silently produce no CSS, since the build-time Tailwind never scans
          // runtime metadata).
          responsiveStyles: {
            large: {
              borderLeft: '3px solid #8C6512',
              paddingLeft: '12px',
            },
          },
          properties: {
            objectName: 'duly_task',
            relationshipField: 'owner',
            title: 'Not moving',
            // Stagnation: open, and untouched for a fortnight. The earliest
            // honest warning a manager gets, because it fires long before the
            // due date does.
            filter: [
              { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
              { field: 'last_update_at', operator: 'less_than', value: '{14_days_ago}' },
            ],
            columns: ['subject', 'status', 'last_update_at', 'due_date'],
            sort: [{ field: 'last_update_at', order: 'asc' }],
            limit: 5,
          },
        },

        { id: 'rule_after_right_now', type: 'element:divider' },

        // ── 3. This period ────────────────────────────────────────────────
        {
          id: 'heading_this_period',
          type: 'element:text',
          properties: {
            content: { en: 'This period', 'zh-CN': '本周期' },
            variant: 'heading',
          },
        },
        {
          id: 'this_period_note',
          type: 'element:text',
          properties: {
            content: {
              en: 'The duties the organisation put on this person — from the role catalog, or assigned by a manager. Self-declared duties are their own record-keeping and are not listed here. Frequency leads the row so a monthly rhythm reads as one block and an annual one as another.',
              'zh-CN': '组织交给这个人的职责——来自岗位职责库,或由主管指派。自行申报的职责属于本人的记录,不列在这里。频率排在每行最前,因此按月的节奏与按年的节奏各自读作一块。',
            },
            variant: 'caption',
          },
        },
        {
          id: 'this_period_duties',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_duty',
            relationshipField: 'owner',
            title: 'Governed duties',
            // `source` is the CALIBER column and the only one this product
            // lets a metric or a manager-facing lens read: `catalog` and
            // `assigned` are governed, `self` is the person's own note to
            // themselves and is never scored, ranked or surfaced up the line.
            //
            // `form: 'recurring'` because this section is about the RHYTHM.
            // One-offs have no period and standing duties have no task by
            // construction — the latter get their own section below, which is
            // the whole point of the two being different sections.
            filter: [
              { field: 'source', operator: 'in', value: ['catalog', 'assigned'] },
              { field: 'form', operator: 'equals', value: 'recurring' },
              { field: 'status', operator: 'equals', value: 'active' },
            ],
            // Frequency first — see gap §2: sorting is as close to grouping as
            // this component gets, so the grouping key has to be the thing the
            // eye lands on.
            columns: ['frequency', 'name', 'due_anchor', 'status'],
            sort: [
              { field: 'frequency', order: 'asc' },
              { field: 'name', order: 'asc' },
            ],
            limit: 20,
          },
        },

        { id: 'rule_after_this_period', type: 'element:divider' },

        // ── 4. Standing duties ────────────────────────────────────────────
        {
          id: 'heading_standing',
          type: 'element:text',
          properties: {
            content: { en: 'Standing duties', 'zh-CN': '常设职责' },
            variant: 'heading',
          },
        },
        {
          id: 'standing_note',
          type: 'element:text',
          properties: {
            content: {
              en: 'These never complete. "Keep the register current", "answer the duty phone" — they are held, not finished, so there is nothing here to tick. A control that implied otherwise would be a bug, not a convenience.',
              'zh-CN': '这些永远不会完成。「保持台账更新」「接听值班电话」——它们是被持有的,不是被做完的,所以这里没有可勾选的东西。任何暗示可以勾掉的控件都是缺陷,而不是便利。',
            },
            variant: 'caption',
          },
        },
        {
          id: 'standing_duties',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_duty',
            relationshipField: 'owner',
            title: 'Held permanently',
            // Straight from `duly_duty.form`, NOT joined through tasks: a
            // standing duty never generates one, so a task-side query would
            // return exactly nothing and read as "this person holds none".
            filter: [{ field: 'form', operator: 'equals', value: 'standing' }],
            // No `status` column and no completion anything. `duly_duty.status`
            // is active / paused / retired — lifecycle, not completion — and
            // putting it beside these rows invites reading a state machine into
            // work that has none. `business_unit` instead: whose register it is.
            columns: ['name', 'business_unit', 'source'],
            sort: [{ field: 'name', order: 'asc' }],
            limit: 20,
          },
        },

        { id: 'rule_after_standing', type: 'element:divider' },

        // ── 5. Recent activity ────────────────────────────────────────────
        {
          id: 'heading_recent',
          type: 'element:text',
          properties: {
            content: { en: 'Recent activity', 'zh-CN': '最近动态' },
            variant: 'heading',
          },
        },
        {
          id: 'recent_activity',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_task',
            relationshipField: 'owner',
            title: 'Last touched',
            // No filter: "what has moved" includes the things that moved into
            // `done`, `skipped` and `cancelled`, which are exactly the states a
            // manager is looking for evidence of. `last_update_at` is stamped
            // by `task.hook.ts` on every status change and note edit, and it is
            // indexed.
            columns: ['subject', 'status', 'last_update_at', 'period_key'],
            sort: [{ field: 'last_update_at', order: 'desc' }],
            limit: 20,
          },
        },

        { id: 'rule_after_recent', type: 'element:divider' },

        // ── 6. Assigned to them ───────────────────────────────────────────
        {
          id: 'heading_assigned',
          type: 'element:text',
          properties: {
            content: { en: 'Assigned to them', 'zh-CN': '他人指派' },
            variant: 'heading',
          },
        },
        {
          id: 'assigned_tasks',
          type: 'record:related_list',
          properties: {
            objectName: 'duly_task',
            relationshipField: 'owner',
            title: 'Assigned work',
            filter: [{ field: 'source', operator: 'equals', value: 'assigned' }],
            // `assignment` is the fan-out this task came out of, and it is as
            // close to "who assigned each" as this page can get: the assigner
            // lives one hop further on (`duly_assignment.assigner`) and BOTH
            // routes to it are closed — see gaps §4 and §6. The assignment's
            // own name is one click from the answer, which is the honest
            // remainder rather than a fake.
            columns: ['subject', 'assignment', 'status', 'due_date'],
            sort: [{ field: 'due_date', order: 'asc' }],
            limit: 20,
          },
        },

        // ── Not a seventh section — a write surface being shut ────────────
        // This node exists to REPLACE the panel the host would otherwise
        // append, not to add one. See gap §7: `RecordDetailView` appends a
        // chatter panel with a comment box, reactions and threaded replies to
        // every record page whose object does not opt out, `sys_user` cannot
        // opt out (platform object, locked), and the renderer's own
        // `disableDiscussion` escape is unauthorable. Declaring the component
        // is what takes its configuration back.
        //
        // All three writes off. What remains is the record's own change
        // history, which is read-only, is not the work log, and is not a
        // comparison to anybody. A comment box on a person's record is worse
        // than merely editable here — it is where a performance note would go,
        // on a page whose entire premise is that the manager enters nothing.
        {
          id: 'member_history',
          type: 'record:discussion',
          properties: {
            position: 'bottom',
            collapsible: false,
            feed: {
              showCommentInput: false,
              enableReactions: false,
              enableThreading: false,
              showFilterToggle: false,
              showSubscriptionToggle: false,
            },
          },
        },
      ],
    },
  ],
});
