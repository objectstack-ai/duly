// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

import { governed } from './governed.js';

/**
 * `duly_workload` — the forward look: which period is about to overload.
 *
 * The only dataset here that is about work not yet done. Its job is to make a
 * pile-up visible while it can still be moved — a quarter-end where four
 * annual duties, a semi-annual and the usual monthlies all land in the same
 * week is a problem you can only solve in advance.
 *
 * ── Shape a dashboard author must know ────────────────────────────────────
 * `due_week` and `due_month` are the SAME column at two granularities, not two
 * columns. Group by one or the other, never both at once — crossing them
 * produces one populated cell per week and empties everywhere else. Weeks are
 * ISO (Monday start) wherever the driver does not truncate server-side.
 *
 * There is no status dimension and no per-person volume measure. "Who has the
 * most tasks" is not a question this dataset answers, and that is deliberate:
 * `owner` is here so a manager can see whether ONE person's next fortnight is
 * unsurvivable, which is a workload question, not a ranking. A measure built
 * to compare item counts BETWEEN people is the specific mechanism by which the
 * caliber separation gets undone one reasonable-looking ticket at a time, so
 * this dataset carries exactly one measure and it is the same one
 * `duly_duty_health` carries.
 *
 * `tasks_due` is identical to `duly_duty_health.tasks_due` — governed sources,
 * cancelled excluded. One name, one meaning, across the semantic layer; a
 * cancelled task was withdrawn, so it is not future load.
 */
export const Workload = defineDataset({
  name: 'duly_workload',
  label: 'Workload',
  description:
    'Governed tasks due, bucketed forward by week and by month, so a period that is about to overload is visible while it can still be rebalanced.',

  object: 'duly_task',

  dimensions: [
    { name: 'business_unit', label: 'Business unit', field: 'business_unit', type: 'lookup' },
    { name: 'owner', label: 'Owner', field: 'owner', type: 'lookup' },
    { name: 'due_week', label: 'Due (week)', field: 'due_date', type: 'date', dateGranularity: 'week' },
    { name: 'due_month', label: 'Due (month)', field: 'due_date', type: 'date', dateGranularity: 'month' },
  ],

  measures: [
    {
      name: 'tasks_due',
      label: 'Tasks due',
      aggregate: 'count',
      filter: governed({ status: { $ne: 'cancelled' } }),
    },
  ],
});
