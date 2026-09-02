// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineDataset } from '@objectstack/spec/ui';

import { governed } from './governed.js';

/**
 * `duly_duty_register` — the DUTY LIST itself: is it confirmed, and what is on it.
 *
 * The only dataset here whose base object is `duly_duty`. Every other one
 * counts TASKS — what a duty produced. This one counts the duties, which is
 * the whole reason it exists as a fourth dataset rather than three more
 * measures on `duly_duty_health`: a task-based dataset structurally cannot see
 * a `standing` duty (it never generates a task) or an unapproved one (it never
 * dispatches), and those two absences are precisely what the manager screen is
 * being asked about.
 *
 * ── `source` here is the DUTY's own column, and that is not a slip ────────
 * `governed.ts` says to read `duly_task.source` rather than `duty.source`, and
 * that instruction is about a TASK-based measure: a task carries its own copy,
 * stamped at dispatch, so it keeps the caliber it was dispatched under even if
 * the duty is later re-sourced. On this dataset the base object IS the duty,
 * so `source` is not a join and there is no denormalised copy to prefer — the
 * duty's own column is the only thing the question can mean. Same helper, same
 * two values, same product rule: self-declared work is surfaced in the views
 * and never scored here.
 *
 * ── Why `status != retired` and not `status == active` ───────────────────
 * The register is what the organisation currently owes, and a PAUSED duty is
 * still owed — it is temporarily not dispatching, which is a scheduling state,
 * not a withdrawal. A RETIRED duty was withdrawn, so it is no longer part of
 * anything a completeness rate should be measured against. That is the same
 * boundary `tasks_due` draws with `status != cancelled`, one object up, and it
 * is drawn the same way on purpose: one rule for "withdrawn, therefore never
 * owed", across the semantic layer.
 *
 * Excluding retired duties matters in the direction nobody checks: a rate over
 * EVERY duty ever declared falls every time a duty is retired, so the screen
 * would report the register getting worse as it is being tidied up.
 *
 * ── The completeness rate is over `review_status`, never over item counts ──
 * `approved_rate` is `duties_approved / duties_in_register`. It answers "how
 * much of the duty list has been through confirmation and approval", which is
 * a governance fact each row states about itself.
 *
 * The thing it must never become is a count of ITEMS per person or per unit —
 * "whose list is shortest" — which `AGENTS.md` bans outright ("Item counts are
 * never ranked or compared, anywhere in the UI"). The two are easy to confuse
 * because both are "completeness of the list", so the distinction is worth
 * stating in one line: this measures whether the rows were AGREED, not how
 * many rows there are. A short approved list is complete; a long unapproved
 * one is not. There is deliberately no `owner` dimension here, so the ranking
 * shape has nowhere to be authored even by accident.
 *
 * `review_status` is `duly_duty`'s own confirmation column (`to_confirm` ->
 * `to_review` -> `approved`, with `returned` as the send-back), added by the
 * duty-review card. `approved` is the only value that dispatches, which is
 * what makes it the numerator: an unapproved duty produces no tasks, so it is
 * absent from every other number on this screen without being absent from the
 * obligation.
 *
 * ── What is NOT declared here, and why ───────────────────────────────────
 * - **No `owner` dimension.** See above; also the barrel-wide rule that no
 *   widget slices by a person (`test/dashboard.test.ts`).
 * - **No `business_unit` dimension.** No widget asks for one yet. A dataset is
 *   a published contract (ADR-0021), so a dimension nobody binds is surface
 *   that has to be kept working forever to serve nothing. Add it with the
 *   widget that needs it.
 * - **No `duties_to_confirm` / `duties_to_review` counts.** The card asks for
 *   them as a SUB-CAPTION under the completeness tile, and a dataset-bound KPI
 *   widget cannot render one today: it renders `values[0]` and drops the rest,
 *   and the authored sub-caption slot (`options.description`) is read only on
 *   the inline metric path, which no spec-valid widget can reach any more
 *   because `dataset` is required. Measured on objectui's
 *   `plugin-dashboard/src/DatasetWidget.tsx` (the `isMetric` branch) and
 *   `DashboardRenderer.tsx` (`tWidgetSubCaption`, used only under
 *   `isObjectProvider`). Filed upstream rather than approximated; the tile
 *   ships with the rate, and the two counts arrive with the renderer. See the
 *   dashboard file header.
 */
export const DutyRegister = defineDataset({
  name: 'duly_duty_register',
  label: 'Duty register',
  description:
    'The governed duty list itself — how much of it has been confirmed and approved, and what forms of work it is made of. Counts duties, not the tasks they produce, so standing duties are visible here and nowhere else.',

  object: 'duly_duty',

  dimensions: [
    // The product's three forms, in the field's own vocabulary. A pie over this
    // is the one place `standing` work appears on the manager screen at all.
    { name: 'form', label: 'Form', field: 'form', type: 'string' },
  ],

  measures: [
    {
      // The denominator, and the register's own size. Retired duties are out
      // (withdrawn, never owed); paused ones are in (owed, not dispatching).
      name: 'duties_in_register',
      label: 'Duties on the register',
      aggregate: 'count',
      filter: governed({ status: { $ne: 'retired' } }),
    },
    {
      name: 'duties_approved',
      label: 'Approved duties',
      aggregate: 'count',
      filter: governed({ status: { $ne: 'retired' }, review_status: 'approved' }),
    },
    {
      /**
       * A DERIVED measure (ADR-0021 Q1) — it names other measures and nothing
       * else, so the caliber gate it inherits is theirs and cannot drift from
       * them, exactly like `duly_duty_health.on_time_rate`.
       *
       * `format: '0.00'` and NOT `'percent'`, for the reason #101 measured on
       * the on-time tile: `format` is a numeral PATTERN, the renderer takes the
       * decimals from the digits after the point and switches to percent only
       * on a literal `%`, so `'percent'` renders 0.94 as `1`. `'0.0%'` would
       * print `94.0%` and is refused for the other half of #101: a percent is
       * scaled by the heuristic `value > -1 && value < 1 ? value * 100 : value`,
       * so a fully approved register — exactly 1, the number a customer most
       * wants to see — renders as `1.0%`. Do not "fix" this here; #101 is where
       * it is fixed.
       */
      name: 'approved_rate',
      label: 'Approved rate',
      derived: { op: 'ratio', of: ['duties_approved', 'duties_in_register'] },
      format: '0.00',
    },
  ],
});
