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
 * ── How the on-time measures became expressible ──────────────────────────
 *
 * The card's three measures — `done on time`, `late`, and the `on-time rate`
 * over them — all reduce to ONE comparison:
 *
 *     completed_at <= due_date + duty.grace_days
 *
 * A dataset measure filter cannot say that, and still cannot: `FILTER_OPERATORS`
 * has no date arithmetic and its `{N_days_ago}` macros are relative to NOW
 * rather than to a column, so "+ grace_days" has no spelling; and a
 * column-to-column reference (`{ completed_at: { $lte: { $field: 'due_date' } } }`)
 * is resolved by the in-memory evaluator and REFUSED by driver-sql with
 * `INVALID_FILTER` / 400 (objectstack#5222), which for a dataset is worse than
 * a uniform gap — the same measure would answer on one deployment and 400 on
 * another. Both halves are objectstack#14104.
 *
 * What changed in #52 is not the grammar: it is WHEN the comparison is made.
 * Both operands are knowable at a definite instant, so each is resolved there
 * and stored on `duly_task` —
 *
 *     late_after     = due_date + grace_days     stamped at DISPATCH
 *     completed_late = completed_at > late_after  stamped at COMPLETION
 *
 * — and what is left at query time is a count over a boolean, which this
 * grammar has always been able to express. **objectstack#14104 stops being a
 * blocker rather than being resolved**: with `late_after` on the row there is
 * no column-to-column comparison left to make. If it ever lands, nothing here
 * needs to change — and the stamps would still be right, because they answer
 * "was this late" with the grace that was in force at the time, which a
 * query-time comparison against today's `duty.grace_days` cannot do.
 *
 * That is also why this is not the denormalisation `AGENTS.md` rule 5 forbids.
 * Rule 5 is about a MAINTAINED flag — one that needs a writer every midnight
 * and lies on the day it does not run. These are written once, at the moment
 * they become true, and never recomputed; the boundary is stated under rule 5
 * itself. The consequence is deliberate: editing a duty's `grace_days` does not
 * move the verdict on work already completed. `duly_catalog_sync` is where a
 * replay onto open tasks would belong, and it does not do that today.
 *
 * The rejected alternative has not changed either: reducing the rate in
 * TypeScript over query results is the hand-written aggregation the
 * metadata-first rule exists to prevent, and it would put the number outside
 * the semantic layer where no dashboard could bind it.
 *
 * ⛔ What must still never be built here is the GRACE-FREE approximation —
 * a `due_date < {today}` window standing in for lateness. It marks late every
 * task completed inside the grace its own duty grants, which is wrong in
 * exactly the direction a customer configures grace against, and wrong
 * invisibly. `test/dashboard.test.ts` and `test/datasets.test.ts` both pin it.
 *
 * ── The same stamps answer a SECOND question: what is late right now ─────
 * `tasks_done_on_time` / `tasks_completed_late` read `completed_late`, the
 * verdict stamped at completion. `tasks_overdue` reads the other stamp,
 * `late_after`, because there is no verdict on a task that has not finished —
 * open work past its own dispatched deadline. One family of numbers, two
 * stamps, and neither is a query-time comparison against today's
 * `duty.grace_days`.
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
    {
      /**
       * Completed inside the grace its duty granted. `completed_late` is the
       * verdict the completion hook stamped against the `late_after` the task
       * was dispatched with — so this counts what was on time AT THE TIME,
       * which is the only reading an audit accepts.
       *
       * `status: 'done'` is carried as well as the flag, rather than trusted
       * to imply it: the verdict is cleared when a task is reopened, but a
       * measure that leaned on that would silently start counting skipped and
       * cancelled rows the day the clearing leg changed.
       */
      name: 'tasks_done_on_time',
      label: 'Done on time',
      aggregate: 'count',
      filter: governed({ status: 'done', completed_late: false }),
    },
    {
      // The other half of the same population — never a separate question, and
      // never a person's score. `tasks_done_on_time + tasks_completed_late`
      // is `tasks_done` exactly, because every done row carries a definite
      // verdict (a task with no due date has no deadline to miss and is
      // stamped `false`).
      name: 'tasks_completed_late',
      label: 'Completed late',
      aggregate: 'count',
      filter: governed({ status: 'done', completed_late: true }),
    },
    {
      /**
       * STILL OPEN and already past its own deadline — the p20 deck's
       * 「逾期项」 tile, and the only lateness measure here that is not about
       * completed work.
       *
       * Its neighbours above all count rows that have FINISHED and read the
       * verdict `completed_late` stamped at completion. Nothing stamps a
       * verdict on a task that has not finished, so this one reads the other
       * write-once stamp instead: `late_after` (`due_date + duty.grace_days`,
       * stamped at dispatch) against today. That is a plain date column
       * compared to a date macro, which this filter grammar has always been
       * able to express — the reason it could not be written before #52 is
       * that the deadline itself did not exist on the row, not that the
       * comparison was hard.
       *
       * ⛔ The two-line version of this measure is `due_date: { $lt:
       * '{today}' }`, and it is the grace-free approximation the file header
       * refuses: it marks late every task still inside the grace its own duty
       * grants — wrong in exactly the direction a customer configures grace
       * AGAINST, and wrong invisibly. `test/dashboard.test.ts` pins the
       * measure side of that as well as the widget side.
       *
       * A task carrying no `late_after` is never counted, and that is correct
       * rather than a gap: no deadline was ever stamped, so there is nothing
       * to be past. It is the same direction as `completed_late: false` for a
       * task with no due date — an absent deadline is not a missed one.
       *
       * `cancelled` and `skipped` are excluded by asking for the two OPEN
       * statuses directly, which is also what makes this the population a
       * manager can still act on: the tile answers "what is late and still
       * mine to fix", not "what was late once".
       */
      name: 'tasks_overdue',
      label: 'Overdue',
      aggregate: 'count',
      filter: governed({
        status: { $in: ['open', 'in_progress'] },
        late_after: { $lt: '{today}' },
      }),
    },
    {
      /**
       * The product's headline number, at last expressible.
       *
       * A DERIVED measure (ADR-0021 Q1) — it names other measures and nothing
       * else, so the caliber gate it inherits is theirs and cannot drift from
       * them. Deliberately over `tasks_done` rather than `tasks_due`: this
       * answers "of the work that was completed, how much was on time", and
       * folding still-open or skipped work into the denominator would answer a
       * different question under the same name.
       */
      name: 'on_time_rate',
      label: 'On-time rate',
      derived: { op: 'ratio', of: ['tasks_done_on_time', 'tasks_done'] },
      /**
       * A fraction rendered to two decimals, and NOT a percent — measured
       * against the console, not chosen by taste.
       *
       * `format` here is a numeral PATTERN, not a keyword: the renderer takes
       * the decimals from the digits after the point (`format.split('.')[1]`)
       * and switches to percent only on a literal `%`. Measured against this
       * demo's own 0.94, in the browser:
       *
       *   (none)    `0.94`
       *   'percent' `1` — no `%` in the pattern, so this is not a percent at
       *             all, just zero decimals. Silently wrong on the one tile
       *             the product is judged by, which is why the obvious
       *             spelling is written down here as refuted.
       *   '0.00'    `0.94`. What ships.
       *
       * `'0.0%'` is the spelling that would print `94.0%`, and it is
       * deliberately NOT used. Read off the renderer rather than measured,
       * because the demo cannot currently produce the value it goes wrong on:
       * a percent is scaled by a HEURISTIC — `value > -1 && value < 1 ? value
       * * 100 : value` — because a measure, unlike a field, cannot declare its
       * scale. A rate of exactly 1 (100% on time, the number a customer most
       * wants to see) falls outside that window and renders as `1.0%`. A tile
       * that reports a perfect month as one percent is worse than one that
       * says `1.00`. Filed as #101.
       */
      format: '0.00',
    },
  ],
});
