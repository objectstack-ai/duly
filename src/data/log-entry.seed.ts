// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';

import { visibleFromFor } from '../functions/period.js';
import { LogEntry } from '../objects/log-entry.object.js';

import { ADMIN } from './demo-org.js';
import { TODAY } from './demo-history.js';

/**
 * The personal work log — fifteen entries for two people, mostly private.
 *
 * These exist to show the module AND to demonstrate what it deliberately
 * cannot do. Nothing here has a due date, a status, a completion or a period,
 * so there is no measure anywhere that could pick these rows up: every dataset
 * in `src/datasets/` is `object: 'duly_task'`. Fifteen entries for one person
 * and none for another says nothing about either of them, by construction —
 * which is the whole reason the work log is a separate object rather than a
 * "private" flag on `duly_task`.
 *
 * Both log-keepers are chosen for that reason too. One is the account
 * `objectstack dev` logs you in as, so the Work log screen — owner-scoped,
 * like every other personal view — is not blank on first boot.
 *
 * ── No `related_task`, and it is a mechanism rather than a preference ────
 * `duly_task`'s seed datasets are keyed on composites (`(duty, owner,
 * period_key)` and `(subject, owner)`), and the loader can only resolve a
 * natural key into an object through a single string field, falling back to a
 * `name` column that `duly_task` does not declare. So a `related_task` value
 * here would not resolve; it would be deferred to pass 2, fail there too, and
 * be dropped with a warning. Left out rather than left broken. See
 * `task.seed.ts` for why those keys are what they are.
 */

/** `TODAY` shifted back by `days`, through the period engine's own civil-date shift. */
const daysAgo = (days: number): string => visibleFromFor(TODAY, days);

interface DemoLogEntry {
  subject: string;
  owner: string;
  daysAgo: number;
  category: 'coordination' | 'drafting' | 'incident' | 'meeting' | 'support' | 'other';
  visibility: 'private' | 'manager';
  detail?: string;
}

/** Subjects are unique across the fixture — `subject` is this dataset's external id. */
const ENTRIES: readonly DemoLogEntry[] = [
  // ── The account you are logged in as ──────────────────────────────────
  { subject: 'Walked the new starter through the permit register', owner: ADMIN, daysAgo: 2, category: 'support', visibility: 'private' },
  { subject: 'Rewrote the sampling instruction after the lab query', owner: ADMIN, daysAgo: 4, category: 'drafting', visibility: 'private', detail: 'The old wording let two people read the hold time differently. Now it names the clock.' },
  { subject: 'Chased the carrier for three missing transfer notes', owner: ADMIN, daysAgo: 6, category: 'coordination', visibility: 'private' },
  { subject: 'Standing call with the regulator liaison', owner: ADMIN, daysAgo: 9, category: 'meeting', visibility: 'manager' },
  { subject: 'Out-of-hours callout: effluent alarm on the north outfall', owner: ADMIN, daysAgo: 13, category: 'incident', visibility: 'manager', detail: 'False alarm on a blocked float. Logged with maintenance; no discharge event.' },
  { subject: 'Drafted the shutdown environmental brief', owner: ADMIN, daysAgo: 18, category: 'drafting', visibility: 'private' },
  { subject: 'Sat in on the Riverside permit review to compare approaches', owner: ADMIN, daysAgo: 25, category: 'meeting', visibility: 'private' },
  { subject: 'Half a day rebuilding the meter reading spreadsheet', owner: ADMIN, daysAgo: 33, category: 'other', visibility: 'private', detail: 'It had grown three tabs nobody owned. Now one tab, one owner.' },

  // ── A second log-keeper, so the module is not a single-person screen ──
  { subject: 'Recalibrated the bench balance after the move', owner: 'Rosa Delgado', daysAgo: 1, category: 'other', visibility: 'private' },
  { subject: 'Covered the goods-in checks while Ibrahim was on leave', owner: 'Rosa Delgado', daysAgo: 5, category: 'support', visibility: 'private' },
  { subject: 'Traced the drift on the pH probe back to the buffer batch', owner: 'Rosa Delgado', daysAgo: 8, category: 'incident', visibility: 'manager', detail: 'Buffer was out of date. Quarantined the batch and reran the affected checks.' },
  { subject: 'Wrote up the retained-sample disposal procedure', owner: 'Rosa Delgado', daysAgo: 12, category: 'drafting', visibility: 'private' },
  { subject: 'Lab handover meeting with the night shift', owner: 'Rosa Delgado', daysAgo: 16, category: 'meeting', visibility: 'private' },
  { subject: 'Helped operations read the swab results', owner: 'Rosa Delgado', daysAgo: 22, category: 'support', visibility: 'private' },
  { subject: 'Sorted the supplier certificate folder into something findable', owner: 'Rosa Delgado', daysAgo: 30, category: 'coordination', visibility: 'private' },
];

export const logEntrySeed = defineSeed(LogEntry, {
  externalId: 'subject',
  mode: 'upsert',
  records: ENTRIES.map((entry) => ({
    subject: entry.subject,
    detail: entry.detail,
    owner: entry.owner,
    logged_on: daysAgo(entry.daysAgo),
    category: entry.category,
    visibility: entry.visibility,
  })),
});
