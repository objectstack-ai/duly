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
 * everyone reports on. Progress lives in `status` and in `last_update_at`.
 */
export const Task = ObjectSchema.create({
  name: 'duly_task',
  label: 'Task',
  pluralLabel: 'Tasks',
  icon: 'check-square',
  description: 'One dispatched occurrence of a duty, owed by one person for one period.',

  sharingModel: 'private',

  fields: {
    subject: Field.text({
      label: 'Task',
      required: true,
      searchable: true,
      maxLength: 255,
      description: 'Copied from the duty at dispatch, so renaming a duty does not rewrite history.',
    }),

    duty: Field.lookup('duly_duty', {
      label: 'Duty',
      description: 'Empty for a bare one-off that was never modelled as a duty.',
    }),

    owner: Field.user({
      label: 'Owner',
      required: true,
      defaultValue: 'current_user',
    }),

    business_unit: Field.lookup('sys_business_unit', {
      label: 'Business unit',
      description: 'Denormalised from the owner at dispatch so rollups survive a later transfer.',
    }),

    assignment: Field.lookup('duly_assignment', {
      label: 'Assignment',
      description: 'Set when this task came out of a manager fan-out. One assignment, N independent tasks.',
    }),

    // Same caliber rule as the duty. Metrics read this column and only this
    // column; `self` never enters an on-time rate or a comparison.
    source: Field.select({
      label: 'Source',
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
      maxLength: 16,
      description: 'Empty for one-off tasks, which have no period.',
    }),

    due_date: Field.date({ label: 'Due' }),

    visible_from: Field.date({
      label: 'Shows up on',
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
      readonly: true,
      description: 'The due date plus the grace the duty granted when this task was dispatched. Open past this day, or completed after it, is late. Stamped once, at dispatch — editing the duty\'s grace afterwards does not move it.',
    }),

    status: Field.select({
      label: 'Status',
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
      maxLength: 255,
      description: 'A skipped task is a legitimate outcome — "the plant was down, there was nothing to return". Recording why is what keeps skip from being a synonym for done.',
    }),

    // Server-owned. Stamped by `task.hook.ts` on the transition into `done`
    // and cleared on the transition back out — the one write the readonly
    // strip lets through.
    completed_at: Field.datetime({
      label: 'Completed at',
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
      readonly: true,
      description: 'True when the task was completed after its late-after date. Stamped once, at completion, against the grace in force then — a later change to the duty\'s grace never moves it.',
    }),

    /**
     * The stagnation signal, and the most useful number in the product.
     *
     * Completion percentage tells you about work that already finished.
     * `last_update_at` tells you about work that is quietly going nowhere —
     * weeks before a due date makes it obvious. Server-owned: stamped on every
     * status change and note edit by `task.hook.ts`.
     */
    last_update_at: Field.datetime({
      label: 'Last touched',
      readonly: true,
    }),

    note: Field.textarea({
      label: 'Note',
      description: 'Optional. Never required to complete a task — an evidence gate turns a 5-second tick into a 5-minute chore, and the list stops being used.',
    }),
  },

  enable: {
    trackHistory: true,
    searchable: true,
    apiEnabled: true,
    // Attachments are opt-in per record, never a completion requirement.
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
