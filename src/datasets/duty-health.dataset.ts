// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

import { governed } from './governed.js';

/**
 * `duly_duty_health` — the on-time picture, over GOVERNED work only.
 *
 * Dashboards bind datasets, never objects (ADR-0021): a widget that names a
 * dimension or measure this file does not declare renders an empty chart and
 * reports success, so the names below are a contract. `#10` binds them.
 *
 * ── What is NOT here, and why it is upstream rather than worked around ────
 *
 * The card asks for three more measures — `done on time`, `late`, and the
 * `on-time rate` derived from them. All three reduce to ONE comparison:
 *
 *     completed_at <= due_date + duty.grace_days
 *
 * That comparison cannot be expressed by a dataset measure filter, and the
 * reason is worth stating precisely, because one third of it DOES work and
 * the other two thirds are separate platform gaps:
 *
 * 1. **Reaching the related field works.** `include: ['duty']` plus a
 *    `duty.grace_days` path is exactly what the semantic layer is for — joins
 *    are compiled from `include` (ADR-0071, ≤3 hops) and the author writes no
 *    ON clause. `frequency` below is that same reach, in production, so this
 *    half is proven rather than assumed.
 *
 * 2. **Comparing two COLUMNS is refused on the SQL path.** The filter grammar
 *    declares a field reference — `{ completed_at: { $lte: { $field:
 *    'due_date' } } }` — and `@objectstack/spec`'s own `filter.zod.ts` records
 *    that `driver-sql` (and `driver-sqlite-wasm`, which inherits its compiler)
 *    reject it with `INVALID_FILTER` / HTTP 400, while the in-memory evaluator
 *    resolves it. Tracked upstream as objectstack#5222. That split is worse
 *    than a uniform gap for a DATASET in particular: the same declaration
 *    would answer on a memory driver and 400 on a SQL one, so the measure's
 *    correctness would depend on the deployment.
 *
 * 3. **There is no date arithmetic in the grammar at all.** `FILTER_OPERATORS`
 *    is closed — equality, ordering, set, range, string, null/exists — and
 *    nothing adds an interval to a column. The `{N_days_ago}` macro
 *    vocabulary (`DATE_MACRO_PARAM_RE`) is relative to NOW, never to another
 *    column, so it cannot express "+ grace_days" either. And here the interval
 *    is itself a column, which is strictly harder than a literal offset. So
 *    even if #5222 landed tomorrow, `due_date + duty.grace_days` would still
 *    have no spelling.
 *
 * The two workarounds were both considered and both rejected on the card's own
 * terms. Denormalising `grace_days` (or a pre-computed `grace_deadline`) onto
 * `duly_task` is a second writer that drifts the day a duty's grace is edited —
 * `AGENTS.md` rule 5 forbids it outright. Reducing the rate in TypeScript over
 * query results is the hand-written aggregation the metadata-first instruction
 * on this card exists to prevent, and it would also put the number outside the
 * semantic layer where no dashboard could bind it.
 *
 * So the measures are absent rather than approximated. An `on_time_rate` that
 * silently ignored grace would be wrong in the direction that matters — it
 * would mark late every task completed inside the grace its own duty grants —
 * and it would be wrong invisibly, which is how a number nobody trusts becomes
 * the number everybody reports. Note what the gap currently costs: `grace_days`
 * is authored on `duly_catalog_item`, propagated to `duly_duty` at
 * instantiation, and read by NOTHING. This dataset was its only intended
 * consumer.
 *
 * Filed upstream — see the PR body for the issue reference. Do not close this
 * hole locally.
 *
 * ── `tasks_due` excludes cancelled, in every dataset that uses the name ───
 * A cancelled task was withdrawn: it was never owed, so it is neither load nor
 * the denominator of anything. Keeping it out is also what makes the counts
 * add up — due = done + skipped + still-open — which a dashboard author will
 * assume whether or not anyone tells them. `duly_workload.tasks_due` carries
 * the identical definition on purpose: one name, one meaning, across the
 * semantic layer.
 */
export const DutyHealth = defineDataset({
  name: 'duly_duty_health',
  label: 'Duty health',
  description:
    'On-time picture over governed duties (role catalog and manager-assigned). Self-declared work is surfaced in the task views and never scored here.',

  object: 'duly_task',

  // `duty` is joined for `frequency` only — the task itself carries owner,
  // business unit, period and caliber, denormalised at dispatch so a rollup
  // survives a later transfer or a re-sourced duty.
  include: ['duty'],

  dimensions: [
    { name: 'business_unit', label: 'Business unit', field: 'business_unit', type: 'lookup' },
    { name: 'owner', label: 'Owner', field: 'owner', type: 'lookup' },
    { name: 'period_key', label: 'Period', field: 'period_key', type: 'string' },
    { name: 'frequency', label: 'Frequency', field: 'duty.frequency', type: 'string' },
    // Available so the governed population can be split by where the work came
    // from. Slicing by this NEVER reveals self-declared work — every measure
    // is filtered to catalog+assigned, so the `self` bucket is empty by
    // construction. That is the design, not an oversight: see `governed.ts`.
    { name: 'source', label: 'Source', field: 'source', type: 'string' },
  ],

  measures: [
    {
      name: 'tasks_due',
      label: 'Tasks due',
      aggregate: 'count',
      filter: governed({ status: { $ne: 'cancelled' } }),
    },
    {
      name: 'tasks_done',
      label: 'Tasks done',
      aggregate: 'count',
      filter: governed({ status: 'done' }),
    },
    {
      // Kept separate from `tasks_done` because it is a legitimate outcome with
      // a different meaning — "the plant was down, there was nothing to
      // return". Folding skips into done inflates the picture; folding them
      // into late punishes an honest answer.
      name: 'tasks_skipped',
      label: 'Tasks skipped',
      aggregate: 'count',
      filter: governed({ status: 'skipped' }),
    },
  ],
});
