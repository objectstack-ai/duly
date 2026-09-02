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
 * ── The on-time rate, and what it is a rate OF ───────────────────────────
 *
 * The card asked for five things in reading order, and two of them — *"Late"*
 * and *"On-time rate"* — used to be one missing comparison,
 * `completed_at <= due_date + duty.grace_days`, which no filter grammar can
 * express (no date arithmetic, no column-to-column comparison on the SQL path,
 * and the offset is itself a column: objectstack#14104).
 *
 * #52 answered it by moving the comparison off the query and onto the row:
 * `late_after` is stamped at dispatch, `completed_late` at completion, both
 * write-once. So the tile below binds `on_time_rate`, a derived ratio of two
 * plain counts, and needs no platform change — #14104 stopped being a blocker
 * rather than getting resolved. `src/datasets/duty-health.dataset.ts` carries
 * the reasoning.
 *
 * **It is a rate over COMPLETED work** — `tasks_done_on_time / tasks_done` —
 * and the description below says so on the screen. That is the number a
 * compliance manager is asked for, and it is not the same as "how much of what
 * was owed got done": still-open work is not in it. Stagnation is what answers
 * for work that has not finished, which is why the not-moving tile keeps the
 * headline position rather than being displaced by this one.
 *
 * A grace-free approximation is STILL not built here, and is still the thing
 * to refuse: a widget `filter` of `due_date < {today}` over `tasks_due` is a
 * "late" count in two lines, and it marks late every task inside the grace its
 * own duty grants. `test/dashboard.test.ts` pins that shape out.
 *
 * The ordering rule stands for the same reason it always did: stagnation is
 * the EARLIER signal — a task untouched for three weeks and not due for
 * another two is already a problem, and no lateness measure can see it until
 * it is too late to act.
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
 * ── The p20 set: four cards, and why six tiles is still four cards ───────
 *
 * The sales deck's p20 is the leadership first screen: four KPI cards and two
 * charts. Read against this file the four are 停滞项 (stagnation), 逾期项
 * (overdue), 按期完成率 (on-time rate) and 清单完备度 (list completeness) —
 * and the first of them is the THREE tiles at the top of this file, not one.
 * That is deliberate and predates the deck: the >14d and >30d thresholds nest,
 * so two tiles is the one arrangement that cannot be misread as a partition
 * (above), and `oldest_last_update_at` is the date that answers "the worst
 * one" without ranking anybody. Collapsing them to fit a slide count would
 * delete a measured decision to satisfy an arithmetic that was never about
 * widget count. `test/dashboard.test.ts` pins the >30d tile's "subset" wording
 * for the same reason.
 *
 * Neither of the two charts already here was retired to make room. "Not
 * moving, by unit" and "Coming up" answer questions the deck's two do not —
 * the earliest actionable signal per unit, and the forward look — and the deck
 * is a sales narrative, not an inventory of what a manager may see. Four
 * charts, two rows.
 *
 * ── 逾期項: a plain date filter now, and still not a due-date window ──────
 *
 * `tasks_overdue` is `late_after < {today} AND status IN (open, in_progress)`,
 * on the governed measure like everything else here. Two things about it are
 * worth not re-deriving:
 *
 *  - It is a column against a MACRO, not a column against a column. #52 put
 *    the deadline on the row at dispatch, so the comparison objectstack#14104
 *    cannot express never has to be made. Nothing here needs the platform to
 *    change.
 *  - It is NOT `due_date < {today}`. That version needs no new measure at all,
 *    which is exactly why it keeps being written: it marks late every task
 *    still inside the grace its own duty grants. The dataset file carries the
 *    refusal; `test/dashboard.test.ts` pins both the widget and the measure
 *    side.
 *
 * The by-unit chart under it is the same measure with the unit dimension, and
 * is ordered by the unit NAME for the same reason its neighbour above it is:
 * the bar order is a property of the org chart, never of who is doing badly
 * this week.
 *
 * ── 清单完备度, and the sub-caption that is a platform gap ────────────────
 *
 * The tile binds `approved_rate` — approved duties as a share of the duty
 * REGISTER, over `review_status`. It is never a count of list items per person
 * or per unit: "whose list is shortest" is the ranking `AGENTS.md` bans
 * outright, and the two are easy to confuse because both are "completeness".
 * `duly_duty_register` carries that distinction in full.
 *
 * The deck also asks for a sub-caption under the number — "N to confirm / M to
 * approve". **The platform cannot render one on a dataset-bound tile today**,
 * measured on objectui rather than assumed:
 *
 *  - `plugin-dashboard/src/DatasetWidget.tsx`, the `isMetric` branch, reads
 *    `values[0]` and drops every other measure the widget selects. A second
 *    and third measure here would be silently invisible — the worst available
 *    failure on this screen.
 *  - The authored sub-caption slot IS `widget.options.description`
 *    (`DashboardRenderer.tsx`, `tWidgetSubCaption`, translation key
 *    `…widgets.<id>.subCaption`) — but it is passed only on the inline
 *    `object-metric` / static-value paths, under `isObjectProvider`. A
 *    dataset-bound widget renders through `DatasetWidget`, which never reads
 *    it. Since `dataset` is REQUIRED on `DashboardWidgetSchema`, every
 *    spec-valid widget takes that path, so the key is declared and reachable
 *    by nothing.
 *
 * So the tile ships with the rate and its `description` line, and the two
 * pending counts are NOT approximated into the title, faked as static text, or
 * smuggled in as extra `values` that would not render. Filed upstream; the
 * measures arrive with the renderer. This is the AGENTS.md rule 9 shape: the
 * gap is reported, not written around.
 *
 * ── 本月工作构成: duties, not tasks — and no month filter ─────────────────
 *
 * The pie counts `duly_duty.form` over the register: recurring / one-off /
 * standing. It is the only place on this screen a STANDING duty appears at
 * all, because a standing duty never generates a task and every other widget
 * here counts tasks. The description says so, and carries the deck's own
 * caption — the on-time rate counts recurring work only.
 *
 * There is no "this month" filter behind the deck's card name, and that is a
 * decision rather than an omission: a duty is a standing definition and has no
 * month. What "this month's work" can honestly mean over duties is the
 * register as it stands now, which is what the measure's `status != retired`
 * already says. A date window bolted on here would have to read
 * `effective_from` / `effective_to`, which are null on almost every seeded
 * duty — it would silently shrink the pie to whichever duties happened to
 * carry an effective window, and read as a composition of the whole register.
 *
 * Two presentation properties of this chart come from the FIELD, not from
 * here, and the metadata is written to agree with them rather than to fight
 * them (measured in objectui's `core/src/utils/chart-presentation.ts`,
 * `chartConfigPresentation`, and `DatasetWidget`'s `buildOptionColorMap` /
 * `buildCategoryOrder`):
 *
 *  - **Slice colour.** A select dimension's own option colours become
 *    `categoryColors`, which take PRECEDENCE over the positional `colors`
 *    palette. So the three hexes below are `duly_duty.form`'s own option
 *    colours, written out so the metadata claims what the screen actually
 *    draws — a different palette here would be inert decoration, and a
 *    contrast assertion over it would be testing a colour nobody sees.
 *  - **Slice order.** It is the picklist's declared option order, not the
 *    counts. That is the same count-independence the unit chart buys with
 *    `sortBy`, already true here by construction — which is why this widget
 *    authors no `sortBy` at all: a second, conflicting order.
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
 * The three form colours the pie inherits were put through the identical
 * test before this file agreed to restate them: `#2E7C8E` (recurring, the teal
 * already here), `#8C6512` (one-off, L≈0.149 → 5.3:1 on white, 3.6:1 on
 * #0B0F14) and `#576B73` (standing, L≈0.138 → 5.6:1 and 3.4:1). All three sit
 * inside the same [0.118, 0.30] band, so the pie needs no per-theme colour
 * either. The overdue bar reuses `#B07C17` rather than introducing a fourth
 * fill: late and not-moving are the same ATTENTION role, and this app has one
 * amber for it.
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
    + 'excluded from every number here. On-time is measured against each task\'s own grace '
    + 'period, as it stood when the task was dispatched, and counts completed work only — '
    + 'open work is what the not-moving tiles answer for.',

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
     * 3b. The on-time rate — the number the product is asked for by name.
     *
     * `on_time_rate` is `tasks_done_on_time / tasks_done`, both counts over
     * `completed_late`, the verdict stamped at completion against the grace in
     * force then. It is a RATE OVER COMPLETED WORK; the tile description says
     * so, because a rate whose denominator a reader has to guess is a number
     * they will guess wrong.
     *
     * `default` rather than `warning` / `danger`: this is the one number on the
     * screen that is good when it is high, and colouring it as an alert would
     * read as a problem at 100%. The attention colours stay on the two
     * not-moving tiles, which is where action is actually needed.
     *
     * No `owner` dimension, here or anywhere on this screen: an on-time rate
     * split by person is a performance score, and this product does not have
     * one. `test/dashboard.test.ts` pins that as a property of the barrel.
     */
    {
      id: 'on_time_rate',
      title: 'On-time rate',
      description:
        'Governed tasks completed within their own grace period, as a share of governed tasks '
        + 'completed. Open work is not counted here.',
      type: 'metric',
      dataset: 'duly_duty_health',
      values: ['on_time_rate'],
      colorVariant: 'default',
      // Directly under the headline tile and the same width as it — the second
      // number a manager reads — but SHORTER, and that is a rule rather than a
      // taste call: no other number on this screen may out-area the not-moving
      // tile, because stagnation is the signal that arrives early enough to act
      // on. `test/dashboard.test.ts` pins it.
      layout: { x: 0, y: 4, w: 6, h: 3 },
    },

    /**
     * 3c. Overdue — the deck's 逾期项, and the second half of what #52 made
     * expressible.
     *
     * `tasks_overdue` counts OPEN governed work past its own `late_after`, the
     * deadline stamped at dispatch from the duty's grace. Its neighbour to the
     * left is a rate over work that FINISHED; this is the same family of
     * numbers asked of work that has not. Both read a write-once stamp, and
     * neither compares a column to a column.
     *
     * `warning`, not `danger`: an overdue task is a thing to go and look at.
     * The file header carries the refusal of the two-line `due_date < {today}`
     * version, which is what this tile would be if the grace were dropped.
     */
    {
      id: 'overdue',
      title: 'Overdue',
      description:
        'Open governed tasks past their own deadline — the due date plus the grace their duty '
        + 'granted, as it stood when the task was dispatched.',
      type: 'metric',
      dataset: 'duly_duty_health',
      values: ['tasks_overdue'],
      colorVariant: 'warning',
      layout: { x: 6, y: 4, w: 3, h: 3 },
    },

    /**
     * 3d. List completeness — the deck's 清单完备度.
     *
     * Approved duties as a share of the governed register, over
     * `review_status`. NEVER a count of list items per person or per unit:
     * that is the ranking `AGENTS.md` bans, and the resemblance between the
     * two is the whole reason the dataset states the difference at length.
     *
     * `default` rather than an attention colour, for the same reason the
     * on-time tile is: this is a number that is GOOD when it is high, and
     * painting it as an alert would read as a problem at 100%.
     *
     * The card's "N to confirm / M to approve" sub-caption is missing on
     * purpose — a dataset-bound tile renders `values[0]` and nothing else, and
     * the authored sub-caption slot is unreachable on this path. Measured, and
     * filed upstream; the file header has both citations. It is not faked into
     * the description, which would be a static number that goes stale the
     * first time somebody approves a duty.
     */
    {
      id: 'list_completeness',
      title: 'List completeness',
      description:
        'Approved duties as a share of the governed duty register. Retired duties are out of both '
        + 'halves; paused ones are still owed and stay in.',
      type: 'metric',
      dataset: 'duly_duty_register',
      values: ['approved_rate'],
      colorVariant: 'default',
      layout: { x: 9, y: 4, w: 3, h: 3 },
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
      layout: { x: 0, y: 7, w: 7, h: 6 },
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
      layout: { x: 7, y: 7, w: 5, h: 6 },
    },

    /**
     * 6. Overdue by unit — the deck's 各部门逾期项分布.
     *
     * The same measure as the tile above, split by the org chart, and ordered
     * by the unit DIMENSION exactly like the not-moving chart it sits under:
     * `sortBy` names a selected dimension, so the bar order is a property of
     * the org chart and not of who is doing badly this week. Ordering it by the
     * count would turn a workload picture into a league table of units, which
     * is the same mechanism the person rule exists to stop, one level up.
     *
     * One series, and `#B07C17` again: late and not-moving are one ATTENTION
     * role and this app has one amber for it. Nothing here is `danger`.
     *
     * ⚠ Nothing in the platform checks that `sortBy` names something this
     * widget selects (objectstack#14148 part B) — `test/dashboard.test.ts`
     * resolves it.
     */
    {
      id: 'overdue_by_unit',
      title: 'Overdue, by business unit',
      description:
        'Open governed tasks past their own deadline, per unit. Units are ordered by name, '
        + 'never by the count.',
      type: 'horizontal-bar',
      dataset: 'duly_duty_health',
      dimensions: ['business_unit'],
      values: ['tasks_overdue'],
      chartConfig: {
        type: 'horizontal-bar',
        colors: ['#B07C17'],
        showLegend: false,
        showDataLabels: false,
      },
      options: { sortBy: 'business_unit', sortOrder: 'asc' },
      layout: { x: 0, y: 13, w: 7, h: 6 },
    },

    /**
     * 7. Work mix — the deck's 本月工作构成.
     *
     * The one widget on this screen that counts DUTIES rather than tasks, and
     * therefore the only place a STANDING duty is visible at all: standing work
     * never generates a task, so every other number here is structurally blind
     * to it. The description says which population it is over and carries the
     * deck's own caption — the on-time rate counts recurring work only — because
     * a composition chart beside a completion rate invites exactly the reading
     * that the rate covers all three slices.
     *
     * A pie is legitimate here where it never is for the stagnation buckets:
     * these three forms PARTITION the register (a duty has exactly one `form`),
     * while `>14d` and `>30d` nest. `test/dashboard.test.ts` enforces that
     * distinction rather than banning the chart type.
     *
     * The palette restates `duly_duty.form`'s own option colours because a
     * select dimension's option colours take precedence over the positional
     * palette — see the file header. Slice order is the picklist's, which is
     * why there is no `sortBy` here; `showDataLabels` stays off so no text is
     * drawn on a fill, and the legend carries the names on the card background.
     */
    {
      id: 'work_mix',
      title: 'Work mix',
      description:
        'The governed duty register by form. This counts duties, not tasks — a standing duty '
        + 'never generates one — and the on-time rate counts recurring work only.',
      type: 'pie',
      dataset: 'duly_duty_register',
      dimensions: ['form'],
      values: ['duties_in_register'],
      chartConfig: {
        type: 'pie',
        colors: ['#2E7C8E', '#8C6512', '#576B73'],
        showLegend: true,
        showDataLabels: false,
      },
      layout: { x: 7, y: 13, w: 5, h: 6 },
    },
  ],
});
