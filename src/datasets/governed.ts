// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import type { FilterCondition } from '@objectstack/spec/data';

/**
 * The caliber gate, in one place, for every measure in every duly dataset.
 *
 * ── Why this is a constant and not a convention ───────────────────────────
 * `catalog` and `assigned` duties are what the ORGANISATION put on someone:
 * a rate over them means something, because somebody else decided the work
 * was owed. `self` duties are the owner's own record-keeping.
 *
 * A single on-time rate that quietly folds self-declared work in punishes
 * exactly the people who declared the most — declare five extra duties, miss
 * one, and your number goes down while the colleague who declared nothing
 * stays at 100%. That is not a reporting inaccuracy; it is a mechanism that
 * teaches an organisation to declare nothing, and it takes about one quarter
 * to work. So the filter is not a default that a measure may opt out of: it
 * is on EVERY measure in `dulyDatasets`, with no exception list, and
 * `test/datasets.test.ts` walks the barrel to keep it that way.
 *
 * There is deliberately no `ungoverned()` counterpart. An exception list is
 * the erosion path — the next reasonable-looking ticket adds one measure to
 * it, and the one after that adds two. Self-declared work is SURFACED, in the
 * operational views (`src/views/task.view.ts` carries `source` as a column and
 * scores nothing); it is not surfaced through the metric layer.
 *
 * `source` remains a DIMENSION on the datasets so the governed population can
 * still be split by where the work came from — "how much of this unit's load
 * is manager-assigned rather than role-catalog?" is a real question, and it is
 * answerable without ever putting `self` into a score.
 */
export const GOVERNED_SOURCES = ['catalog', 'assigned'] as const;

/**
 * `source IN ('catalog','assigned')`, ANDed with whatever else the measure
 * needs. A `FilterCondition` is a record of field conditions combined with
 * AND, so spreading is the whole implementation — no `$and` wrapper needed.
 *
 * Read `duly_task.source` and not `duty.source`: the task carries its own copy,
 * stamped at dispatch, so a task keeps the caliber it was dispatched under even
 * if the duty is later re-sourced. That is history, not drift — and it means a
 * governed measure does not depend on the `duty` join being present.
 */
export const governed = (extra: FilterCondition = {}): FilterCondition => ({
  source: { $in: [...GOVERNED_SOURCES] },
  ...extra,
});
