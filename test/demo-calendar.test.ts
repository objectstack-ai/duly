// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The demo's floors and ranges, held on EVERY day of the coming year, not
 * only on the day CI happens to run (#149, #150).
 *
 * `src/data/demo-history.ts` plans the whole demo from the wall clock, read
 * once when the module loads, so `test/seed.test.ts` checks the population of
 * one day: today. Its "My week" floor went red on 2026-10-27 with no commit
 * behind it. All of the admin's duties were between their lead windows at
 * once, and the same tree was green again two days later. "Not moving" and
 * "stalled but not late" had the same defect on other days. A fixture that is
 * right on most days turns `main` red on the others.
 *
 * So this plans the fixture again for each of the next 366 days, with the
 * clock moved under it (`vi.setSystemTime`, then a fresh module graph so `NOW`
 * is read again), and counts every task population `seed.test.ts` holds to a
 * floor or a range, with the same filter and the same bound. {@link LENSES}
 * names the assertion each one mirrors.
 *
 * It reads the fixture arrays rather than a booted kernel, because a kernel
 * per day is a year of boots. That is sound because `seed.test.ts` pins the
 * loader to the fixture: every row lands with the values it was given, so the
 * arrays are what the views read. Where the database holds a value the
 * fixture does not write, the row below carries what the task hook stamps on
 * insert, and says so.
 */

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 366;
const IN_FLIGHT = ['open', 'in_progress'];
const BOARD_COLUMNS = ['cancelled', 'done', 'in_progress', 'open', 'skipped'];

/** A `duly_task` row as it reads back after the seed. */
interface Row {
  owner: string;
  business_unit: string | null;
  source: string;
  status: string;
  period_key?: string;
  due_date?: string;
  visible_from?: string;
  late_after?: string;
  completed_at?: string;
  last_update_at: string;
  /**
   * The hook's on-time verdict, `completed_at`'s civil day past `late_after`'s.
   * The seed never writes it; `beforeInsert` in `src/hooks/task.hook.ts`
   * stamps it on every row inserted done.
   */
  completed_late: boolean;
}

interface Day {
  instant: number;
  today: string;
  admin: string;
  rows: readonly Row[];
}

interface Lens {
  /** The population, and the `seed.test.ts` assertion it mirrors. */
  name: string;
  bound: string;
  count: (day: Day) => number;
  holds: (count: number) => boolean;
}

const inFlight = (row: Row) => IN_FLIGHT.includes(row.status);
const stalled = (day: Day) => (row: Row) =>
  inFlight(row) && new Date(row.last_update_at).getTime() < day.instant - 14 * DAY;
const done = (day: Day) => day.rows.filter((row) => row.status === 'done');

const LENSES: readonly Lens[] = [
  {
    name: 'My week for the seeded admin ("My week is not empty for the account you log in as")',
    bound: 'at least 3',
    count: (day) =>
      day.rows.filter((row) => row.owner === day.admin && inFlight(row) && String(row.visible_from) <= day.today).length,
    holds: (count) => count >= 3,
  },
  {
    name: 'Late ("Late has 3-4 rows, as the card asks")',
    bound: '3 to 4',
    count: (day) => day.rows.filter((row) => row.late_after && row.late_after < day.today && inFlight(row)).length,
    holds: (count) => count >= 3 && count <= 4,
  },
  {
    name: 'Not moving ("Not moving has 2-3 rows", and the replay\'s "at least 2")',
    bound: '2 to 3',
    count: (day) => day.rows.filter(stalled(day)).length,
    holds: (count) => count >= 2 && count <= 3,
  },
  {
    name: 'stalled but not late ("stagnation is NOT lateness")',
    bound: 'at least 1',
    count: (day) => day.rows.filter((row) => stalled(day)(row) && String(row.late_after) >= day.today).length,
    holds: (count) => count >= 1,
  },
  {
    name: 'tasks with a deadline that carries grace ("every seeded task carries the deadline it was dispatched with")',
    bound: 'more than 20',
    count: (day) => day.rows.filter((row) => row.due_date && String(row.late_after) > row.due_date).length,
    holds: (count) => count > 20,
  },
  {
    name: 'tasks the Calendar and the Schedule draw ("Calendar, Schedule and Board all have something to draw")',
    bound: 'more than 100',
    count: (day) => day.rows.filter((row) => row.visible_from && row.due_date).length,
    holds: (count) => count > 100,
  },
  {
    name: 'Board columns with cards ("Calendar, Schedule and Board all have something to draw")',
    bound: 'all 5',
    count: (day) => BOARD_COLUMNS.filter((status) => day.rows.some((row) => row.status === status)).length,
    holds: (count) => count === BOARD_COLUMNS.length,
  },
  {
    name: 'done tasks ("every done task carries the completion instant the seed supplied")',
    bound: 'more than 100',
    count: (day) => done(day).length,
    holds: (count) => count > 100,
  },
  {
    name: 'done tasks completed late ("the on-time rate the dashboard reads is a real number")',
    bound: 'at least 1',
    count: (day) => done(day).filter((row) => row.completed_late).length,
    holds: (count) => count > 0,
  },
  {
    name: 'share of done tasks completed late ("the on-time rate the dashboard reads is a real number")',
    bound: 'under 0.5',
    count: (day) => done(day).filter((row) => row.completed_late).length / done(day).length,
    holds: (share) => share < 0.5,
  },
  {
    name: 'share of tasks that are done ("the majority of history is done")',
    bound: 'over 0.5 and under 0.95',
    count: (day) => done(day).length / day.rows.length,
    holds: (share) => share > 0.5 && share < 0.95,
  },
  {
    name: 'skipped tasks ("one task is skipped, and it says why")',
    bound: 'exactly 1',
    count: (day) => day.rows.filter((row) => row.status === 'skipped').length,
    holds: (count) => count === 1,
  },
  {
    name: 'days back to the oldest completion ("history should reach back months")',
    bound: 'more than 120',
    count: (day) =>
      (day.instant - Math.min(...done(day).map((row) => new Date(String(row.completed_at)).getTime()))) / DAY,
    holds: (days) => days > 120,
  },
  {
    name: 'business units carrying work ("unit rollups differ from each other")',
    bound: 'at least 3',
    count: (day) => new Set(day.rows.map((row) => String(row.business_unit ?? ''))).size,
    holds: (count) => count >= 3,
  },
  {
    name: 'distinct unit totals ("unit rollups differ from each other")',
    bound: 'more than 1',
    count: (day) => {
      const byUnit = new Map<string, number>();
      for (const row of day.rows) {
        const unit = String(row.business_unit ?? '');
        byUnit.set(unit, (byUnit.get(unit) ?? 0) + 1);
      }
      return new Set(byUnit.values()).size;
    },
    holds: (count) => count > 1,
  },
  {
    name: 'governed tasks ("every task states its caliber explicitly")',
    bound: 'more than 100',
    count: (day) => day.rows.filter((row) => row.source === 'catalog' || row.source === 'assigned').length,
    holds: (count) => count > 100,
  },
  {
    name: 'self-declared tasks ("every task states its caliber explicitly")',
    bound: 'at least 1',
    count: (day) => day.rows.filter((row) => row.source === 'self').length,
    holds: (count) => count > 0,
  },
  {
    name: 'tasks with a period key ("every seeded key round-trips through periodKeyFor")',
    bound: 'more than 100',
    count: (day) => day.rows.filter((row) => row.period_key).length,
    holds: (count) => count > 100,
  },
];

/** The civil day of an ISO date or instant, the comparison the hook's verdict makes. */
const dayOf = (value: string | undefined): string => (value ?? '').slice(0, 10);
const lateVerdict = (completedAt: string | undefined, lateAfter: string | undefined): boolean =>
  dayOf(completedAt) !== '' && dayOf(lateAfter) !== '' && dayOf(completedAt) > dayOf(lateAfter);

/** The fixture as `pnpm dev` would seed it at `instant`. */
async function plannedAt(instant: number): Promise<Day> {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  try {
    const { SEEDED_TASKS, TODAY } = await import('../src/data/demo-history.js');
    const { AD_HOC_TASKS } = await import('../src/data/demo-assignments.js');
    const { ADMIN, unitOf } = await import('../src/data/demo-org.js');
    const rows: Row[] = [
      ...SEEDED_TASKS.map((task) => ({
        owner: task.owner,
        business_unit: task.business_unit,
        source: task.source,
        status: task.status,
        period_key: task.period_key,
        due_date: task.due_date,
        visible_from: task.visible_from,
        late_after: task.late_after,
        completed_at: task.completed_at,
        last_update_at: task.last_update_at,
        completed_late: task.status === 'done' && lateVerdict(task.completed_at, task.late_after),
      })),
      // An ad-hoc row is seeded with no `late_after`. The hook fills it with
      // the due date on insert (the zero-grace fallback), so that is what the
      // lenses read. Its unit is the one `task.seed.ts` writes.
      ...AD_HOC_TASKS.map((task) => ({
        owner: task.owner,
        business_unit: unitOf(task.owner),
        source: task.source,
        status: task.status,
        due_date: task.dueDate,
        visible_from: task.visibleFrom,
        late_after: task.dueDate,
        completed_at: task.completedAt,
        last_update_at: task.lastUpdateAt,
        completed_late: task.status === 'done' && lateVerdict(task.completedAt, task.dueDate),
      })),
    ];
    return { instant, today: TODAY, admin: ADMIN, rows };
  } finally {
    vi.useRealTimers();
  }
}

describe('the demo holds every seed.test.ts floor on every day of the next year', () => {
  const days: Day[] = [];

  beforeAll(async () => {
    const start = Date.now();
    for (let offset = 0; offset < DAYS; offset++) days.push(await plannedAt(start + offset * DAY));
  }, 180_000);

  it('really moved the clock: one planned fixture per civil day, 366 of them', () => {
    // Without this, a module cache that survived `resetModules` would plan
    // every "day" as today, and the assertions below would pass on any day
    // that is green, which is exactly the blind spot this file closes.
    expect(new Set(days.map((day) => day.today)).size).toBe(DAYS);
  });

  for (const lens of LENSES) {
    it(`${lens.name} is ${lens.bound} on every day`, () => {
      const off = days
        .map((day) => ({ today: day.today, count: lens.count(day) }))
        .filter((day) => !lens.holds(day.count))
        .map((day) => `${day.today}: ${day.count}`);
      expect(off, `days on which ${lens.name} is not ${lens.bound}`).toEqual([]);
    });
  }
});
