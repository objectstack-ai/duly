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
 * `is_late` / `is_open` / `is_overdue`: derivable from `due_date`, `grace_days`
 * and `status`, which are stored and indexed. A stored copy is a second writer
 * that drifts, and a formula field is virtual — a filter naming one silently
 * matches nothing. Consumers ask `status` and `due_date` directly.
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
        { label: 'Role catalog', value: 'catalog', color: '#16515F', default: true },
        { label: 'Assigned by manager', value: 'assigned', color: '#8C6512' },
        { label: 'Self-declared', value: 'self', color: '#576B73' },
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
