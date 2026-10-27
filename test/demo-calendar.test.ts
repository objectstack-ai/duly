// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * The demo's lens floors, held on EVERY day of the coming year, not only on
 * the day CI happens to run (#149).
 *
 * `src/data/demo-history.ts` plans the whole demo from the wall clock, read
 * once when the module loads, so `test/seed.test.ts` checks the population of
 * one day: today. Its "My week" floor went red on 2026-10-27 with no commit
 * behind it. All of the admin's duties were between their lead windows at
 * once, and the same tree was green again two days later. A fixture that is
 * right on most days turns `main` red on the others.
 *
 * So this plans the fixture again for each of the next 366 days, with the
 * clock moved under it (`vi.setSystemTime`, then a fresh module graph so `NOW`
 * is read again), and counts the two lenses `seed.test.ts` holds to a floor,
 * with the same filters field for field:
 *
 *  - **My week** for the seeded admin: owned by them, open or in progress, and
 *    `visible_from` on or before today. At least 3.
 *  - **Late**: open or in progress, with `late_after` before today. 3 to 4.
 *
 * It reads the fixture arrays rather than a booted kernel, because a kernel
 * per day is a year of boots. That is sound because `seed.test.ts` pins the
 * loader to the fixture: every row lands with the values it was given, so the
 * arrays are what the views read.
 */

const DAY = 24 * 60 * 60 * 1000;
const DAYS = 366;
const IN_FLIGHT = ['open', 'in_progress'];

interface Lenses {
  today: string;
  myWeek: number;
  late: number;
}

/** The fixture as `pnpm dev` would seed it at `instant`. */
async function lensesAt(instant: number): Promise<Lenses> {
  vi.resetModules();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(instant);
  try {
    const { SEEDED_TASKS, TODAY } = await import('../src/data/demo-history.js');
    const { AD_HOC_TASKS } = await import('../src/data/demo-assignments.js');
    const { ADMIN } = await import('../src/data/demo-org.js');
    const rows = [
      ...SEEDED_TASKS.map((task) => ({
        owner: task.owner,
        status: task.status,
        visible_from: task.visible_from,
        late_after: task.late_after,
      })),
      // An ad-hoc row is seeded with no `late_after`. The task hook fills it
      // with the due date on insert (the zero-grace fallback in
      // `src/hooks/task.hook.ts`), so that is what the Late lens reads.
      ...AD_HOC_TASKS.map((task) => ({
        owner: task.owner,
        status: task.status,
        visible_from: task.visibleFrom,
        late_after: task.dueDate,
      })),
    ];
    const inFlight = rows.filter((row) => IN_FLIGHT.includes(row.status));
    return {
      today: TODAY,
      myWeek: inFlight.filter((row) => row.owner === ADMIN && row.visible_from <= TODAY).length,
      late: inFlight.filter((row) => row.late_after && row.late_after < TODAY).length,
    };
  } finally {
    vi.useRealTimers();
  }
}

const listed = (days: readonly Lenses[], lens: 'myWeek' | 'late'): string[] =>
  days.map((day) => `${day.today}: ${day[lens]}`);

describe('the demo holds its lens floors on every day of the next year', () => {
  const days: Lenses[] = [];

  beforeAll(async () => {
    const start = Date.now();
    for (let offset = 0; offset < DAYS; offset++) days.push(await lensesAt(start + offset * DAY));
  }, 180_000);

  it('really moved the clock: one planned fixture per civil day, 366 of them', () => {
    // Without this, a module cache that survived `resetModules` would plan
    // every "day" as today, and the two assertions below would pass on any
    // day that is green, which is exactly the blind spot this file closes.
    expect(new Set(days.map((day) => day.today)).size).toBe(DAYS);
  });

  it('My week has at least 3 rows for the seeded admin on every day', () => {
    const thin = days.filter((day) => day.myWeek < 3);
    expect(listed(thin, 'myWeek'), 'days on which the admin opens a My week with fewer than 3 rows').toEqual([]);
  });

  it('Late has 3-4 rows on every day', () => {
    const off = days.filter((day) => day.late < 3 || day.late > 4);
    expect(listed(off, 'late'), 'days on which Late is outside 3-4').toEqual([]);
  });
});
