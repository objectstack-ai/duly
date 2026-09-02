// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { visibleFromFor } from '../functions/period.js';

import { t } from './demo-locale.js';
import { ADMIN } from './demo-org.js';
import { NOW, TODAY } from './demo-history.js';

/**
 * The two assignments, and the tasks their fan-out would have produced.
 *
 * ⚠️ **The fan-out tasks are seeded directly, and that is not a shortcut.**
 * `assignment.flow.ts` is a `record_change` flow, and the seed loader writes
 * with `SEED_OPTIONS = { isSystem: true, skipTriggers: true, seedReplay: true }`.
 * `skipTriggers` suppresses record-change AUTOMATION — that is its whole job —
 * so a seeded assignment never fans out, and it never will, however the
 * trigger plugins are wired. (#72 has since bound `record_change`, so the flow
 * does fire for an assignment created by hand in the UI. That does not change
 * anything here: it is the SEED path that is exempt.) Seeding an assignment
 * and waiting for its children would leave the Assignments screen showing two
 * rows with `task_count: 0` and nothing to open, which is exactly the "renders
 * an empty screen" failure this card exists to prevent.
 *
 * So the rows below are written to be **byte-identical to what
 * `assignment.flow.ts` would have created**, field for field: `subject` copied
 * from the assignment, `owner` the assignee, `business_unit` denormalised from
 * the owner, `assignment` the parent, `source: 'assigned'`, `visible_from`
 * equal to `due_date` (an assignment has no lead time to spread), `status:
 * 'open'` at creation — and NO `period_key`, because an assignment has no
 * period and the dispatch identity index does not apply to it. If one of these
 * assignments is ever re-saved by hand and the flow does fire, its own
 * idempotency guard (it looks for an existing task on `(assignment, owner)`
 * before creating one) sees these rows and creates nothing, so the seed and
 * the flow do not fight.
 *
 * The statuses below are then moved on from `open` by hand, because "mixed
 * completion" is the thing an assignment is worth looking at for.
 */

/** `TODAY` shifted forward by `days`, through the period engine's own civil-date shift. */
const inDays = (days: number): string => visibleFromFor(TODAY, -days);

const DAY = 24 * 60 * 60 * 1000;
const HOUR = 60 * 60 * 1000;
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * DAY + 3 * HOUR).toISOString();

export interface DemoAssignment {
  subject: string;
  description: string;
  assigner: string;
  assignees: readonly string[];
  dueDate: string;
  needsCollection: boolean;
}

export const ASSIGNMENTS: readonly DemoAssignment[] = [
  {
    subject: t('Winter shutdown readiness check'),
    description: t(
      'Before the shutdown window opens, confirm your area is ready: isolations listed, spares on site, contractors booked. One line per point — no report.',
    ),
    // Assigned BY the account an evaluator is logged in as, so "Sent by me" is
    // not an empty screen on first boot. `ADMIN` already follows the locale.
    assigner: ADMIN,
    assignees: ['Marek Dvorak', 'Sami Okonkwo', 'Yuki Tanabe', 'Rosa Delgado'].map(t),
    dueDate: inDays(21),
    // The assigner gets NO task of their own. That is the product rule: a
    // manager who hands out work does not inherit a to-do list from it.
    needsCollection: false,
  },
  {
    subject: t('Q3 supplier certificate sweep'),
    description: t(
      'Pull the current certificate for every approved supplier you buy from and flag any that expired during the quarter.',
    ),
    assigner: t('Priya Raman'),
    assignees: ['Rosa Delgado', 'Ibrahim Chaudhry'].map(t),
    dueDate: inDays(10),
    // The other half of the rule: ticking this — and only ticking this — is
    // what gives the assigner a follow-up task once everyone is in.
    needsCollection: true,
  },
];

export interface DemoAdHocTask {
  subject: string;
  owner: string;
  /** `duly_assignment.subject`, resolved as a natural key. Null for a plain one-off. */
  assignment: string | null;
  /** `duly_duty.name`. Null for a task that came out of an assignment. */
  duty: string | null;
  source: 'catalog' | 'assigned' | 'self';
  status: 'open' | 'in_progress' | 'done';
  dueDate: string;
  visibleFrom: string;
  completedAt?: string;
  lastUpdateAt: string;
  note?: string;
}

const readiness = ASSIGNMENTS[0]!;
const sweep = ASSIGNMENTS[1]!;

/**
 * The seven tasks the two fan-outs own, plus the one-off duty's single task.
 *
 * Mixed completion on the first assignment is the whole demonstration: four
 * independent rows, four owners, four different states, and NOBODY maintaining
 * a "2 of 4 done" field — `duly_assignment.task_count` is an ADR-0021 summary
 * the platform computes on read.
 */
export const AD_HOC_TASKS: readonly DemoAdHocTask[] = [
  // ── Winter shutdown readiness check — four people, mixed ───────────────
  {
    subject: readiness.subject,
    owner: t('Marek Dvorak'),
    assignment: readiness.subject,
    duty: null,
    source: 'assigned',
    status: 'done',
    dueDate: readiness.dueDate,
    visibleFrom: readiness.dueDate,
    completedAt: daysAgo(4),
    lastUpdateAt: daysAgo(4),
    note: t('Isolations listed and countersigned. Spares are on site bar the two long-lead seals.'),
  },
  {
    subject: readiness.subject,
    owner: t('Sami Okonkwo'),
    assignment: readiness.subject,
    duty: null,
    source: 'assigned',
    status: 'done',
    dueDate: readiness.dueDate,
    visibleFrom: readiness.dueDate,
    completedAt: daysAgo(2),
    lastUpdateAt: daysAgo(2),
  },
  {
    subject: readiness.subject,
    owner: t('Yuki Tanabe'),
    assignment: readiness.subject,
    duty: null,
    source: 'assigned',
    status: 'in_progress',
    dueDate: readiness.dueDate,
    visibleFrom: readiness.dueDate,
    lastUpdateAt: daysAgo(1),
    note: t('Contractor slot still to be confirmed for the Line C isolation.'),
  },
  {
    subject: readiness.subject,
    owner: t('Rosa Delgado'),
    assignment: readiness.subject,
    duty: null,
    source: 'assigned',
    status: 'open',
    dueDate: readiness.dueDate,
    visibleFrom: readiness.dueDate,
    lastUpdateAt: daysAgo(6),
  },

  // ── Q3 supplier certificate sweep — two people, plus the assigner ──────
  {
    subject: sweep.subject,
    owner: t('Rosa Delgado'),
    assignment: sweep.subject,
    duty: null,
    source: 'assigned',
    status: 'in_progress',
    dueDate: sweep.dueDate,
    visibleFrom: sweep.dueDate,
    lastUpdateAt: daysAgo(3),
  },
  {
    subject: sweep.subject,
    owner: t('Ibrahim Chaudhry'),
    assignment: sweep.subject,
    duty: null,
    source: 'assigned',
    status: 'open',
    dueDate: sweep.dueDate,
    visibleFrom: sweep.dueDate,
    lastUpdateAt: daysAgo(5),
  },
  {
    // The follow-up the assigner asked for by ticking `needs_collection`.
    // Same shape as an assignee's: one owner, one row, nothing shared.
    subject: sweep.subject,
    owner: sweep.assigner,
    assignment: sweep.subject,
    duty: null,
    source: 'assigned',
    status: 'open',
    dueDate: sweep.dueDate,
    visibleFrom: sweep.dueDate,
    lastUpdateAt: daysAgo(5),
  },

  // ── The one-off duty's single task ─────────────────────────────────────
  {
    // `subject` is copied from the duty at dispatch, exactly as
    // `dispatch.plan.ts` does it, so renaming the duty never rewrites history.
    subject: t('Commissioning file handover — Riverside upgrade'),
    owner: t('Owen Pryce'),
    assignment: null,
    duty: t('Commissioning file handover — Riverside upgrade'),
    source: 'catalog',
    status: 'in_progress',
    // A one-off carries a due date set directly rather than derived from a
    // period anchor — which is why #61 takes `due_anchor` / `due_offset_days` /
    // `lead_days` off the one-off form entirely. It has no `period_key` either.
    dueDate: inDays(12),
    visibleFrom: inDays(-5),
    lastUpdateAt: daysAgo(2),
    note: t('As-builts and test records in; waiting on the spares list from the supplier.'),
  },
];
