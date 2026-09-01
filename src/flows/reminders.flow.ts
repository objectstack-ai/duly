// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { expression } from '@objectstack/spec';
import { defineFlow } from '@objectstack/spec';

/**
 * The notifications that replace the status meeting — the OWNER-FACING half.
 *
 * Three sweeps live here: the two lead-time reminders and the day-one overdue
 * escalation. The two MANAGER-FACING digests the card also asks for (day-seven
 * overdue, weekly stagnation) are deliberately NOT in this file. What is
 * missing for them is not effort; it is authoring surface, and the gap is
 * recorded at the bottom of this comment rather than worked around here.
 *
 * ── Why every flow here is a `time_relative` sweep ───────────────────────
 * The card says `type: 'schedule'`, and each flow declares that — but the
 * binding the engine actually resolves is `time_relative`, because
 * `resolveTriggerBinding` reads the start node's `config` and answers
 * `time_relative` the moment `config.timeRelative` is present, BEFORE it looks
 * at `config.schedule` or `flow.type`. That is the intended shape, not a
 * coincidence of ordering: `TimeRelativeTriggerSchema` documents itself as the
 * declarative replacement for exactly the hand-written "cron job + range
 * query" a `schedule` flow would otherwise have to be.
 *
 * Two properties come with that choice, and both are load-bearing here:
 *
 * 1. **The sweep launches the flow once per matching record**, with the record
 *    in the automation context — so `{record.x}` templates and the start
 *    condition work exactly as they do for a record-change flow. That is right
 *    for an owner-facing reminder (one message, one task, one owner) and it is
 *    precisely WRONG for a digest, which is the gap noted below.
 *
 * 2. **Idempotency is the platform's, not ours.** Before launching the flow
 *    for a record the trigger takes a dispatch claim through the automation
 *    service (`claim(key)`, backed by the persisted `sys_flow_dispatch`
 *    ledger, objectstack#10220). The key is
 *    `time-relative:<flow>:<window-day>:offset<N>:<recordId>`. So the card's
 *    "record what was sent and check it before sending" is already answered by
 *    the platform for this trigger, and this app adds no marker field of its
 *    own — which is the right outcome: a per-task marker column would be a
 *    second writer for state the platform already keeps, and it would drift.
 *
 *    Read the degradation contract before trusting it: if the claim CALL
 *    throws the trigger dispatches anyway (availability over strict-once), and
 *    if no claim surface resolves at all the dedup is in-process only and the
 *    trigger says so once, loudly. Neither is silent.
 *
 * ── Why "fires once, ever" holds for the two reminders ───────────────────
 * In OFFSET mode the claim scope is the TARGET day plus the offset
 * (`<dateField's day>:offset<N>`), not the sweep day. A task's `visible_from`
 * is a fixed date, so `offsetDays: [0]` on it matches on exactly one calendar
 * day and claims exactly one key — for good. Re-running the sweep the same day
 * finds the claim and skips; there is no later day on which the record matches
 * again. That is the card's "two notifications per task, maximum, ever",
 * obtained from the trigger rather than from a flag this app has to maintain.
 *
 * The overdue sweep is the other mode and is described on its own flow.
 *
 * ── Why each flow reads the duty ─────────────────────────────────────────
 * Two of the card's suppression rules cannot be expressed in the sweep filter,
 * because they live on `duly_duty` and the filter is a flat where-map on
 * `duly_task`:
 *
 *  - the duty's `effective_from` / `effective_to` window, and
 *  - `grace_days`, which decides WHICH DAY is day one of the overdue ladder.
 *
 * So each flow reads the duty with a `get_record` and gates on the result.
 * A task with no duty (an assignment fan-out row — `assignment.flow.ts`
 * creates tasks with `duty` unset) skips the read and is treated as an open
 * window with zero grace, which is what "no duty governs this row" means.
 *
 * The third suppression — `form: 'standing'` — needs nothing here. A standing
 * duty never produces a task at all (`dispatch.plan.ts` returns
 * `{ reason: 'standing' }` before a draft exists), so there is no row for a
 * sweep to match. `test/reminders.test.ts` asserts that rather than assuming
 * it, because the card asked for the assertion and because a silent change in
 * the dispatcher is exactly what would turn this from "free" into a bug.
 *
 * ── The `int()` calls are not decoration — measured ──────────────────────
 * `daysBetween()` returns a CEL **int**. `duly_duty.grace_days` arrives from
 * the record as a host **number**, and CEL tags arithmetic over it as a
 * double. Measured on `@objectstack/formula` 17.2.0 with the same scope shape
 * `evaluateCondition` builds:
 *
 *     daysBetween(due, today()) == 1 + grace     →  false   (grace 6, 7 over)
 *     daysBetween(due, today()) == int(1 + grace)→  false   (same)
 *     daysBetween(due, today()) == int(grace) + 1→  TRUE
 *
 * All three read as the same arithmetic and two of them are silently wrong —
 * `7 == 7.0` throws `no such overload: int == double` when both sides are
 * literals, but the same mismatch reached through a record field answers
 * `false` instead. A false gate on a notification flow is indistinguishable
 * from "nothing was due", forever. `int()` goes around the FIELD, which is the
 * only placement measured to work.
 *
 * ── `has()` before `isBlank()`, always ───────────────────────────────────
 * A column that is NULL in the store can be ABSENT from the row the sweep
 * hands the flow — the time-relative trigger does no `materializeDeclaredFields`
 * (only the record-change trigger does). Measured: `isBlank(record.duty)` on a
 * row with no `duty` key THROWS `No such key: duty`, and a throwing predicate
 * faults the run. `has(record.duty)` is total — false when absent, true when
 * present-and-null — so the presence test is always `has(...) && !isBlank(...)`.
 *
 * ── Why the predicates are built with `expression()`, not P`…` ──────────
 * The house tag `P` is `cel` from `@objectstack/spec`, and its template
 * interpolation is VALUE interpolation, not text splicing — measured:
 *
 *     const X = 'has(record.duty)';
 *     P`${X} && true`   →  { dialect: 'cel', source: '"has(record.duty)" && true' }
 *
 * The fragment arrives as a quoted string LITERAL, so a composed predicate
 * built that way is not the predicate that was written and never was — it
 * parses, it ships, and it means something else. `expression(source)` takes a
 * plain string and wraps it in the identical envelope, so the shared constants
 * above compose safely. Predicates written out in full may keep using P`…`;
 * the rule is only that a `${…}` hole in P is a value, never CEL.
 *
 * ── Two platform gaps this file does NOT work around ─────────────────────
 * **1. Digest by recipient is not authorable.** The manager-facing flows are
 * absent because the node vocabulary cannot express "one message per manager
 * listing their N tasks":
 *   - there is no aggregate / group-by node, so records can only be bucketed
 *     by enumerating the recipient population and re-querying per recipient;
 *   - `notify.message` is a flat string and an array token JSON-stringifies
 *     (`stringifyForTemplate`), and `sys_email_template` holes are scalar-only
 *     (`String(raw)`, no iteration), so a list of 30 tasks has nowhere to be
 *     rendered;
 *   - the CEL stdlib HAS `joinNonEmpty(list, sep)`, but no authoring slot
 *     evaluates CEL to a VALUE — `FLOW_NODE_EXPRESSION_PATHS` declares only
 *     `predicate` and `flow-template` roles, and the `assignment` node
 *     interpolates rather than evaluating — so it is unreachable.
 * Filed upstream; see the card. Shipping a count-only digest here would have
 * satisfied "one message, not thirty" while quietly dropping "listing 30", and
 * that is the kind of workaround that makes a platform gap permanent.
 *
 * **2. Notification text cannot be localized in this app.** The localizable
 * `notify` path is `template`, naming a `sys_email_template` bundle;
 * `defineStack` accepts an `emailTemplates` collection but this app wires no
 * barrel for one, and `objectstack.config.ts` is not editable from a feature
 * branch. So the inline `title`/`message` below are the only content path
 * available, and they are the explicitly NON-localizable one — a declared
 * deviation from the house rule "do not hard-code display text in a flow"
 * (AGENTS.md §8), not an oversight. English is the source language, so the
 * strings are at least the right source text; they are simply untranslatable
 * until the app has an email-template barrel.
 */

// ─── Shared authoring constants ──────────────────────────────────────────

/**
 * The statuses a reminder may fire for. `done` / `skipped` / `cancelled` are
 * excluded IN THE SWEEP FILTER rather than in a flow condition, so a completed
 * task never launches a run and never consumes a dispatch claim — which is
 * what makes "completing a task before its due date produces no further
 * notifications of any kind" true by construction rather than by a gate that
 * has to be repeated on every path.
 */
const LIVE_TASK = { status: { $in: ['open', 'in_progress'] } } as const;

/**
 * Sweep cadence. The trigger defaults to this exact expression when `schedule`
 * is omitted (`TIME_RELATIVE_DEFAULT_CRON`); it is written out because the day
 * a deployment wants a different hour, the knob should be visible rather than
 * discovered. It is a SIBLING of `timeRelative` on the start node's config,
 * never a key inside it, and never a flow-level key.
 */
const DAILY_AT_0800_UTC = { type: 'cron', expression: '0 8 * * *' } as const;

/**
 * Fields read off the duty. A projection rather than the whole row: these
 * three are the only ones any gate here reads, and a narrow projection is what
 * keeps a later field rename from looking like it works.
 */
const DUTY_GATE_FIELDS = ['id', 'grace_days', 'effective_from', 'effective_to'] as const;

/**
 * How far back the overdue sweep looks, and therefore the largest
 * `grace_days` the day-one escalation can honour.
 *
 * A duty with grace ≥ 15 has its escalation day fall outside the swept window
 * and is never escalated — silently. That used to be reachable: `grace_days`
 * declared `min: 0` and no maximum, and the demo catalog shipped an item with
 * 21. Since #82 the field declares `max: 14`, which is THIS number minus one,
 * so every value the object accepts is a value this sweep can honour.
 *
 * The two are still two numbers in two files, coupled by nothing but this
 * comment and `test/reminders.test.ts`, which reads both and refuses to let
 * either move alone. Raising the field's ceiling means raising this. The
 * alternative — an unbounded lookback — re-launches the flow every day for
 * every task ever missed, which is the "ancient record re-alerting forever"
 * the trigger's own `withinDays` doc warns about.
 */
const OVERDUE_LOOKBACK_DAYS = 15;

/** `true` when the task names a duty whose row is worth reading. */
const HAS_DUTY = 'has(record.duty) && !isBlank(record.duty)';

/** `true` when the task names no duty at all — total over absent AND null. */
const NO_DUTY = '!has(record.duty) || isBlank(record.duty)';

/**
 * `true` when TODAY falls inside the duty's effective window.
 *
 * Evaluated against `today()`, not against the task's `due_date`: the card's
 * rule is that nothing FIRES outside the window, and firing happens now. A
 * duty retired last week stops nagging about the tasks it already produced,
 * which is the behaviour "effective_to" is bought for.
 *
 * Both ends are optional on the object and may be absent from the row, hence
 * the `has()` guards; an unset end is an open end.
 */
const DUTY_WINDOW_OPEN =
  '(!has(vars.duty_record.effective_from) || isBlank(vars.duty_record.effective_from)' +
  ' || date(vars.duty_record.effective_from) <= today())' +
  ' && (!has(vars.duty_record.effective_to) || isBlank(vars.duty_record.effective_to)' +
  ' || date(vars.duty_record.effective_to) >= today())';

/** The duty's grace in days, defaulting to 0 when unset or absent. */
const DUTY_GRACE =
  '(has(vars.duty_record.grace_days) && !isBlank(vars.duty_record.grace_days)' +
  ' ? vars.duty_record.grace_days : 0)';

/** Days elapsed since the due date. Positive once the task is late. */
const DAYS_PAST_DUE = 'daysBetween(record.due_date, today())';

// ─── 1 · Lead-time reminder — the task appears on the owner's list ───────

/**
 * `duly_task_lead_time_reminder` — fires the day a task crosses
 * `visible_from`, to its owner. One message per task, ever.
 *
 * `visible_from` is `due_date - duty.lead_days`, stamped at dispatch. Sweeping
 * the STORED column rather than recomputing the lead time is what lets this be
 * one `offsetDays: [0]` descriptor instead of a per-duty calculation — the
 * same reason the column exists at all.
 */
export const LeadTimeReminder = defineFlow({
  name: 'duly_task_lead_time_reminder',
  label: 'Lead-time reminder',
  description:
    "Tells a task's owner, once, on the day the task becomes visible on their list.",

  type: 'schedule',
  status: 'active',
  // A sweep has no trigger user. Under the default `runAs: 'user'` its data
  // operations are REFUSED outright (#3760), so this is not a preference.
  runAs: 'system',

  // Declared so it is BOUND: a `get_record` that never runs leaves its
  // `outputVariable` unset, and an unbound name aborts the CEL predicate that
  // reads it instead of yielding false. `duty_record` collides with no
  // `duly_task` field — a declared variable SHADOWS a record field of the same
  // name, which would silently replace the field for the rest of the flow.
  variables: [{ name: 'duty_record', type: 'record', defaultValue: null }],

  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Task becomes visible today',
      config: {
        // The trigger reads the swept object from `timeRelative.object` and
        // falls back to `objectName`; both are stated because `objectName` is
        // also where `objectstack validate` and the repo's flow-predicate
        // stopgap look for the flow's bound object. Omitting it would leave
        // both gates with no field list to anchor on — passing vacuously.
        objectName: 'duly_task',
        timeRelative: {
          object: 'duly_task',
          dateField: 'visible_from',
          // Exactly the day it crosses. Offset mode, so the claim key is tied
          // to that day and the reminder cannot repeat on any later sweep.
          offsetDays: [0],
          filter: LIVE_TASK,
        },
        schedule: DAILY_AT_0800_UTC,
      },
    },
    {
      id: 'read_duty',
      type: 'get_record',
      label: 'Read the governing duty',
      config: {
        objectName: 'duly_duty',
        filter: { id: '{record.duty}' },
        fields: [...DUTY_GATE_FIELDS],
        outputVariable: 'duty_record',
      },
    },
    {
      id: 'notify_owner',
      type: 'notify',
      label: 'Tell the owner',
      config: {
        recipients: '{record.owner}',
        title: '{record.subject}',
        message: 'This is now on your list. Due {record.due_date}.',
        severity: 'info',
        topic: 'duly.task_lead_time',
        // The pair only takes effect together; a half-specified target is
        // dropped so the inbox never renders a dead link.
        sourceObject: 'duly_task',
        sourceId: '{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'Done' },
  ],

  edges: [
    {
      id: 'e_read_duty',
      source: 'start',
      target: 'read_duty',
      type: 'conditional',
      label: 'Task belongs to a duty',
      condition: expression(HAS_DUTY),
    },
    // An assignment fan-out task has no duty and therefore no effective
    // window to be outside of.
    { id: 'e_no_duty', source: 'start', target: 'notify_owner', isDefault: true },

    {
      id: 'e_window_open',
      source: 'read_duty',
      target: 'notify_owner',
      type: 'conditional',
      label: 'Duty is in its effective window',
      condition: expression(DUTY_WINDOW_OPEN),
    },
    { id: 'e_window_closed', source: 'read_duty', target: 'end', isDefault: true },

    { id: 'e_done', source: 'notify_owner', target: 'end' },
  ],
});

// ─── 2 · Lead-time reminder — two days out ───────────────────────────────

/**
 * `duly_task_due_soon_reminder` — the second and last owner reminder, two days
 * before `due_date`.
 *
 * A separate flow rather than a second branch of the one above, because a
 * `timeRelative` descriptor carries exactly ONE `dateField` and this one
 * sweeps `due_date` while that one sweeps `visible_from`. Splitting is what
 * the descriptor's shape requires; it does not change the volume budget, which
 * is counted per task (two, maximum, ever) and not per flow.
 *
 * When a duty's lead time is under two days the two reminders can land in the
 * other order, or on the same day — a task whose `visible_from` equals its
 * `due_date` (every assignment fan-out row) gets the due-soon note first. That
 * is still two messages, and telling somebody about work two days out is the
 * point; it is recorded here so it reads as a decision.
 */
export const DueSoonReminder = defineFlow({
  name: 'duly_task_due_soon_reminder',
  label: 'Due-soon reminder',
  description: "Tells a task's owner, once, two days before the task is due.",

  type: 'schedule',
  status: 'active',
  runAs: 'system',

  variables: [{ name: 'duty_record', type: 'record', defaultValue: null }],

  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Task falls due in two days',
      config: {
        objectName: 'duly_task',
        timeRelative: {
          object: 'duly_task',
          dateField: 'due_date',
          offsetDays: [2],
          filter: LIVE_TASK,
        },
        schedule: DAILY_AT_0800_UTC,
      },
    },
    {
      id: 'read_duty',
      type: 'get_record',
      label: 'Read the governing duty',
      config: {
        objectName: 'duly_duty',
        filter: { id: '{record.duty}' },
        fields: [...DUTY_GATE_FIELDS],
        outputVariable: 'duty_record',
      },
    },
    {
      id: 'notify_owner',
      type: 'notify',
      label: 'Tell the owner',
      config: {
        recipients: '{record.owner}',
        title: '{record.subject}',
        message: 'Due in 2 days, on {record.due_date}.',
        severity: 'info',
        topic: 'duly.task_due_soon',
        sourceObject: 'duly_task',
        sourceId: '{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'Done' },
  ],

  edges: [
    {
      id: 'e_read_duty',
      source: 'start',
      target: 'read_duty',
      type: 'conditional',
      label: 'Task belongs to a duty',
      condition: expression(HAS_DUTY),
    },
    { id: 'e_no_duty', source: 'start', target: 'notify_owner', isDefault: true },

    {
      id: 'e_window_open',
      source: 'read_duty',
      target: 'notify_owner',
      type: 'conditional',
      label: 'Duty is in its effective window',
      condition: expression(DUTY_WINDOW_OPEN),
    },
    { id: 'e_window_closed', source: 'read_duty', target: 'end', isDefault: true },

    { id: 'e_done', source: 'notify_owner', target: 'end' },
  ],
});

// ─── 3 · Overdue escalation, stage one — the owner ───────────────────────

/**
 * `duly_task_overdue_owner_escalation` — day one past `due_date + grace_days`,
 * to the owner.
 *
 * ── Why this one is a RANGE sweep with a gate, and the others are not ────
 * The escalation day is `due_date + grace_days + 1`, and `grace_days` lives on
 * the duty. `offsetDays` is a static array authored at build time, so it
 * cannot express an offset that varies per record — an `offsetDays: [-1]`
 * sweep would notify on day one past DUE and silently skip every graced duty's
 * real day one. So the sweep casts a bounded range (`withinDays:
 * -OVERDUE_LOOKBACK_DAYS`) and the exact day is decided in the flow, where the
 * duty is readable.
 *
 * The cost is stated rather than hidden: in range mode the claim scope is the
 * SWEEP day, so this flow is launched once a day for every task in the window
 * and takes a ledger row each time, most of them ending at `end` without
 * notifying. What the claim still buys is the thing that matters — a re-run or
 * a retry within the same day cannot double-notify — and the exact-day gate
 * gives the once-per-stage property the card asks for.
 *
 * ── Why the gate is `== grace + 1` and not `>= grace + 1` ────────────────
 * `>=` would re-notify on every remaining day of the window. Equality is the
 * "day one" the card names, and the day-seven manager stage is the escalation
 * that follows — not a second nudge at the owner.
 */
export const OverdueOwnerEscalation = defineFlow({
  name: 'duly_task_overdue_owner_escalation',
  label: 'Overdue escalation — owner',
  description:
    "Tells a task's owner, once, on the first day the task is past its due date plus the duty's grace.",

  type: 'schedule',
  status: 'active',
  runAs: 'system',

  variables: [{ name: 'duty_record', type: 'record', defaultValue: null }],

  nodes: [
    {
      id: 'start',
      type: 'start',
      label: 'Task is inside the overdue lookback',
      config: {
        objectName: 'duly_task',
        timeRelative: {
          object: 'duly_task',
          dateField: 'due_date',
          // Negative = a bounded past-due lookback, deliberately bounded so an
          // ancient record does not re-alert forever.
          withinDays: -OVERDUE_LOOKBACK_DAYS,
          filter: LIVE_TASK,
        },
        schedule: DAILY_AT_0800_UTC,
      },
    },
    {
      id: 'read_duty',
      type: 'get_record',
      label: 'Read the governing duty',
      config: {
        objectName: 'duly_duty',
        filter: { id: '{record.duty}' },
        fields: [...DUTY_GATE_FIELDS],
        outputVariable: 'duty_record',
      },
    },
    {
      id: 'notify_owner',
      type: 'notify',
      label: 'Tell the owner it is late',
      config: {
        recipients: '{record.owner}',
        title: '{record.subject}',
        message: 'Past due since {record.due_date}.',
        severity: 'warning',
        topic: 'duly.task_overdue',
        sourceObject: 'duly_task',
        sourceId: '{record.id}',
      },
    },
    { id: 'end', type: 'end', label: 'Done' },
  ],

  edges: [
    {
      id: 'e_read_duty',
      source: 'start',
      target: 'read_duty',
      type: 'conditional',
      label: 'Task belongs to a duty',
      condition: expression(HAS_DUTY),
    },
    // No duty means no grace and no effective window: day one is the day after
    // the due date. Written as its own conditional rather than a default,
    // because the default edge cannot carry the day-one test as well.
    {
      id: 'e_no_duty_day_one',
      source: 'start',
      target: 'notify_owner',
      type: 'conditional',
      label: 'Duty-less task, first day late',
      condition: expression(`(${NO_DUTY}) && ${DAYS_PAST_DUE} == 1`),
    },
    // Every other day in the lookback window.
    { id: 'e_not_today', source: 'start', target: 'end', isDefault: true },

    {
      id: 'e_day_one',
      source: 'read_duty',
      target: 'notify_owner',
      type: 'conditional',
      label: 'First day past due plus grace',
      // `int()` around the FIELD — see the header. `int(1 + grace)` is
      // measurably NOT equivalent and answers false.
      condition: expression(
        `${DUTY_WINDOW_OPEN} && ${DAYS_PAST_DUE} == int(${DUTY_GRACE}) + 1`,
      ),
    },
    { id: 'e_not_day_one', source: 'read_duty', target: 'end', isDefault: true },

    { id: 'e_done', source: 'notify_owner', target: 'end' },
  ],
});

/**
 * Everything in this file, in card order, so the barrel spreads one name.
 *
 * The two manager digests the card asks for are absent by decision, not by
 * omission — see the file header and the report on the card.
 */
export const dulyReminderFlows = [
  LeadTimeReminder,
  DueSoonReminder,
  OverdueOwnerEscalation,
];
