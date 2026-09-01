// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineSeed } from '@objectstack/spec/data';

import { Duty } from '../objects/duty.object.js';

import { timezoneOf, unitOf } from './demo-org.js';
import { DUTIES, cadenceOf, catalogItem, type DemoCatalogItem } from './demo-catalog.js';
import { HISTORY_FROM } from './demo-history.js';

/**
 * The catalog instantiated onto people — what each person actually owes.
 *
 * Thirty duties over thirteen people, in three calibers:
 *
 *   `catalog`   the organisation put it there, from a role catalog. Scored.
 *   `assigned`  a manager handed it over. Scored. (Produced by the assignment
 *               fan-out, so no `assigned` DUTY exists — see `task.seed.ts`.)
 *   `self`      the owner's own record-keeping. Surfaced everywhere, scored
 *               nowhere. Four of these, so the split is visible on screen.
 *
 * ⚠️ `source` is stated on every row and never left to the default. Since #54
 * it defaults to `self`, and every dataset measure filters to `catalog` +
 * `assigned` (`src/datasets/governed.ts`) — so a governed duty that leaned on
 * the default would land unscored and take every dashboard measure to zero,
 * with nothing erroring anywhere, because an unscored duty is a perfectly
 * legal thing to be.
 *
 * Also here, by design:
 *  - **Two standing duties**, which never dispatch and therefore hold zero
 *    tasks. Not "no tasks yet" — `planForDuty` refuses them by form before it
 *    reads anything else, so the fixture cannot produce one.
 *  - **One paused duty**, which holds zero tasks for a different reason
 *    (`not_active`). Pausing stops the dispatcher; it does not hide the
 *    obligation, and the duty stays on screen.
 *  - **One one-off**, dispatched by hand rather than by the scheduler. Its
 *    single task is seeded directly in `task.seed.ts`.
 */

/** A self-declared duty has no catalog row behind it, so it carries its own cadence. */
const itemFor = (item: string | null, own: Partial<DemoCatalogItem> | undefined, name: string): DemoCatalogItem =>
  item !== null
    ? catalogItem(item)
    : ({ name, position: '', description: '', form: 'recurring', ...own } as DemoCatalogItem);

export const dutySeed = defineSeed(Duty, {
  externalId: 'name',
  mode: 'upsert',
  records: DUTIES.map((duty) => {
    const item = itemFor(duty.item, duty.own, duty.name);
    const unit = unitOf(duty.owner);
    return {
      name: duty.name,
      description: item.description,
      form: item.form,
      owner: duty.owner,
      business_unit: unit,
      source: duty.source,
      // Null for a self-declared duty: there is no catalog row to replay edits
      // from, which is exactly what distinguishes it.
      catalog_item: duty.item,
      // Periods are resolved in the DUTY's own zone, not the server's — a
      // global product cannot compute "the 5th of the month" without knowing
      // whose month. The Northgate units run on Europe/Berlin, so the seed
      // exercises the zone handling rather than leaving every row on UTC.
      timezone: timezoneOf(unit),
      status: duty.status ?? 'active',
      // The history this seed backfills starts here, so the duties say so.
      // Without it the effective window is open-ended and a later backfill
      // would happily invent obligations that predate the demo.
      effective_from: HISTORY_FROM,
      ...cadenceOf(item),
    };
  }),
});
