// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { P } from '@objectstack/spec';
import { ObjectSchema, Field } from '@objectstack/spec/data';

/**
 * `duly_task` — ONE occurrence of a duty, owed by ONE person, for ONE period.
 *
 * Everything a person is expected to tick lives here. The identity of a task is
 * `(duty, owner, period_key)` and it is enforced by a unique index, so the
 * dispatcher can be re-run, backfilled, or crash halfway through without ever
 * producing a duplicate. That constraint is the reason the dispatcher can be a
 * plain idempotent job instead of a distributed lock.
 *
 * ── What is deliberately NOT a field here ────────────────────────────────
 * `is_late` / `is_open` / `is_overdue`: a MAINTAINED flag, whose truth changes
 * with the clock rather than with the record. It needs a writer that runs every
 * midnight, and the day it does not run the flag lies without erroring; a
 * formula field is virtual instead, so a filter naming one silently matches
 * nothing. Consumers ask `status` and `due_date` directly.
 *
 * `late_after` and `completed_late` below are NOT that shape, and the boundary
 * is written out under `AGENTS.md` rule 5. Each is stamped ONCE, at the moment
 * it becomes knowable — dispatch and completion — and is never recomputed, so
 * no writer has to keep running for them to stay true. They are the same
 * category as `completed_at` and `visible_from`, which sit beside them.
 *
 * `progress_percent`: a number nobody can verify, which becomes the number
 * everyone reports on. Progress lives in `status`, in `last_update_at`, and —
 * since #108 — in the `progress` PHRASE below, which is a sentence a person
 * chose and not a quantity anyone can average.
 *
 * ── `progress` is a phrase, NOT a measurement ────────────────────────────
 * Four preset phrases + the free-text `note` beside it. It exists because the
 * frontline gesture the product promises is one tap: "已下发各部门" is what
 * the person would have typed, so it is offered as an option instead. It is
 * SELF-REPORTED, and nothing derives a number from it:
 *
 *   the on-time verdict is `completed_late`, stamped by the server from
 *   `completed_at` against `late_after` — never from this column.
 *
 * ⛔ Do not build a rate, a rollup or a ranking on `progress`. The `on_time`
 * option is a person's own words about their own work; reading it as evidence
 * would make the phrase a scored field, and then nobody picks the honest one.
 * `duly_stagnation` and the duty-health measures deliberately do not name it.
 *
 * ── `attachments` is never a gate ────────────────────────────────────────
 * A product invariant, not a preference (AGENTS.md — "Completion never
 * requires evidence, a note, or a percentage"). The field is optional on every
 * path, no validation rule names it, and `test/invariants.test.ts` plus
 * `test/task-hook.test.ts` pin both halves — the metadata AND a real booted
 * engine completing a task that carries no file at all.
 *
 * `enable.files` (below) and this field are two different affordances and both
 * are wanted: `enable.files` is the record's own attachment area, and
 * `attachments` is a COLUMN, which is what lets the list show a paperclip and
 * the record form put the files inside the "Progress and attachments" group
 * next to the phrase they belong to.
 */
export const Task = ObjectSchema.create({
  name: 'duly_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  icon: 'check-square',
  description: 'One dispatched occurrence of a duty, owed by one person for one period.',

  sharingModel: 'private',

  /**
   * The record page, in three sections (#108 · deck p7).
   *
   * ── How a group reaches the screen, measured on 17.2.0 ──────────────────
   * Field → group mapping is derived from `Field.group` matching a `key` here;
   * in-group order is the traversal order of `fields` below, and a field whose
   * `group` is unset lands in a trailing ungrouped bucket. The console's form
   * runs the spec's own `deriveFieldGroupLayout` and turns each group into a
   * section whose `name` is this `key` — which is also what makes the label
   * translatable: it is resolved as `objects.duly_task._sections.<key>.label`.
   * (`translateObject` does NOT rewrite `fieldGroups[].label` server-side; the
   * console resolves it from the bundle. `src/translations/authored-text.ts`
   * carries the measurement.)
   *
   * ── The rule for which group a field is in ──────────────────────────────
   * `history` is exactly the SERVER-OWNED stamps — every `readonly` column and
   * nothing else. That is a rule rather than a taste, so it is pinned in
   * `test/invariants.test.ts`: a new readonly stamp that is not filed here
   * would otherwise appear in the middle of the edit form, reading as a field
   * somebody forgot to make editable. Collapsed by default because it is the
   * audit trail, not the day's work.
   */
  fieldGroups: [
    { key: 'basics', label: 'Basics', icon: 'clipboard-list' },
    { key: 'progress', label: 'Progress and attachments', icon: 'message-square' },
    { key: 'history', label: 'History', icon: 'history', collapse: 'collapsed' },
  ],

  fields: {
    subject: Field.text({
      label: 'Task',
      group: 'basics',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Copied from the duty at dispatch, so renaming a duty does not rewrite history.',
    }),

    duty: Field.lookup('duly_duty', {
      label: 'Duty',
      group: 'basics',
      description: 'Empty for a bare one-off that was never modelled as a duty.',
    }),

    owner: Field.user({
      label: 'Owner',
      group: 'basics',
      required: true,
      defaultValue: 'current_user',
    }),

    business_unit: Field.lookup('sys_business_unit', {
      label: 'Business unit',
      group: 'basics',
      description: 'Denormalised from the owner at dispatch so rollups survive a later transfer.',
    }),

    assignment: Field.lookup('duly_assignment', {
      label: 'Assignment',
      group: 'basics',
      description: 'Set when this task came out of a manager fan-out. One assignment, N independent tasks.',
    }),

    // Same caliber rule as the duty. Metrics read this column and only this
    // column; `self` never enters an on-time rate or a comparison.
    source: Field.select({
      label: 'Source',
      group: 'basics',
      required: true,
      options: [
        { label: 'Role catalog', value: 'catalog', color: '#16515F' },
        { label: 'Assigned by manager', value: 'assigned', color: '#8C6512' },
        // The default. Both manufactured producers stamp this explicitly and
        // do not rely on it: the dispatcher copies `duty.source` onto every
        // dispatched task (`dispatch.plan.ts` — `source: duty.source ?? ''`,
        // never omitted from the draft), and the assignment fan-out writes
        // `source: 'assigned'` directly on both `create_record` nodes
        // (`assignment.flow.ts`). The path that actually reaches this
        // default is `duly_member`'s `allowCreate: true` on `duly_task`
        // (`permission-sets.ts`) with no create form stamping `source` — a
        // member hand-creating their own task, which is self-declared by
        // definition (#55).
        { label: 'Self-declared', value: 'self', color: '#576B73', default: true },
      ],
    }),

    // ── Period identity ───────────────────────────────────────────────────
    // ISO-ish period key: 2026-W34 · 2026-08 · 2026-Q3 · 2026-H2 · 2026 ·
    // 2026-08-21 (daily). Produced by `src/functions/period.ts` so every
    // producer agrees on the spelling.
    period_key: Field.text({
      label: 'Period',
      group: 'basics',
      maxLength: 16,
      description: 'Empty for one-off tasks, which have no period.',
    }),

    due_date: Field.date({ label: 'Due', group: 'basics' }),

    visible_from: Field.date({
      label: 'Shows up on',
      group: 'basics',
      description: 'due_date minus the duty lead time. Before this the task exists but stays out of the way.',
    }),

    /**
     * `due_date + duty.grace_days`, stamped ONCE at dispatch. The last day a
     * task may still be open, or be completed, without being late.
     *
     * ── Why it is stored and not asked ───────────────────────────────────
     * "Late" is `due_date + duty.grace_days` compared against a moment, and no
     * filter grammar can say it: `FILTER_OPERATORS` has no date arithmetic, the
     * `{N_days_ago}` macros are relative to now and never to a column, and here
     * the offset is itself a column on a JOINED object (objectstack#14104). The
     * offset is knowable at dispatch, so it is applied at dispatch and what
     * lands on the row is a plain date. Every surface that asks about lateness
     * — the `late` view, the on-time measures — is then an ordinary date filter
     * with nothing to compute at read time.
     *
     * ── Write-once, and what that costs ──────────────────────────────────
     * The stamp carries the grace the duty granted AT DISPATCH. Change a duty's
     * `grace_days` afterwards and already-dispatched tasks keep the deadline
     * they were born with — deliberately, for the same reason `subject` is
     * copied rather than joined: a task is a record of what was owed, and a
     * compliance record that rewrites itself when configuration changes is
     * worth nothing in front of an auditor.
     *
     * The cost is real and belongs to somebody: an admin who has just corrected
     * a misconfigured grace will expect it to apply to open work. The path for
     * that is `duly_catalog_sync`, which already exists to replay duty edits
     * onto instantiated records; it deliberately does not do this yet.
     *
     * Blank only when the task has no `due_date` at all — nothing to be late
     * against, so it never appears in a lateness surface. Every task that HAS a
     * due date gets one: the planner stamps it with the duty's grace, and
     * `task.hook.ts` stamps `late_after = due_date` (zero grace) for the paths
     * that have no duty to read — the assignment fan-out and a hand-created
     * task. That is the same reading of "no duty governs this row" the overdue
     * escalation already uses (`src/flows/reminders.flow.ts`).
     */
    late_after: Field.date({
      label: 'Late after',
      group: 'history',
      readonly: true,
      description: 'The due date plus the grace the duty granted when this task was dispatched. Open past this day, or completed after it, is late. Stamped once, at dispatch — editing the duty\'s grace afterwards does not move it.',
    }),

    status: Field.select({
      label: 'Status',
      group: 'basics',
      required: true,
      // [ADR-0052 §5b] Status changes land on the record timeline with no hook
      // code. This is the entire audit story for "who closed this and when".
      trackHistory: true,
      options: [
        { label: 'Open', value: 'open', color: '#576B73', default: true },
        { label: 'In progress', value: 'in_progress', color: '#2E7C8E' },
        { label: 'Done', value: 'done', color: '#35674D' },
        { label: 'Skipped', value: 'skipped', color: '#8C6512' },
        { label: 'Cancelled', value: 'cancelled', color: '#8598A0' },
      ],
    }),

    skip_reason: Field.text({
      label: 'Why skipped',
      group: 'basics',
      maxLength: 255,
      description: 'A skipped task is a legitimate outcome — "the plant was down, there was nothing to return". Recording why is what keeps skip from being a synonym for done.',
    }),

    // Server-owned. Stamped by `task.hook.ts` on the transition into `done`
    // and cleared on the transition back out — the one write the readonly
    // strip lets through.
    completed_at: Field.datetime({
      label: 'Completed at',
      group: 'history',
      readonly: true,
    }),

    /**
     * The verdict: was this completion late? `completed_at` past `late_after`.
     *
     * Written ONCE, by `task.hook.ts`, in the same beat as `completed_at` —
     * which is the first moment both halves of the comparison exist. It is a
     * historical fact from then on, exactly like the timestamp beside it, and
     * nothing recomputes it. That is what makes the on-time rate a count over a
     * boolean instead of the column-to-column comparison the query grammar
     * cannot express.
     *
     * Cleared with `completed_at` when a task is reopened: a completion that no
     * longer happened has no verdict.
     *
     * `false` when the task carries no `late_after` — a task with no due date
     * has no deadline to miss, so "not late" is the answer, not a missing one.
     * Keeping it a definite answer is what makes `done = on time + late` an
     * identity a dashboard reader can rely on.
     */
    completed_late: Field.boolean({
      label: 'Completed late',
      group: 'history',
      readonly: true,
      description: 'True when the task was completed after its late-after date. Stamped once, at completion, against the grace in force then — a later change to the duty\'s grace never moves it.',
    }),

    /**
     * The stagnation signal, and the most useful number in the product.
     *
     * Completion percentage tells you about work that already finished.
     * `last_update_at` tells you about work that is quietly going nowhere —
     * weeks before a due date makes it obvious. Server-owned: stamped on every
     * status change, progress phrase or note edit by `task.hook.ts`.
     */
    last_update_at: Field.datetime({
      label: 'Last touched',
      group: 'history',
      readonly: true,
    }),

    /**
     * The one-tap progress phrase (#108 · deck p7 ③).
     *
     * Four phrases, chosen because they are what people already write in the
     * note: the work is finished on time, it has been passed down to the
     * departments, it is waiting on somebody else, or it is simply in hand.
     * `note` stays beside it as "write your own" — this replaces nothing, it
     * removes the typing from the four cases that repeat.
     *
     * ── No default, deliberately ────────────────────────────────────────
     * A dispatched task starts with NO progress reported, and blank is the
     * honest reading of that. A default would put a phrase nobody said onto
     * every row the dispatcher creates, and the list column would then show
     * the same words against 186 tasks — which is worse than an empty column,
     * because it looks like news. `source` carries a default for the opposite
     * reason: every task genuinely has a caliber the moment it exists.
     *
     * ── It moves the stagnation clock, and that is the point ────────────
     * `task.hook.ts` stamps `last_update_at` when this changes. Picking a
     * phrase IS somebody working the task, which is exactly the test that
     * hook's list applies — unlike a re-owner or a re-date, which are
     * administrative and deliberately absent from it.
     *
     * ⛔ Not a metric. See the module header: the on-time verdict is
     * `completed_late`, never this.
     */
    progress: Field.select({
      label: 'Latest progress',
      group: 'progress',
      description: 'A phrase the owner picked, in their own words — never evidence, never scored, and never required. The on-time verdict is `completed_late`, which the server stamps at completion.',
      options: [
        { label: 'Finished on time', value: 'on_time', color: '#35674D' },
        { label: 'Passed down to the departments', value: 'distributed', color: '#2E7C8E' },
        { label: 'Waiting on a reply', value: 'awaiting_feedback', color: '#8C6512' },
        { label: 'In hand', value: 'in_hand', color: '#576B73' },
      ],
    }),

    note: Field.textarea({
      label: 'Note',
      group: 'progress',
      description: 'Optional. Never required to complete a task — an evidence gate turns a 5-second tick into a 5-minute chore, and the list stops being used. The four phrases people write most often are one tap away in `progress`.',
    }),

    /**
     * Files the owner chose to attach — and NEVER a completion requirement.
     *
     * ── The invariant, stated where somebody would break it ─────────────
     * "Completion never requires evidence, a note, or a percentage"
     * (AGENTS.md). So: not `required`, no `requiredWhen`, and no validation
     * rule anywhere names this column. A task goes to `done` with zero files
     * and always will — pinned in `test/invariants.test.ts` (the metadata) and
     * in `test/task-hook.test.ts` (a booted engine actually doing it). The
     * moment an evidence gate exists, the 5-second tick becomes a 5-minute
     * chore and the list stops being used; that is the whole product.
     *
     * ── Why the platform's own file field, with no configuration ────────
     * Measured on 17.2.0 rather than assumed: `file` is a first-class
     * `FieldType`, it is in `MULTI_CAPABLE_TYPES` so `multiple: true` makes it
     * an array, and `storage` is in `PLATFORM_ALWAYS_ON_CAPABILITIES` — the
     * CLI's serve command mounts `StorageServicePlugin` from
     * `@objectstack/service-storage` whether or not a stack asks for it, so
     * there is nothing to declare in `objectstack.config.ts` and nothing to
     * configure. Uploads were then driven in a browser against `pnpm demo`;
     * the PR body carries that half.
     *
     * ⛔ No `accept` list. Restricting the file types is a gate nobody asked
     * for, on a field whose entire contract is that it is optional — the
     * frontline photograph of a signed sheet is exactly the case a
     * well-meant `accept: ['.pdf']` would refuse.
     */
    attachments: Field.file({
      label: 'Attachments',
      group: 'progress',
      multiple: true,
      description: 'Optional, always. Attach a photo, a signed sheet, a return — or nothing. Completing a task never requires one, and nothing checks for one.',
    }),
  },

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // The record's own attachment area. Opt-in per record, never a completion
    // requirement — and NOT the same thing as the `attachments` COLUMN above,
    // which is what a list column and a form group can address. Both are
    // wanted; see the module header.
    files: true,
  },

  indexes: [
    // Idempotent dispatch: one task per duty, per owner, per period. Scoped to
    // the organization (ADR-0120) — two tenants may legitimately hold the same
    // triple.
    { name: 'duly_task_dispatch_identity', fields: ['duty', 'owner', 'period_key'], unique: 'organization' },
    { fields: ['owner', 'status'] },
    { fields: ['business_unit', 'due_date'] },
    { fields: ['due_date'] },
    // The `late` lens filters on this column and sorts by it, the same shape
    // `due_date` above is indexed for.
    { fields: ['late_after'] },
    { fields: ['last_update_at'] },
    { fields: ['assignment'] },
  ],

  nameField: 'subject',
  highlightFields: ['subject', 'status', 'due_date', 'owner', 'period_key'],

  validations: [
    {
      // The stamp is the server's job; this rule is the assertion that the
      // stamp actually happened. If the hook is ever unregistered, the write
      // is refused loudly instead of committing a done task with no timestamp.
      name: 'completed_at_required_when_done',
      type: 'script',
      severity: 'error',
      message: 'A completed task must carry a completion timestamp.',
      condition: P`record.status == "done" && isBlank(record.completed_at)`,
    },
    {
      name: 'skip_needs_reason',
      type: 'script',
      severity: 'error',
      message: 'Say why the task was skipped.',
      condition: P`record.status == "skipped" && isBlank(record.skip_reason)`,
    },
  ],
});
