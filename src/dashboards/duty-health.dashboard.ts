// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { Dashboard } from '@objectstack/spec/ui';

/**
 * `duly_duty_health` — the manager's one screen, entered by nobody.
 *
 * Every widget binds a DATASET (ADR-0021), never an object: the numbers here
 * are the same numbers the semantic layer gives every other surface, and the
 * caliber gate (`source IN ('catalog','assigned')`) rides on the measures
 * rather than on this file. Nothing on this screen writes — managers read
 * here, and assigning is their only write in the product.
 *
 * ── What is NOT on this dashboard, and why that is deliberate ─────────────
 *
 * The card asked for five things in reading order. Two of them — *"Late"* and
 * *"On-time rate, current period"* — are the SAME missing comparison, not two
 * separate omissions:
 *
 *     completed_at <= due_date + duty.grace_days      (on-time)
 *     now          >  due_date + duty.grace_days      (late)
 *
 * Both need `due_date + duty.grace_days`, and the filter grammar cannot say
 * it: there is no date arithmetic in `FILTER_OPERATORS`, the `{N_days_ago}`
 * macro vocabulary is relative to NOW and never to another column, and the
 * offset here is itself a column. Column-to-column comparison (`$field`) is
 * refused by `driver-sql` while the in-memory evaluator resolves it, so even
 * the half that parses would be a per-deployment answer. Filed upstream as
 * **objectstack-ai/objectstack#14104**; `src/datasets/duty-health.dataset.ts`
 * carries the full measurement, and it is why no dataset in this app declares
 * an on-time or a late measure for a widget to bind.
 *
 * A grace-free approximation IS expressible here — a widget `filter` of
 * `due_date < {today}` over `tasks_due` needs no platform change at all — and
 * it is deliberately not built. It marks late every task still inside the
 * grace window its own duty grants, so a customer who configured 7 days of
 * grace gets its people listed as late the morning after the due date. That
 * is not a rounding error; it is wrong in exactly the direction the customer
 * configured against, and it would be wrong invisibly. The product decision is
 * open on **#52** (with **#48** on the `late` LIST view, which does carry the
 * grace-free definition today); when it lands, the tile lands with it.
 *
 * The reordering is an improvement rather than a loss: the card already wanted
 * the not-moving tile to be the visual focus, and with lateness deferred it is
 * unambiguously the headline. Stagnation is also the EARLIER signal — a task
 * untouched for three weeks and not due for another two is already a problem,
 * and no lateness measure can see it until it is too late to act.
 *
 * The absence is stated on the screen itself, in `description` below, for the
 * same reason the caliber note is: a manager reading "not moving: 3" on a
 * dashboard that says nothing about lateness will conclude there are three
 * problems. An unexplained absence is a wrong number with no digits.
 *
 * ── Shapes this file is authored around ──────────────────────────────────
 *
 * - **Stagnation buckets are CUMULATIVE.** `untouched_over_14d` counts
 *   everything `untouched_over_30d` counts. They are nested thresholds, not
 *   bands: they are never summed, never stacked in one bar, and never put in
 *   a pie. Here they are two separate KPI tiles, which is the one arrangement
 *   that cannot be misread as a partition — and the by-unit chart carries a
 *   SINGLE series for the same reason.
 * - **`oldest_last_update_at` is a timestamp, not a score.** It answers "what
 *   is the worst thing here" with a DATE and names no person. It is a metric
 *   tile, never a bar length.
 * - **`due_week` / `due_month` are one column at two granularities** — group
 *   by one, never both.
 * - **`tasks_due` means the same thing in both datasets that declare it**, so
 *   the forward look is scoped by a date window only. Narrowing it by status
 *   would put a different number behind the same name.
 * - **The governed filter is already on every measure.** This file neither
 *   adds it nor removes it.
 *
 * ── No ranking of people ─────────────────────────────────────────────────
 * `owner` is a dimension on `duly_stagnation` and on `duly_workload`, and no
 * widget below selects it. Unit comparison is a workload question and is
 * fine; person comparison is a performance score, and this product does not
 * have one. `test/dashboard.test.ts` pins that as a property of the barrel
 * rather than of these five widgets, so a sixth widget cannot quietly add it.
 *
 * ── Colour, in both themes ───────────────────────────────────────────────
 * Late and not-moving are ATTENTION, not blame: the tiles use `warning` /
 * `orange` and never `danger`, and the charts use one amber and one teal from
 * the app's own palette.
 *
 * Text is never drawn on a fill anywhere on this screen. `showDataLabels` is
 * explicitly `false` on both charts (it is also the default — stated because
 * it is the contrast-critical key, not decoration), so every label renders as
 * axis or legend text on the card background, which the theme owns and keeps
 * legible in both modes. That leaves the fills themselves, which must clear
 * 3:1 as graphical objects (WCAG 1.4.11) against BOTH a white and a near-black
 * card. Metadata cannot carry a per-theme colour, so both hexes are mid-tones
 * inside the band where that is true — relative luminance L in [0.118, 0.30]:
 * `#B07C17` (L≈0.237 → 3.7:1 on white, 5.3:1 on #0B0F14) and `#2E7C8E`
 * (L≈0.169 → 4.8:1 on white, 4.0:1 on #0B0F14). The app's darker palette
 * entries were measured and rejected for chart FILLS on exactly this test:
 * `#16515F` and `#5A3F0C` pass on white (8.8:1, 9.8:1) and land at 2.2:1 and
 * 2.0:1 on a dark card.
 *
 * The same measurement is why `showDataLabels` stays off rather than being
 * left to the default: white text ON `#B07C17` is 3.7:1, which is a contrast
 * FAILURE for a value label (AA wants 4.5:1) — the light-fill-with-white-text
 * mistake that reads fine on the author's screen. Any fill that would carry a
 * legible white label would itself be too dark to clear 3:1 on a dark card.
 * The two constraints do not have a common solution in one hex, so the labels
 * come off the fill instead of the fill coming off the palette.
 */
export const DutyHealthDashboard = Dashboard.create({
  name: 'duly_duty_health',
  label: 'Duty health',

  /**
   * Rendered under the title by the header (`showDescription`), which is what
   * the card's "on the dashboard, not buried in a tooltip" asks for. Two
   * sentences, both load-bearing: the caliber note explains why these numbers
   * are smaller than a raw task count, and the second explains an absence a
   * manager would otherwise read as good news.
   */
  description:
    'Governed duties only — role-catalog and manager-assigned work. Self-declared duties are '
    + 'excluded from every number here. Lateness is not shown yet: it depends on each duty\'s '
    + 'grace period, which this view cannot apply — the Team → Late list is the interim answer '
    + 'and it does not account for grace.',

  header: {
    showTitle: true,
    // Load-bearing rather than a restated default: the caliber note lives in
    // `description`, so turning this off would silently delete it.
    showDescription: true,
    // No actions. Nothing on this dashboard is editable, and a header action
    // is the only affordance that dispatches one (a widget has no button —
    // `widgets[].actionUrl` was retired in 17.0.0).
  },

  columns: 12,
  gap: 4,

  widgets: [
    /**
     * 1. THE HEADLINE. Top-left, and the largest tile on the screen — the
     * earliest actionable signal, and the one no other tool in the stack
     * gives a manager.
     */
    {
      id: 'not_moving_14d',
      title: 'Not moving',
      description:
        'Open governed tasks untouched for more than 14 days. Governed duties only; '
        + 'self-declared work is excluded.',
      type: 'metric',
      dataset: 'duly_stagnation',
      values: ['untouched_over_14d'],
      colorVariant: 'warning',
      layout: { x: 0, y: 0, w: 6, h: 4 },
    },

    /**
     * 2. The >30d count, beside it. A SEPARATE tile because the thresholds
     * nest: every task counted here is also counted above, and two tiles
     * cannot be added up by eye the way two stacked bars invite.
     *
     * `orange` rather than `danger`: deeper attention, not a failure verdict.
     */
    {
      id: 'not_moving_30d',
      title: 'Not moving over 30 days',
      description: 'A subset of the tile beside it, not an addition to it.',
      type: 'metric',
      dataset: 'duly_stagnation',
      values: ['untouched_over_30d'],
      colorVariant: 'orange',
      layout: { x: 6, y: 0, w: 3, h: 4 },
    },

    /**
     * 3. The worst single case, as a DATE. `oldest_last_update_at` is a `min`
     * over a timestamp — it names a day, never a magnitude and never a
     * person, which is what makes "what is the worst thing here" answerable
     * on a screen that ranks nobody.
     */
    {
      id: 'oldest_touch',
      title: 'Oldest untouched task',
      description: 'The last time anything moved on the stalest open task — a date, not a score.',
      type: 'metric',
      dataset: 'duly_stagnation',
      values: ['oldest_last_update_at'],
      colorVariant: 'default',
      layout: { x: 9, y: 0, w: 3, h: 4 },
    },

    /**
     * 4. By unit. Ordered by the unit DIMENSION, never by the count —
     * `sortBy` names a selected dimension, so the bar order is a property of
     * the org chart and not of who is doing badly this week. Unit comparison
     * is a workload question; the same chart keyed on `owner` would be a
     * performance score, which is why `owner` appears nowhere in this file.
     *
     * `business_unit` is a LOOKUP, and ordering one used to sort by the
     * opaque FK id — "sorted by unit" that reads as random (objectstack#3680).
     * That was fixed upstream in #3693: a select/lookup dimension is now
     * ordered by the resolved display LABEL, which is what makes this the
     * "unit name" order the card asks for rather than merely a count-free
     * one. Worth a glance in a browser with real units — this repo cannot run
     * the analytics query.
     *
     * ⚠ Nothing in the platform checks that `sortBy` names something this
     * widget selects: a typo here exits 0 on both gates and the authored
     * order silently does not happen (objectstack#14148 part B). That is why
     * `test/dashboard.test.ts` resolves it.
     *
     * One series, deliberately: `untouched_over_14d` and `untouched_over_30d`
     * are nested thresholds, so a second series here would invite exactly the
     * addition the nesting forbids. The >30d number is a tile of its own
     * above.
     */
    {
      id: 'not_moving_by_unit',
      title: 'Not moving, by business unit',
      description:
        'Open governed tasks untouched over 14 days, per unit. Units are ordered by name, '
        + 'never by the count.',
      type: 'horizontal-bar',
      dataset: 'duly_stagnation',
      dimensions: ['business_unit'],
      values: ['untouched_over_14d'],
      chartConfig: {
        type: 'horizontal-bar',
        colors: ['#B07C17'],
        showLegend: false,
        showDataLabels: false,
      },
      options: { sortBy: 'business_unit', sortOrder: 'asc' },
      layout: { x: 0, y: 4, w: 7, h: 6 },
    },

    /**
     * 5. Coming up — the forward look, so an overloaded fortnight is visible
     * while it can still be rebalanced.
     *
     * The window is the widget's own presentation-scope `filter`, ANDed into
     * the dataset query as `runtimeFilter`. Both tokens are real date macros
     * (`DATE_MACRO_PARAM_RE`), resolved server-side before the driver sees
     * them; an unknown token fails the build rather than comparing as a
     * literal string and matching nothing.
     *
     * No status narrowing. `tasks_due` means "governed, not cancelled" in
     * both datasets that declare it, and adding `status IN (open,in_progress)`
     * here would put a different number behind that name on this one screen.
     * The dataset was written for this widget: "governed tasks due, bucketed
     * forward by week".
     */
    {
      id: 'coming_up',
      title: 'Coming up',
      description: 'Governed tasks due in the next 14 days, by week.',
      type: 'bar',
      dataset: 'duly_workload',
      dimensions: ['due_week'],
      values: ['tasks_due'],
      filter: {
        due_date: { $gte: '{today}', $lte: '{14_days_from_now}' },
      },
      chartConfig: {
        type: 'bar',
        colors: ['#2E7C8E'],
        showLegend: false,
        showDataLabels: false,
      },
      // Chronological, and — like the chart above — independent of the count.
      options: { sortBy: 'due_week', sortOrder: 'asc' },
      layout: { x: 7, y: 4, w: 5, h: 6 },
    },
  ],
});
