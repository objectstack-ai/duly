// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P, defineView } from '@objectstack/spec';

const data = { provider: 'object' as const, object: 'duly_task' };

/**
 * The columns every task grid carries.
 *
 * `progress` and `attachments` were appended by #108 rather than woven into
 * the order, which keeps the blast radius of that card to two extra columns on
 * four lenses instead of a re-ordering nobody asked for. `my_week` — the
 * frontline screen the deck's p16 draws — states its own order below.
 *
 * ── Why the deck's "最新进展 (= progress 或 note)" is TWO things, not one ──
 * The card asks for one column showing the progress phrase or, failing that,
 * the note. There is no authorable way to say that, and every way of faking it
 * is worse than the honest pair:
 *
 *   a stored `latest_progress`   needs a writer on every note and phrase edit
 *                                — the maintained-flag shape AGENTS.md rule 5
 *                                forbids, and it lies the day the writer skips.
 *   a formula field              is virtual, so a filter naming it silently
 *                                matches nothing (rule 5 again), and a formula
 *                                over a select renders the STORED value —
 *                                `on_time`, not "Finished on time".
 *
 * So the grid carries `progress`, which is the tappable one and the one that
 * is short enough to be a column; `note` is a paragraph and lives on the
 * record, in the same "Progress and attachments" group. Nothing is hidden: the
 * phrase is what the frontline person is being asked for.
 */
const columns = [
  { field: 'subject' },
  { field: 'status' },
  { field: 'due_date' },
  { field: 'period_key' },
  { field: 'owner' },
  { field: 'source' },
  { field: 'progress' },
  { field: 'attachments' },
];

/**
 * Bulk complete and bulk skip — declarative, and the ONLY declarative field
 * write the platform offers.
 *
 * `operation: 'update'` with a static `patch` IS the platform's "set these
 * fields on every selected record": no action, no handler, no code. The write
 * runs on the data plane under the CALLER's own permissions — strictly safer
 * than N dispatches through an action handler's `ctx.engine`, which is
 * system-elevated and RLS-bypassing by design.
 *
 * A week's worth of ticks in one gesture is the difference between a Monday
 * habit and a chore, so this is not a convenience: it is the same interaction
 * budget as the row tick, applied to the week.
 *
 * ── `visible` here is the OUTER of two layers ─────────────────────────────
 * It is evaluated once PER SELECTED RECORD, and the run covers only the rows
 * that pass, which is what keeps an already-`done` row out of the batch. That
 * matters for a reason that is MEASURED rather than theoretical: a predicate
 * update carries ONE payload for all N rows (`driver.updateMany` takes one SET
 * clause), so `task.hook.ts` stamping `completed_at` for a row that is
 * genuinely transitioning would write that timestamp to the whole batch —
 * silently re-dating a task completed days ago.
 *
 * A view predicate is a client-side hide, though, and the write it guards is
 * server-side: an import, a backfill, the dispatcher or an MCP caller
 * reassembles the same batch without ever reading this file. So the authority
 * lives at the write. `task.hook.ts` REFUSES a predicate write that would
 * re-stamp an already-done row (`DULY_TASK_BULK_ALREADY_DONE`, 409) — the one
 * route ADR-0058 Addendum II D3 sanctions for a row-conditional decision on a
 * batch-scoped payload.
 *
 * ── A second refusal on the same route: a LATE completion ────────────────
 * Since #52 a completion also stamps `completed_late`, and that verdict is read
 * off the row's own `late_after` — so one batch cannot carry two answers. The
 * hook refuses a bulk completion whose row would be stamped late
 * (`DULY_TASK_BULK_LATE_COMPLETION`, 409) and stamps `false` otherwise, which
 * every row that survived its own guard would have written.
 *
 * **The action below is unaffected, and that is measured rather than hoped
 * for.** The toolbar does not issue a predicate write at all: recorded against
 * a live `pnpm demo`, selecting two rows and pressing Complete sends
 * `POST /api/v1/data/duly_task/updateMany` with `records: [{ id, data }, …]` —
 * one payload PER RECORD. A selection of one late and one on-time task
 * completed in one gesture, with `completed_late` landing `true` and `false` on
 * the right rows. The shared payload the hook guards is the `multi: true` +
 * `where` shape an import, a backfill or an MCP caller assembles, which is
 * exactly the caller that never reads this file.
 *
 * So that refusal deliberately has NO predicate half here — and it would be
 * the wrong place for one anyway. It turns on the completion instant against a
 * stored date, a boundary that moves at midnight between the render and the
 * write, so a client-side copy would sooner or later hide an action the server
 * would have accepted. A missing bulk action with no explanation is worse than
 * a refusal that names its cause.
 *
 * This predicate is kept because it is still the right UX: it stops the
 * console from assembling a batch the server would refuse, so a user gets an
 * unavailable action rather than an error they did not cause.
 * `test/task-hook.test.ts` pins the refusal; `test/task-actions.test.ts` pins
 * both layers.
 *
 * Labels are plain strings: an authored def is not i18n-resolved. That is a
 * real cost, accepted here because the repo carries no translation bundle yet
 * (`dulyTranslations` is empty) and the alternative — promoting the row
 * actions via `bulkActions: ['duly_task_complete']` — is N action dispatches
 * through the elevated facade instead of one data-plane write.
 */
const bulkActions = [
  {
    name: 'duly_task_bulk_complete',
    label: 'Complete',
    icon: 'check',
    variant: 'primary' as const,
    operation: 'update' as const,
    // The complete payload, same one field as the row action. No
    // `completed_at`: the hook owns it, and it is readonly to callers.
    patch: { status: 'done' },
    confirmText: 'Mark the selected tasks done.',
    confirmLabel: 'Complete',
    visible: P`record.status == "open" || record.status == "in_progress"`,
  },
  {
    name: 'duly_task_bulk_skip',
    label: 'Skip',
    icon: 'skip-forward',
    variant: 'secondary' as const,
    operation: 'update' as const,
    patch: { status: 'skipped' },
    // One reason for the whole selection. That is honest for the case this
    // exists to serve — a plant shutdown skips the week together — and the
    // per-task wording stays available on the row action.
    params: [
      {
        name: 'skip_reason',
        label: 'Why skipped',
        type: 'text' as const,
        required: true,
        placeholder: 'The plant was down — there was nothing to return',
        help: 'Recorded on every task in the selection.',
      },
    ],
    visible: P`record.status == "open" || record.status == "in_progress"`,
  },
];

/**
 * Task views.
 *
 * `my_week` is the screen the product lives or dies on. It asks the stored,
 * indexed columns — `owner`, `status`, `visible_from` — and nothing derived, so
 * it stays correct without a maintenance writer behind it.
 */
export const TaskViews = defineView({
  /**
   * ── Which lenses are inline-editable, and why it is not all of them ─────
   * `my_week` and `board` are the OWNER's screens and both take inline edits
   * (#108). `list` here and the three manager lenses below — `late`,
   * `stalled`, `by_unit` — deliberately do not: "Managers do not enter status.
   * Assigning is their only write" is a product invariant, and a status or
   * progress cell that edits in place on a team lens is an invitation to break
   * it one row at a time. Nothing is lost — the row action and the record page
   * are still there for a person editing their own task.
   */
  list: {
    label: 'All tasks',
    type: 'grid',
    data,
    columns,
    bulkActionDefs: bulkActions,
    sort: [{ field: 'due_date', order: 'asc' }],
  },

  listViews: {
    /**
     * The frontline screen (deck p16). Column order is the deck's, read left
     * to right the way the work is: what state it is in, what it is, who put
     * it there, when it is owed, what the last word on it was, and whether
     * anything is attached.
     *
     * ── `inlineEdit` is what makes the phrase one tap ────────────────────
     * Without it the row is read-only and reporting progress costs a record
     * page. With it the grid renders the select in the cell and the write is
     * the ordinary data-plane update under the caller's own permissions — the
     * same authority as the row action, no handler anywhere. `status` and
     * `progress` are the two columns worth touching from here; the rest are
     * server-owned or administrative, and a user who may not write a column
     * gets the platform's refusal rather than a silent no-op.
     *
     * ── The due column needs no `format` key ─────────────────────────────
     * Measured on @objectstack/console 17.2.0: the date cell defaults to
     * `format: 'relative'` and derives "due-like" from the FIELD NAME (a
     * `/(^|_)(due|deadline|…)(_|$)/` test, which `due_date` matches), so it
     * already renders `Tomorrow` / `In 3 days` / `Overdue 5d` inside a
     * ±7-day window and an absolute date outside it. The card's fallback — a
     * `late_after` column standing in for "逾期 N 天" — is therefore NOT
     * needed here, and `late_after` stays where it earns its place, on the
     * `late` lens that filters by it.
     */
    my_week: {
      label: 'My week',
      type: 'grid',
      data,
      columns: [
        { field: 'status' },
        { field: 'subject' },
        { field: 'source' },
        { field: 'due_date' },
        { field: 'progress' },
        { field: 'attachments' },
      ],
      inlineEdit: true,
      filter: [
        { field: 'owner', operator: 'equals', value: '{current_user_id}' },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'visible_from', operator: 'less_than_or_equal', value: '{today}' },
      ],
      bulkActionDefs: bulkActions,
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    /**
     * Late = past the GRACE the duty granted, and still open.
     *
     * `late_after` is `due_date + duty.grace_days`, stamped on the row at
     * dispatch (`src/jobs/dispatch.plan.ts`), so the filter here is an ordinary
     * date comparison against a stored, indexed column — no column-to-column
     * comparison, no date arithmetic, nothing this grammar cannot say.
     *
     * It reads a stored column, and that is still not a stored FLAG. An
     * `is_late` boolean would need a writer running every midnight and would
     * lie on the day it did not run; `late_after` is a date the row was born
     * with, and the clock moving past it is what makes the row late. The
     * comparison still happens at read time — it just has both operands now.
     *
     * ── What changed, and why the old comment is gone ────────────────────
     * This view used to filter `due_date < {today}` and say, in its own
     * comment, that reading stored columns was the point — which was right —
     * without mentioning that it was also dropping grace. A duty granting 7
     * days had its people listed as late the morning after the due date, six
     * days early, while the overdue escalation (which DOES read `grace_days`)
     * correctly stayed silent: one system, two answers about the same person on
     * the same day. That was #48, and both surfaces now answer from the same
     * stamp.
     *
     * ── The write-once consequence, named so the next reader finds it ────
     * `late_after` carries the grace in force AT DISPATCH. Edit a duty's
     * `grace_days` and tasks already dispatched keep the deadline they were
     * born with, so this list does not move for them. That is deliberate — a
     * task records what was owed when it was owed — and the place a replay
     * belongs is `duly_catalog_sync`, which already exists to push duty edits
     * onto instantiated records. It does not do this today, and this card did
     * not build it.
     *
     * A task with no `due_date` has no `late_after` and never appears here.
     * That is the honest answer: nothing was owed by any particular day.
     */
    late: {
      label: 'Late',
      type: 'grid',
      data,
      // `late_after` is carried as a column, not just filtered on: the whole
      // complaint behind #48 was a screen that would not show you why it
      // thought a task was late.
      columns: [...columns, { field: 'late_after' }],
      filter: [
        { field: 'late_after', operator: 'less_than', value: '{today}' },
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
      ],
      bulkActionDefs: bulkActions,
      sort: [{ field: 'late_after', order: 'asc' }],
    },

    // Stagnation: open, and untouched for a fortnight. This is the earliest
    // honest warning a manager gets — earlier than any completion percentage,
    // because it fires long before the due date does.
    stalled: {
      label: 'Not moving',
      type: 'grid',
      data,
      columns: [...columns, { field: 'last_update_at' }],
      filter: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'last_update_at', operator: 'less_than', value: '{14_days_ago}' },
      ],
      bulkActionDefs: bulkActions,
      sort: [{ field: 'last_update_at', order: 'asc' }],
    },

    calendar: {
      label: 'Calendar',
      type: 'calendar',
      data,
      columns: [{ field: 'subject' }, { field: 'status' }, { field: 'owner' }],
      // A calendar view with no `calendar` block binds to literal default field
      // names and renders empty while authoring reports success. Bind it.
      calendar: {
        startDateField: 'due_date',
        titleField: 'subject',
        colorField: 'status',
      },
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    /**
     * Kanban. Columns come from `duly_task.status` — the renderer reads the
     * field's own `options` for the column set, their order and their labels
     * (measured in the console's `plugin-kanban`), so the board cannot drift
     * from the object.
     *
     * Dragging a card writes ONE field. Measured against the renderer's move
     * handler: `dataSource.update(object, id, { [groupBy]: toColumnId })` —
     * `status` and nothing else, which is the same write the row action does.
     * It is NOT gated on `inlineEdit`; it is gated on update permission, so a
     * user who may not write `status` gets the platform's rejection rather
     * than a silent no-op.
     *
     * `inlineEdit` is still declared, and it is not decoration: the toolbar
     * lets a viewer switch this view to its grid visualisation, and the
     * adapter honours `inlineEdit` on that branch (`editable:` is set in the
     * grid case only). On the kanban branch itself it is inert.
     *
     * No `summarizeField`: it renders a per-column SUM, and there is no number
     * on a task worth totalling. The nearest candidate would be a count, and
     * counts are never ranked or compared here.
     *
     * ── The card face is `kanban.columns`, and `cardFields` is not authorable ─
     * Measured, because the deck (p17) asks for it by the renderer's name.
     * `KanbanConfigSchema` in `@objectstack/spec/ui` is a STRICT object with
     * exactly `groupByField`, `summarizeField` and `columns` — so
     * `kanban.cardFields` is refused by `pnpm validate` rather than silently
     * ignored, which is the good failure and the opposite of the gantt block's
     * passthrough trap documented below. The console's view relay then reads
     * `cardFields: kanban.cardFields || kanban.columns || …`, so the authorable
     * spelling IS `columns` and it lands on the card. Nothing to file.
     *
     * ⛔ SWIMLANES ARE NOT AUTHORABLE — do not add a `swimlaneField` here.
     * The renderer supports them (`ObjectKanban` takes `swimlaneField` and
     * derives one from a relayed `grouping.fields[0].field`), but no authoring
     * route reaches it on this build: the strict schema above has no such key,
     * and the `ObjectView` relay this app's views go through does not forward a
     * view-level `grouping` to the kanban branch. Filed at
     * objectstack-ai/objectui — see the PR body. Grouping by source is
     * therefore expressed as what IS authorable and true today: `source` on the
     * card face, and the `by_unit` lens for a grouped read.
     */
    board: {
      label: 'Board',
      type: 'kanban',
      data,
      // The projection is built from `columns` alone — `kanban.columns` does
      // not contribute to it on the `ObjectView` relay, so a card field that
      // is not here arrives `undefined` and renders blank with nothing in
      // error. Same lesson as `business_unit` on `by_unit` below.
      columns: [
        { field: 'subject' },
        { field: 'due_date' },
        { field: 'owner' },
        { field: 'source' },
        { field: 'progress' },
      ],
      kanban: {
        groupByField: 'status',
        // The card face, in reading order: what it is, when it is owed, whose
        // it is, where it came from, and the last word on it (#108, deck p17).
        //
        // `owner` stays even though the deck lists only source · due ·
        // progress: this lens carries no owner filter, so on an account that
        // can see other people's rows a face without a name is ambiguous
        // rather than clean.
        columns: ['subject', 'due_date', 'owner', 'source', 'progress'],
      },
      inlineEdit: true,
      sort: [{ field: 'due_date', order: 'asc' }],
    },

    /**
     * Gantt. The bar runs `visible_from` → `due_date`, and that span IS the
     * lead time: a bar that starts on its own due date is a task that first
     * appeared the day it was already owed, which is a report on a failure
     * rather than a reminder. `lead_days` on the duty is what produces the
     * length, and this is the only screen where you can see it.
     *
     * Grouped by owner so an overloaded fortnight is visible as one person's
     * row going solid, before the period arrives.
     *
     * The two DATE rules in the filter are not a scope narrowing, they are a
     * correctness one: the renderer maps a missing date to `new Date()`, so an
     * undated one-off would draw a zero-width bar on TODAY and read as load
     * that does not exist. Both columns are stored and indexed; the unary
     * operators carry their direction in the name and take no value. The third
     * rule IS a scope decision, and it has its own block above `filter`.
     *
     * No `colorField`, deliberately, and this is measured rather than an
     * oversight: the gantt renderer passes `record[colorField]` straight into
     * `backgroundColor`, so `colorField: 'status'` sets `background: "open"` —
     * not a colour, silently dropped, every bar identical. With the key
     * ABSENT the same renderer falls through to its status-derived palette and
     * the bars separate by state. Filed upstream; see the PR body.
     *
     * ── Two rendering defects on this screen are the RENDERER'S ─────────────
     * Both were reproduced in a browser against the seeded demo, diagnosed to
     * `plugin-gantt`, and filed upstream rather than worked around here. They
     * are recorded because the screen a reader of this file will open still
     * shows them, and the first one makes the page look wrong in a way that
     * invites "fixing" the metadata:
     *
     *  1. **The toolbar month label disagrees with the columns**
     *     (objectstack-ai/objectui#7203). It reads `January 2026` over columns
     *     showing late August, because the renderer formats the timeline
     *     RANGE START — `min(visible_from) - 7d` over the whole result set —
     *     and never the visible window. Our earliest seeded task starts 1/31,
     *     so the label is pinned to January for every scroll position. The
     *     renderer's own band header one row lower reads `Aug 2026` / `Sep
     *     2026` off the same frame, which is how you can tell the columns are
     *     right and the label is wrong. Nothing in this block moves it, and
     *     no filter here should be narrowed to make the label look better —
     *     narrowing the range would only move which wrong month it shows.
     *
     *  2. **Task names truncate to ~7 characters**
     *     (objectstack-ai/objectui#7204). Measured: the task-list panel is a
     *     fixed 320px at every viewport width, its Start/End sub-columns take
     *     160px of that, and the title span is left 53px against the 260px
     *     `Site environmental audit — Northgate` needs. Dragging the splitter
     *     to 580px renders every name in full, so it is width and nothing
     *     else.
     *
     *     ⛔ The width is NOT authorable, and the way it is not authorable is
     *     a trap: `GanttConfigSchema` is a passthrough object, so an invented
     *     `gantt.taskListWidth` here would pass `pnpm validate`, survive into
     *     `dist/objectstack.json`, and be read by nothing. A key that lints
     *     clean and does nothing is worse than the defect — it reads to the
     *     next author as a setting that works. Do not add one.
     *
     * ── `viewMode: 'week'` is authored and currently inert ──────────────────
     * Measured, and NOT a third defect to file: the console pinned by
     * framework 17.2.0 does not forward the gantt block's `viewMode` to the
     * timeline branch, so this screen renders day columns and the Day button
     * is the pressed one. Upstream already fixed it — objectui#5074, landed in
     * objectui PR #5825 with its own pin test — and our console predates that
     * build. So this is version lag, not a gap, and it needs no card.
     *
     * The key stays authored: it is declared in the spec's `GanttConfigSchema`,
     * it is what we actually want (a week's granularity is the unit a manager
     * plans in), it is served to API and MCP callers reading this view today,
     * and it starts working on the next console refresh with no edit here.
     * ⛔ Do not delete it as dead metadata on the evidence of the Day button.
     */
    schedule: {
      label: 'Schedule',
      type: 'gantt',
      data,
      columns: [
        { field: 'subject' },
        { field: 'status' },
        { field: 'owner' },
        { field: 'visible_from' },
        { field: 'due_date' },
      ],
      gantt: {
        startDateField: 'visible_from',
        endDateField: 'due_date',
        titleField: 'subject',
        groupByField: 'owner',
        viewMode: 'week',
        tooltipFields: [{ field: 'status' }, { field: 'period_key' }, { field: 'source' }],
      },
      /**
       * ⚠ SCOPE — the `status` rule below is a DECISION, not a correctness
       * fix, and `test/metadata-bindings.test.ts` fails if it is dropped or
       * re-spelled. The two date rules beside it are the correctness ones; see
       * the block above.
       *
       * ── Why this lens is scoped to open work ───────────────────────────
       * A manager opens this to see an overloaded fortnight before it arrives.
       * Nothing about that question involves work that is already finished, and
       * on the #75 seed 151 of the 186 scheduled tasks are `done` — most of them
       * months old — so unscoped the screen spends nearly all of its height
       * drawing completed bars. Scoped, it draws the 33 rows (27 `open` + 6
       * `in_progress`) the question is about. Same decision, same reasoning, as
       * `by_unit` below, and it survives the platform being fixed: even with
       * server-side ranging we would not want a gantt of finished tasks.
       *
       * ── What it is NOT doing — measured before changing anything ─────────
       * The card that asked for this read the footer under the chart — "100
       * records · Showing first 100 records. More data may be available." — and
       * argued that the timeline range and the owner grouping were therefore
       * computed over a 100-row slice, the way `by_unit`'s group counts
       * genuinely are. Reproduced in a browser against `pnpm demo` first, and
       * on this console build that is NOT what happens. One page load, two
       * fetches of the same filtered set:
       *
       *   ?populate=owner&top=100&select=…&filter=…   → 100 rows   ← the footer
       *   ?sort=visible_from&filter=…                 → 186 rows   ← the chart
       *
       * The chart is served by the non-grid fetch, which sends no `top` at all,
       * and `@objectstack/rest` applies no cap when `limit` is absent — so it
       * gets the whole result set. Counted off the DOM rather than inferred:
       * 186 task rows + 12 group rows = 198 rows × 40px = the 7920px the task
       * list scrolls. All 12 owners carrying scheduled work had a group,
       * including the one whose only task falls outside the 100-row page, and
       * the range read 2026-01-31 → 2026-12-31 — the true span of the whole
       * set, not the page's 2026-06-30.
       *
       * So this filter is not restoring a missing owner: there was not one. Do
       * not read it, or cite it, as though there were. What it removes is a
       * lens full of finished work, and a "more data may be available" warning
       * printed under a chart that was in fact complete.
       *
       * ── The residual ─────────────────────────────────────────────
       * The paged fetch is real, still runs, and the footer already reads off
       * it. Nothing in this repo decides which of the two the chart consumes,
       * so a console change that pointed the gantt at the paged one would make
       * the card's mechanism true — and on a gantt it lands harder than on a
       * grid, because the timeline RANGE is derived from the rows in hand: the
       * chart would draw the wrong SPAN rather than merely omit bars. Scoping
       * keeps this deployment's result set inside a page either way, which is a
       * size and not a mechanism. The grid half is objectstack-ai/objectui#7189;
       * the two-fetch/footer mismatch measured above is filed separately — see
       * the PR body.
       *
       * ⛔ Not a page-size raise. It would move the cliff rather than remove
       * it, and on the evidence above the page size is not what is holding this
       * chart together.
       *
       * ⚠ It DOES move objectui#7203's wrong month label: the toolbar formats
       * `min(visible_from) - 7d`, which goes from January to late June. A side
       * effect, not a reason — the label is still wrong, only about a different
       * month now, and no filter here should ever be chosen to improve it.
       */
      filter: [
        { field: 'status', operator: 'in', value: ['open', 'in_progress'] },
        { field: 'visible_from', operator: 'is_not_null' },
        { field: 'due_date', operator: 'is_not_null' },
      ],
      sort: [{ field: 'visible_from', order: 'asc' }],
    },

    /**
     * Timeline — the visual companion to `stalled`. Ordered by
     * `last_update_at`, which `task.hook.ts` stamps on a status change or a
     * note edit and deliberately does NOT advance on an administrative write,
     * so this really is "what has been happening" and not "what has been
     * touched".
     *
     * `colorField` earns its place here: the timeline renderer resolves it
     * against the object's own `status` options and uses the AUTHORED colours
     * (`#35674D` for done, and so on), so this lens and the status badge in
     * every grid read the same.
     */
    recent: {
      label: 'Recent activity',
      type: 'timeline',
      data,
      columns: [{ field: 'subject' }, { field: 'status' }, { field: 'owner' }, { field: 'last_update_at' }],
      timeline: {
        startDateField: 'last_update_at',
        titleField: 'subject',
        colorField: 'status',
        scale: 'day',
      },
      sort: [{ field: 'last_update_at', order: 'desc' }],
    },

    /**
     * Outstanding work, bucketed by team. `business_unit` is denormalised onto
     * the task at dispatch precisely so a rollup like this survives a later
     * transfer.
     *
     * Groups sort by LABEL — measured in the grid's grouping hook, which sorts
     * group keys with a locale compare on the label and never on the bucket
     * size. Nothing here ranks a unit, or a person, by a count.
     */
    by_unit: {
      label: 'By business unit',
      type: 'grid',
      data,
      /**
       * The residual, stated for the reader of the SCREEN and not only for the
       * reader of this file, because the filter below does NOT make the
       * mechanism correct — it makes this deployment fit inside it. The
       * grouping and its per-group counts are computed over the FETCHED PAGE,
       * so the numbers in the group headers are true only while the filtered
       * set fits in one. The dashboard's by-unit figures come from the
       * `duly_stagnation` dataset and are aggregated server-side over the
       * whole store; those are the authoritative ones, and this lens is for
       * browsing.
       *
       * ⚠ It does NOT reach the screen today, and that is measured rather
       * than assumed. The value survives every layer — it is in
       * `dist/objectstack.json` and in `GET /api/v1/meta/view/duly_task` —
       * but the console's `ObjectView` relay builds its ListView schema by
       * spreading the OBJECT's list view and relaying `label`, `sort`,
       * `filter` and friends off the active view, and `description` is not
       * one of the keys it relays. `ListView` has the branch that would
       * render it (`data-testid="view-description"`); the value never
       * arrives, so nothing is displayed and nothing errors. Filed as
       * objectstack-ai/objectui#7199.
       *
       * It stays authored anyway, and that is deliberate: this is the key the
       * spec defines for exactly this sentence, it IS served to API and MCP
       * callers reading the view today, and it starts rendering the moment
       * the relay is fixed. What must not happen is someone reading this file
       * and believing the caveat is currently in front of users. Written as a
       * PLAIN STRING on purpose: the renderer takes
       * `typeof description === 'string' ? description : ''`, so an inline
       * `{ en, 'zh-CN' }` locale map would render empty even after the relay
       * is fixed (second half of #7199).
       */
      description:
        'Open and in-progress work only. Group counts are computed over the loaded page — the '
        + 'dashboard is the authoritative by-unit surface; this lens is for browsing.',
      /**
       * `business_unit` is in the columns because the grid's query
       * projection is built from `columns` ALONE — `grouping` contributes
       * nothing to it. Measured on the seeded app: without this the request
       * was `select=id,subject,status,due_date,period_key,owner,source`, the
       * field arrived `undefined` on all 186 rows, and the renderer bucketed
       * every one of them into a single `(empty)` group. Nothing errored and
       * every gate stayed green.
       *
       * Filed upstream as objectstack-ai/objectui#7179 — the projection
       * should union the grouping fields rather than making authors mirror
       * them here. This is not a workaround waiting on it: on a by-unit view
       * the unit column is worth showing anyway, and it is the shared six
       * plus one rather than a column every other lens has to carry.
       * `test/metadata-bindings.test.ts` fails if a grouped grid ever drops
       * it again.
       */
      columns: [...columns, { field: 'business_unit' }],
      grouping: { fields: [{ field: 'business_unit' }] },
      /**
       * ⚠ LOAD-BEARING FOR THE GROUPING — not a scope preference, and not a
       * default worth inheriting. Widen it and the lens silently goes wrong
       * again, in the way described below. `test/metadata-bindings.test.ts`
       * fails if it is dropped or widened.
       *
       * ── What it is holding up, measured on the #75 seed ──────────────────
       * The grid groups CLIENT-SIDE over the rows already fetched, and its
       * per-group counts are `computeAggregations` over that same array
       * (objectui's `useGroupedData`). There is no server-side grouping path
       * for a grid at all, so a grouped grid can only be a complete roll-up
       * while its whole result set fits in one page.
       *
       * Unfiltered, this lens did not. The store holds 186 tasks — 151 of them
       * `done`, most from months ago — across FIVE business units, and the
       * request is `top=100`:
       *
       *   Northgate Operations  33     store: 61
       *   Northgate Plant        3     store:  7
       *   Northgate Quality     46     store: 86
       *   Riverside Plant       18     store: 31
       *   (Central Office)       —     store:  1   ← no group at all
       *                        ───
       *                        100     "Showing first 100 records."
       *
       * Two failures, and the second is the sharper one. Every count in the
       * header was a page slice reading as a total. And one unit had NO GROUP
       * ON THE SCREEN, with nothing saying a unit was missing — a wrong number
       * invites a second look, an absent row does not.
       *
       * Scoped to open work the lens fits: 27 `open` + 6 `in_progress` = 33
       * rows, one page, all five units present, every count true. That is also
       * the better lens on its own merits — "what is outstanding, by unit" is
       * the question a manager opens this for, and nobody wants a by-unit
       * breakdown of work that finished six months ago. It survives the
       * platform being fixed: even with server-side grouping we would not want
       * this lens spending its first page on completed tasks.
       *
       * ── Why not simply raise the page size ──────────────────────────────
       * It moves the cliff instead of removing it, and hides the next
       * occurrence. With a filter that fits, the page size is not what is
       * holding the lens together.
       *
       * ── What stays broken ───────────────────────────────────────────────
       * This remains STRUCTURALLY page-scoped. A deployment with more open
       * tasks than a page hits exactly this again, with the same silent
       * missing group. The filter buys a correct lens at this product's
       * realistic scale, not a correct mechanism. The durable fix is upstream:
       * objectstack-ai/objectui#7189 asks for server-side grouping and true
       * per-group counts on a grid — the platform already does this for the
       * dashboard through a dataset, just not on this surface. The `description`
       * above is where that is said to users — subject to objectui#7199,
       * which currently keeps a per-view description off the screen entirely,
       * so today this comment and the counts' own arithmetic are the whole
       * disclosure.
       */
      filter: [{ field: 'status', operator: 'in', value: ['open', 'in_progress'] }],
      bulkActionDefs: bulkActions,
      sort: [{ field: 'due_date', order: 'asc' }],
    },
  },
});
