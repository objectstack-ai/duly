// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';

import { Task } from '../objects/task.object.js';

import { unitOf } from './demo-org.js';
import { AD_HOC_TASKS } from './demo-assignments.js';
import { SEEDED_TASKS } from './demo-history.js';

/**
 * The tasks — six months of history, today's in-flight work, and the backdate
 * pass that makes "Not moving" mean something.
 *
 * ── Four datasets, and each one is load-bearing ──────────────────────────
 *
 *  1. {@link taskHistorySeed}   the dispatched series, `mode: 'upsert'`
 *  2. {@link taskAdHocSeed}     assignment fan-out + the one-off, `upsert`
 *  3. {@link taskHistoryTouchSeed}  `mode: 'update'` — `last_update_at` only
 *  4. {@link taskAdHocTouchSeed}    the same, for the ad-hoc rows
 *
 * Datasets 3 and 4 are the half that is easy to leave out, and leaving them
 * out fails SILENTLY. `completed_at` rides along on a system-context insert,
 * so `done` history writes in one pass. `last_update_at` cannot:
 * `task.hook.ts`'s `beforeInsert` stamps it unconditionally, and lifecycle
 * hooks DO run on the seed path (`skipTriggers` suppresses record-change
 * automation, not hooks), so every value supplied on the insert is overwritten
 * with the boot clock. A second pass in `mode: 'update'`, matched on the same
 * external id and carrying ONLY `last_update_at`, lands — because the
 * `beforeUpdate` leg deliberately does not stamp on an administrative write.
 *
 * Skip passes 3 and 4 and every task in the database reads as touched at boot:
 * "Not moving" is empty, "Recent activity" is one flat spike, and the seed
 * reports complete success. That is the failure mode, and it is why the
 * external ids below have to be exactly right — a key that does not match is
 * indistinguishable from a pass that never ran. Established and pinned in #32
 * / PR #64; the worked shape is in `AGENTS.md`.
 *
 * ── Why the two insert datasets use DIFFERENT external ids ───────────────
 * An external id has to identify a row uniquely, or a re-run cannot tell an
 * existing row from a new one and `upsert` silently duplicates. The two
 * populations have genuinely different identities:
 *
 *   dispatched  `(duty, owner, period_key)` — the dispatch identity itself,
 *               the same triple `duly_task_dispatch_identity` is unique on. A
 *               task's subject repeats across every period of its duty, so
 *               `subject` alone would collide six times over.
 *   ad-hoc      `(subject, owner)` — an assignment fan-out has NO `period_key`
 *               and no `duty`, so the triple above collapses to an empty key
 *               and matches nothing. Its four rows share one subject and are
 *               told apart by owner, which is exactly how the flow creates
 *               them.
 *
 * A composite key is empty — and therefore matches nothing, and inserts again
 * on every boot — the moment any part of it is blank. That is the trap; each
 * dataset uses the key that is total over its own rows.
 *
 * ── Consequence for `duly_log_entry.related_task` ────────────────────────
 * Because neither key is a single string field, the loader cannot resolve a
 * natural key INTO `duly_task` (it falls back to probing a `name` column,
 * which this object does not have). Log entries therefore carry no
 * `related_task`; see `log-entry.seed.ts`.
 */

const HISTORY_EXTERNAL_ID = ['duty', 'owner', 'period_key'];
const AD_HOC_EXTERNAL_ID = ['subject', 'owner'];

/**
 * Pass 1 — the dispatched series, as `planDispatch` produced it.
 *
 * ⚠️ `source` is written explicitly on every row. Since #54 it defaults to
 * `self`, and every dataset measure filters to `catalog` + `assigned`
 * (`src/datasets/governed.ts`) — so relying on the default would land the
 * whole history unscored and read zero on every dashboard measure, with
 * nothing erroring.
 */
export const taskHistorySeed = defineSeed(Task, {
  externalId: HISTORY_EXTERNAL_ID,
  mode: 'upsert',
  records: SEEDED_TASKS.map((task) => ({
    subject: task.subject,
    duty: task.duty,
    owner: task.owner,
    business_unit: task.business_unit,
    source: task.source,
    period_key: task.period_key,
    due_date: task.due_date,
    visible_from: task.visible_from,
    status: task.status,
    // Carried on the INSERT, from the seed loader's system context — the leg
    // that is exempt from the readonly strip. A caller's identical write is
    // still refused by `completed_at_required_when_done`, and
    // `test/seed-history.test.ts` pins both halves.
    completed_at: task.completed_at,
    skip_reason: task.skip_reason,
    note: task.note,
  })),
});

/** Pass 2 — the assignment fan-out and the one-off duty's task. */
export const taskAdHocSeed = defineSeed(Task, {
  externalId: AD_HOC_EXTERNAL_ID,
  mode: 'upsert',
  records: AD_HOC_TASKS.map((task) => ({
    subject: task.subject,
    duty: task.duty,
    owner: task.owner,
    business_unit: unitOf(task.owner),
    assignment: task.assignment,
    source: task.source,
    due_date: task.dueDate,
    visible_from: task.visibleFrom,
    status: task.status,
    completed_at: task.completedAt,
    note: task.note,
  })),
});

/**
 * Pass 3 — backdate the dispatched series.
 *
 * Carries the external id (so the row can be found) and `last_update_at`, and
 * nothing else. Deliberately nothing else: adding `status`, `note` or
 * `skip_reason` here would put the hook's stamping leg back in play and
 * overwrite the value this pass exists to set.
 */
export const taskHistoryTouchSeed = defineSeed(Task, {
  externalId: HISTORY_EXTERNAL_ID,
  mode: 'update',
  records: SEEDED_TASKS.map((task) => ({
    duty: task.duty,
    owner: task.owner,
    period_key: task.period_key,
    last_update_at: task.last_update_at,
  })),
});

/** Pass 4 — the same, for the ad-hoc rows. */
export const taskAdHocTouchSeed = defineSeed(Task, {
  externalId: AD_HOC_EXTERNAL_ID,
  mode: 'update',
  records: AD_HOC_TASKS.map((task) => ({
    subject: task.subject,
    owner: task.owner,
    last_update_at: task.lastUpdateAt,
  })),
});
