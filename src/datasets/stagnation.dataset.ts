// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

import { governed } from './governed.js';

/**
 * `duly_stagnation` — the early-warning picture, and the reason this product
 * does not carry a completion percentage.
 *
 * ── Stagnation is NOT lateness ────────────────────────────────────────────
 * Nothing below mentions `due_date`. That is the entire point and it is the
 * one thing a reviewer should check first: a task that is untouched for three
 * weeks and not due for another two is ALREADY the signal, and a lateness
 * measure cannot see it until it is too late to act. Lateness tells a manager
 * about work that has already failed; stagnation tells them about work that is
 * quietly going nowhere, weeks earlier, while intervening is still cheap.
 *
 * A percentage would answer neither. It is a number nobody can verify, which
 * is exactly why it becomes the number everyone reports — and 80% on an
 * untouched task is 80% forever. `last_update_at` cannot be talked up: it is
 * server-owned, stamped by `src/hooks/task.hook.ts` only when `status`, `note`
 * or `skip_reason` actually CHANGED, never on an administrative or bulk write.
 * Re-owning, re-dating or importing a task does not reset the clock.
 *
 * ── Why the buckets are expressible, when the on-time rate is not ─────────
 * These thresholds are relative to NOW, not to another column, so they are
 * exactly what the date-macro vocabulary is for. `{7_days_ago}` and friends
 * are resolved server-side by `resolveFilterTokens`, which
 * `@objectstack/spec`'s `date-macros.zod.ts` names as wired into "the
 * analytics dataset executor" specifically — dataset definitions being one of
 * the filter sources that never pass through a renderer. Unknown tokens fail
 * the build rather than comparing as a literal string and matching nothing,
 * which is why the spellings below are safe to trust; `test/datasets.test.ts`
 * pins them against the spec's own token grammar.
 *
 * Contrast `duly_duty_health`, where the comparison is column-to-column plus
 * arithmetic and there is no such vocabulary. The difference between the two
 * cases is the whole answer to "can a dataset say this".
 *
 * ── Shape a dashboard author must know: the buckets are CUMULATIVE ────────
 * `untouched_over_14d` counts everything `untouched_over_30d` counts. They are
 * nested thresholds, not disjoint bands, so they must not be summed and they
 * must not go in a pie chart. Stack them as thresholds, or difference them in
 * the widget if disjoint bands are wanted. Named the way the card names them
 * (">7d", ">14d", ">30d") precisely so the nesting is legible from the name.
 *
 * `last_update_at` is never null on a task that reached the database — the
 * lifecycle hook stamps it on `beforeInsert` ("a brand-new task has just been
 * touched, by definition"), so a freshly dispatched task cannot slip out of
 * these counts through a NULL comparison.
 */
export const Stagnation = defineDataset({
  name: 'duly_stagnation',
  label: 'Stagnation',
  description:
    'Open governed work that is not moving, bucketed by how long it has gone untouched. Deliberately independent of due date — an untouched task that is not yet due still stagnates.',

  object: 'duly_task',

  dimensions: [
    { name: 'business_unit', label: 'Business unit', field: 'business_unit', type: 'lookup' },
    { name: 'owner', label: 'Owner', field: 'owner', type: 'lookup' },
  ],

  measures: [
    {
      name: 'open_tasks',
      label: 'Open tasks',
      aggregate: 'count',
      filter: governed({ status: { $in: ['open', 'in_progress'] } }),
    },
    {
      name: 'untouched_over_7d',
      label: 'Untouched > 7 days',
      aggregate: 'count',
      filter: governed({
        status: { $in: ['open', 'in_progress'] },
        last_update_at: { $lt: '{7_days_ago}' },
      }),
    },
    {
      name: 'untouched_over_14d',
      label: 'Untouched > 14 days',
      aggregate: 'count',
      filter: governed({
        status: { $in: ['open', 'in_progress'] },
        last_update_at: { $lt: '{14_days_ago}' },
      }),
    },
    {
      name: 'untouched_over_30d',
      label: 'Untouched > 30 days',
      aggregate: 'count',
      filter: governed({
        status: { $in: ['open', 'in_progress'] },
        last_update_at: { $lt: '{30_days_ago}' },
      }),
    },
    {
      // The single oldest untouched moment in the group. A KPI tile bound to
      // this answers "what is the worst thing here" without ranking anybody
      // against anybody — it is a timestamp, not a score, and it names a date
      // rather than a person.
      name: 'oldest_last_update_at',
      label: 'Oldest touch',
      aggregate: 'min',
      field: 'last_update_at',
      filter: governed({ status: { $in: ['open', 'in_progress'] } }),
    },
  ],
});
