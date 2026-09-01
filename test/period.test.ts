// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { Duty } from '../src/objects/index.js';
import {
  FREQUENCIES,
  dueDateFor,
  periodBounds,
  periodKeyFor,
  periodsBetween,
  visibleFromFor,
  type Frequency,
} from '../src/functions/period.js';

/**
 * The period engine is the one module every other agent's work is written
 * against, so these tests pin the CONTRACT — key spelling, round-trip,
 * clamping, contiguity — not the implementation. A rewrite that keeps all of
 * these green is a legal rewrite.
 *
 * Dates are written as `Date.UTC(...)` instants and the zone is always passed
 * explicitly, so the suite gives the same answers on a laptop in Berlin and a
 * CI runner in UTC.
 */

const utc = (y: number, m: number, d: number, h = 12): Date => new Date(Date.UTC(y, m - 1, d, h));
const iso = (d: Date): string => d.toISOString();

/** The three zones the acceptance criteria name, plus what makes each interesting. */
const ZONES = [
  'UTC', // no offset, no DST — the control
  'Europe/Berlin', // +01/+02, spring-forward at 02:00 local
  'Asia/Shanghai', // +08 year round, and a day ahead of UTC for most of the UTC day
] as const;

// ─────────────────────────────────────────────────────────────────────────

describe('period key spelling — the contract other cards are written against', () => {
  const CASES: Array<{ frequency: Frequency; instant: Date; key: string }> = [
    { frequency: 'daily', instant: utc(2026, 8, 21), key: '2026-08-21' },
    { frequency: 'weekly', instant: utc(2026, 8, 21), key: '2026-W34' },
    { frequency: 'fortnightly', instant: utc(2026, 8, 21), key: '2026-W33' },
    { frequency: 'monthly', instant: utc(2026, 8, 21), key: '2026-08' },
    { frequency: 'quarterly', instant: utc(2026, 8, 21), key: '2026-Q3' },
    { frequency: 'semiannual', instant: utc(2026, 8, 21), key: '2026-H2' },
    { frequency: 'annual', instant: utc(2026, 8, 21), key: '2026' },
  ];

  it.each(CASES)('$frequency → $key', ({ frequency, instant, key }) => {
    expect(periodKeyFor(frequency, instant, 'UTC')).toBe(key);
  });

  it('pads the week number to two digits — 2026-W04, never 2026-W4', () => {
    expect(periodKeyFor('weekly', utc(2026, 1, 22), 'UTC')).toBe('2026-W04');
    expect(periodKeyFor('fortnightly', utc(2026, 1, 22), 'UTC')).toBe('2026-W03');
  });

  it('every key fits duly_task.period_key (maxLength 16)', () => {
    for (const frequency of FREQUENCIES) {
      for (const month of [1, 6, 12]) {
        expect(periodKeyFor(frequency, utc(2026, month, 15), 'UTC').length).toBeLessThanOrEqual(16);
      }
    }
  });

  it('the frequency vocabulary matches duly_duty.frequency', () => {
    const declared = (Duty.fields.frequency.options ?? []).map((o) => o.value);
    expect([...FREQUENCIES].sort()).toEqual([...declared].sort());
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('round-trip: periodKeyFor(f, periodBounds(f, k, tz).start, tz) === k', () => {
  // Instants chosen to land on the awkward days: year boundaries, both DST
  // transitions, month ends, a leap day, and an ordinary mid-year day.
  const PROBES: Date[] = [
    utc(2026, 1, 1, 0),
    utc(2026, 1, 1, 23),
    utc(2026, 3, 29, 1),
    utc(2026, 6, 15),
    utc(2026, 8, 31, 22),
    utc(2026, 10, 25, 1),
    utc(2026, 12, 31, 23),
    utc(2027, 1, 1, 0),
    utc(2028, 2, 29),
    utc(2020, 12, 31, 12),
  ];

  for (const zone of ZONES) {
    for (const frequency of FREQUENCIES) {
      it(`${frequency} in ${zone}`, () => {
        for (const probe of PROBES) {
          const key = periodKeyFor(frequency, probe, zone);
          const bounds = periodBounds(frequency, key, zone);
          expect(periodKeyFor(frequency, bounds.start, zone), `${key} from ${iso(probe)}`).toBe(key);

          // The probe must also fall inside the window it named: [start, end).
          expect(bounds.start.getTime(), `${key} start`).toBeLessThanOrEqual(probe.getTime());
          expect(bounds.end.getTime(), `${key} end`).toBeGreaterThan(probe.getTime());
        }
      });
    }
  }

  it('the last instant of a period belongs to that period, the first of the next does not', () => {
    const bounds = periodBounds('monthly', '2026-08', 'Europe/Berlin');
    const lastMoment = new Date(bounds.end.getTime() - 1);
    expect(periodKeyFor('monthly', lastMoment, 'Europe/Berlin')).toBe('2026-08');
    expect(periodKeyFor('monthly', bounds.end, 'Europe/Berlin')).toBe('2026-09');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('the zone decides the period, not the server', () => {
  it('one instant, two periods', () => {
    // 2026-08-31T20:00Z is still August in UTC and already September in Shanghai.
    const instant = new Date('2026-08-31T20:00:00Z');
    expect(periodKeyFor('monthly', instant, 'UTC')).toBe('2026-08');
    expect(periodKeyFor('monthly', instant, 'Asia/Shanghai')).toBe('2026-09');
    expect(periodKeyFor('daily', instant, 'UTC')).toBe('2026-08-31');
    expect(periodKeyFor('daily', instant, 'Asia/Shanghai')).toBe('2026-09-01');
  });

  it('bounds are the zone’s midnight, not UTC midnight', () => {
    expect(iso(periodBounds('daily', '2026-08-21', 'Asia/Shanghai').start)).toBe('2026-08-20T16:00:00.000Z');
    expect(iso(periodBounds('daily', '2026-08-21', 'Europe/Berlin').start)).toBe('2026-08-20T22:00:00.000Z');
    expect(iso(periodBounds('daily', '2026-08-21', 'UTC').start)).toBe('2026-08-21T00:00:00.000Z');
  });

  it('refuses a timezone the host does not know', () => {
    expect(() => periodKeyFor('daily', utc(2026, 8, 21), 'Europe/Atlantis')).toThrow(/Unknown IANA timezone/);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('ISO week-years are not calendar years', () => {
  it('2026-01-01 is 2026-W01 but 2027-01-01 is 2026-W53', () => {
    expect(periodKeyFor('weekly', utc(2026, 1, 1), 'UTC')).toBe('2026-W01');
    expect(periodKeyFor('weekly', utc(2027, 1, 1), 'UTC')).toBe('2026-W53');
  });

  it('2020 and 2026 have 53 ISO weeks; the neighbours have 52', () => {
    const weeksIn = (year: number): string => periodKeyFor('weekly', utc(year, 12, 28), 'UTC');
    expect(weeksIn(2020)).toBe('2020-W53');
    expect(weeksIn(2026)).toBe('2026-W53');
    expect(weeksIn(2019)).toBe('2019-W52');
    expect(weeksIn(2021)).toBe('2021-W52');
    expect(weeksIn(2027)).toBe('2027-W52');
  });

  it('W53 is a real week in a 53-week year and refused in a 52-week one', () => {
    expect(iso(periodBounds('weekly', '2020-W53', 'UTC').start)).toBe('2020-12-28T00:00:00.000Z');
    expect(iso(periodBounds('weekly', '2020-W53', 'UTC').end)).toBe('2021-01-04T00:00:00.000Z');
    expect(() => periodBounds('weekly', '2021-W53', 'UTC')).toThrow(/2021 has 52 weeks/);
  });

  it('a week key round-trips across the year boundary it straddles', () => {
    // 2026-W53 runs 28 Dec 2026 → 3 Jan 2027. Both halves must name it.
    expect(periodKeyFor('weekly', utc(2026, 12, 30), 'UTC')).toBe('2026-W53');
    expect(periodKeyFor('weekly', utc(2027, 1, 2), 'UTC')).toBe('2026-W53');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('fortnights are anchored so ISO week 1 begins one', () => {
  it('fortnights start on odd ISO weeks and are named by the starting week', () => {
    expect(periodKeyFor('fortnightly', utc(2026, 1, 1), 'UTC')).toBe('2026-W01'); // W01
    expect(periodKeyFor('fortnightly', utc(2026, 1, 8), 'UTC')).toBe('2026-W01'); // W02 → back half
    expect(periodKeyFor('fortnightly', utc(2026, 1, 15), 'UTC')).toBe('2026-W03'); // W03
    expect(periodKeyFor('fortnightly', utc(2026, 8, 21), 'UTC')).toBe('2026-W33'); // W34 → back half
  });

  it('an even week is refused as a fortnight key, with the fix named', () => {
    expect(() => periodBounds('fortnightly', '2026-W34', 'UTC')).toThrow(/Did you mean 2026-W33/);
  });

  it('a fortnight is 14 days', () => {
    const { start, end } = periodBounds('fortnightly', '2026-W33', 'UTC');
    expect((end.getTime() - start.getTime()) / 86_400_000).toBe(14);
  });

  /**
   * The one consequence of the anchoring rule worth stating out loud: in a
   * 53-week ISO year the last fortnight is ONE week long, because W01 of the
   * next week-year must itself begin a fortnight and so cannot be the back
   * half of this one. Forced by the rule, not chosen — the alternative (a
   * 14-day cycle running continuously across the boundary) would mean W01 did
   * not begin a fortnight in 2027, contradicting the contract.
   */
  it('the final fortnight of a 53-week year is one week long, and W01 still starts the next', () => {
    const last = periodBounds('fortnightly', '2026-W53', 'UTC');
    expect(iso(last.start)).toBe('2026-12-28T00:00:00.000Z');
    expect(iso(last.end)).toBe('2027-01-04T00:00:00.000Z');
    expect((last.end.getTime() - last.start.getTime()) / 86_400_000).toBe(7);

    const next = periodBounds('fortnightly', '2027-W01', 'UTC');
    expect(next.start.getTime()).toBe(last.end.getTime()); // contiguous
    expect((next.end.getTime() - next.start.getTime()) / 86_400_000).toBe(14);

    // …and both still round-trip.
    expect(periodKeyFor('fortnightly', last.start, 'UTC')).toBe('2026-W53');
    expect(periodKeyFor('fortnightly', next.start, 'UTC')).toBe('2027-W01');
  });

  it('2020 behaves the same way', () => {
    const last = periodBounds('fortnightly', '2020-W53', 'UTC');
    expect((last.end.getTime() - last.start.getTime()) / 86_400_000).toBe(7);
    expect(periodKeyFor('fortnightly', last.start, 'UTC')).toBe('2020-W53');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('DST — a day is not 24 hours and local midnight may not exist', () => {
  it('Europe/Berlin 2026-03-29 is a 23-hour day and still starts at midnight', () => {
    const { start, end } = periodBounds('daily', '2026-03-29', 'Europe/Berlin');
    expect(iso(start)).toBe('2026-03-28T23:00:00.000Z'); // 00:00 local
    expect(iso(end)).toBe('2026-03-29T22:00:00.000Z'); // 00:00 local next day
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
    expect(periodKeyFor('daily', start, 'Europe/Berlin')).toBe('2026-03-29');
  });

  it('Europe/Berlin autumn fall-back is a 25-hour day and starts at the FIRST midnight', () => {
    const { start, end } = periodBounds('daily', '2026-10-25', 'Europe/Berlin');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(25);
    expect(periodKeyFor('daily', start, 'Europe/Berlin')).toBe('2026-10-25');
  });

  /**
   * The trap this module was built around. Santiago shifts AT midnight, so
   * 2026-09-06 00:00 local never happens. The naive inversion
   * (`guess - offsetAt(guess - offsetAt(guess))`) settles on 2026-09-06T03:00Z,
   * whose local reading is 23:00 on the 5th — a whole period early. The right
   * answer resolves FORWARD to 01:00 local, the first instant of that day.
   */
  it('America/Santiago 2026-09-06 has no local midnight and resolves forward', () => {
    const { start, end } = periodBounds('daily', '2026-09-06', 'America/Santiago');
    expect(iso(start)).toBe('2026-09-06T04:00:00.000Z');
    expect(iso(end)).toBe('2026-09-07T03:00:00.000Z');
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);

    // Whatever it resolved to, it is the SAME local day — this is the assertion
    // that fails on the naive inversion.
    expect(periodKeyFor('daily', start, 'America/Santiago')).toBe('2026-09-06');
    expect(periodKeyFor('daily', new Date(start.getTime() - 1), 'America/Santiago')).toBe('2026-09-05');
  });

  it('the September period in Santiago is contiguous across the midnight shift', () => {
    const sept5 = periodBounds('daily', '2026-09-05', 'America/Santiago');
    const sept6 = periodBounds('daily', '2026-09-06', 'America/Santiago');
    expect(sept5.end.getTime()).toBe(sept6.start.getTime());
  });

  it('a longer period spanning a transition still starts and ends on local midnight', () => {
    const march = periodBounds('monthly', '2026-03', 'Europe/Berlin');
    expect(iso(march.start)).toBe('2026-02-28T23:00:00.000Z');
    expect(iso(march.end)).toBe('2026-03-31T22:00:00.000Z'); // CEST by then
    expect(periodKeyFor('monthly', march.start, 'Europe/Berlin')).toBe('2026-03');
  });

  /**
   * A local calendar day that the zone skipped entirely (Samoa jumped the
   * date line on 2011-12-30). The period is genuinely empty — `start === end`
   * — and the key is unreachable from any instant. Reporting an empty window
   * is the honest answer; inventing a 24-hour one would put a task in a period
   * that did not happen.
   */
  it('a skipped calendar day is an empty period, not a fabricated one', () => {
    const skipped = periodBounds('daily', '2011-12-30', 'Pacific/Apia');
    expect(skipped.start.getTime()).toBe(skipped.end.getTime());
    const before = periodBounds('daily', '2011-12-29', 'Pacific/Apia');
    const after = periodBounds('daily', '2011-12-31', 'Pacific/Apia');
    expect(before.end.getTime()).toBe(after.start.getTime()); // still contiguous

    // A backfill walks past it: every key `periodsBetween` returns is one
    // `periodKeyFor` could have returned, and no instant is on the 30th.
    expect(periodsBetween('daily', before.start, after.start, 'Pacific/Apia')).toEqual([
      '2011-12-29',
      '2011-12-31',
    ]);
    expect(periodKeyFor('daily', skipped.start, 'Pacific/Apia')).toBe('2011-12-31');
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('dueDateFor — offsets clamp into the period, never out of it', () => {
  const due = (
    frequency: Frequency,
    periodKey: string,
    dueAnchor: 'period_start' | 'period_end',
    dueOffsetDays: number,
    timezone = 'UTC',
  ): string => dueDateFor({ frequency, periodKey, timezone, dueAnchor, dueOffsetDays });

  it('offset 0 is the anchor day itself, on either anchor', () => {
    expect(due('monthly', '2026-08', 'period_start', 0)).toBe('2026-08-01');
    expect(due('monthly', '2026-08', 'period_end', 0)).toBe('2026-08-31');
    // The quarterly story from duly_duty: "due in Q3" is due on 30 September.
    expect(due('quarterly', '2026-Q3', 'period_end', 0)).toBe('2026-09-30');
    expect(due('annual', '2026', 'period_end', 0)).toBe('2026-12-31');
    expect(due('annual', '2026', 'period_start', 0)).toBe('2026-01-01');
  });

  it('a positive offset counts days forward from the period start', () => {
    expect(due('monthly', '2026-08', 'period_start', 4)).toBe('2026-08-05');
    expect(due('weekly', '2026-W34', 'period_start', 2)).toBe('2026-08-19'); // Mon 17th + 2
    expect(due('daily', '2026-08-21', 'period_start', 0)).toBe('2026-08-21');
  });

  /** The leap-year pair the acceptance criteria name. */
  it('month-end clamping: offset 30 on February is the 28th, or the 29th in a leap year', () => {
    expect(due('monthly', '2027-02', 'period_start', 30)).toBe('2027-02-28'); // not 2 March
    expect(due('monthly', '2028-02', 'period_start', 30)).toBe('2028-02-29'); // leap
    expect(due('monthly', '2026-04', 'period_start', 30)).toBe('2026-04-30'); // 30-day month
    expect(due('monthly', '2026-01', 'period_start', 30)).toBe('2026-01-31'); // 31-day month
  });

  it('negative offsets from period_end clamp at period_start', () => {
    expect(due('monthly', '2026-08', 'period_end', -5)).toBe('2026-08-26');
    expect(due('monthly', '2026-02', 'period_end', -90)).toBe('2026-02-01'); // clamped
    expect(due('daily', '2026-08-21', 'period_end', -3)).toBe('2026-08-21'); // a day cannot spill
  });

  it('a negative offset from period_start clamps at period_start too', () => {
    expect(due('monthly', '2026-08', 'period_start', -1)).toBe('2026-08-01');
  });

  it('a positive offset from period_end clamps at period_end', () => {
    expect(due('monthly', '2026-08', 'period_end', 10)).toBe('2026-08-31');
  });

  it('clamping holds for every frequency, on both anchors, with an absurd offset', () => {
    const KEYS: Array<[Frequency, string]> = [
      ['daily', '2026-08-21'],
      ['weekly', '2026-W34'],
      ['fortnightly', '2026-W33'],
      ['monthly', '2026-08'],
      ['quarterly', '2026-Q3'],
      ['semiannual', '2026-H2'],
      ['annual', '2026'],
    ];
    for (const [frequency, key] of KEYS) {
      const { start, end } = periodBounds(frequency, key, 'UTC');
      const firstDay = start.toISOString().slice(0, 10);
      const lastDay = new Date(end.getTime() - 86_400_000).toISOString().slice(0, 10);
      for (const [anchor, offset] of [
        ['period_start', 9_999],
        ['period_start', -9_999],
        ['period_end', 9_999],
        ['period_end', -9_999],
      ] as const) {
        const resolved = due(frequency, key, anchor, offset);
        expect(resolved >= firstDay, `${key} ${anchor}${offset} → ${resolved}`).toBe(true);
        expect(resolved <= lastDay, `${key} ${anchor}${offset} → ${resolved}`).toBe(true);
      }
    }
  });

  it('the due date is resolved in the duty’s zone, so the calendar day is the LOCAL one', () => {
    // The period key already carries the local calendar; the day is the same
    // string in every zone, which is what makes it storable in a `date` field.
    expect(due('monthly', '2026-08', 'period_end', 0, 'Asia/Shanghai')).toBe('2026-08-31');
    expect(due('monthly', '2026-08', 'period_end', 0, 'America/Santiago')).toBe('2026-08-31');
  });

  it('refuses a fractional offset rather than rounding it', () => {
    expect(() => due('monthly', '2026-08', 'period_start', 1.5)).toThrow(/whole number of days/);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('visibleFromFor', () => {
  it('subtracts lead days across month, year and leap-day boundaries', () => {
    expect(visibleFromFor('2026-08-05', 7)).toBe('2026-07-29');
    expect(visibleFromFor('2026-01-03', 7)).toBe('2025-12-27');
    expect(visibleFromFor('2028-03-01', 1)).toBe('2028-02-29');
    expect(visibleFromFor('2027-03-01', 1)).toBe('2027-02-28');
    expect(visibleFromFor('2026-08-05', 0)).toBe('2026-08-05');
  });

  it('deliberately does not clamp into the period — lead time reaches back', () => {
    const dueDate = dueDateFor({
      frequency: 'monthly',
      periodKey: '2026-08',
      timezone: 'UTC',
      dueAnchor: 'period_start',
      dueOffsetDays: 2,
    });
    expect(dueDate).toBe('2026-08-03');
    expect(visibleFromFor(dueDate, 7)).toBe('2026-07-27'); // previous month, on purpose
  });

  it('refuses a malformed date rather than guessing', () => {
    expect(() => visibleFromFor('2026-8-5', 7)).toThrow(/YYYY-MM-DD/);
    expect(() => visibleFromFor('2026-02-30', 7)).toThrow(/not a real calendar date/);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('periodsBetween — ascending, contiguous, no duplicates', () => {
  const FROM = utc(2026, 12, 20);
  const TO = utc(2027, 1, 10);

  const EXPECTED: Record<Frequency, string[]> = {
    daily: [], // checked by length + contiguity below
    weekly: ['2026-W51', '2026-W52', '2026-W53', '2027-W01'],
    fortnightly: ['2026-W51', '2026-W53', '2027-W01'],
    monthly: ['2026-12', '2027-01'],
    quarterly: ['2026-Q4', '2027-Q1'],
    semiannual: ['2026-H2', '2027-H1'],
    annual: ['2026', '2027'],
  };

  for (const frequency of FREQUENCIES) {
    it(`${frequency} over the 2026→2027 boundary`, () => {
      const keys = periodsBetween(frequency, FROM, TO, 'UTC');

      expect(new Set(keys).size, 'no duplicates').toBe(keys.length);
      expect(keys.length).toBeGreaterThan(0);

      // Ascending and contiguous: each period ends exactly where the next begins.
      for (let i = 1; i < keys.length; i += 1) {
        const prev = periodBounds(frequency, keys[i - 1]!, 'UTC');
        const next = periodBounds(frequency, keys[i]!, 'UTC');
        expect(next.start.getTime(), `${keys[i - 1]} → ${keys[i]} gap`).toBe(prev.end.getTime());
      }

      // Both endpoints are covered by the range they came from.
      const first = periodBounds(frequency, keys[0]!, 'UTC');
      const last = periodBounds(frequency, keys[keys.length - 1]!, 'UTC');
      expect(first.start.getTime()).toBeLessThanOrEqual(FROM.getTime());
      expect(last.end.getTime()).toBeGreaterThan(TO.getTime());

      if (EXPECTED[frequency].length > 0) expect(keys).toEqual(EXPECTED[frequency]);
    });
  }

  it('daily over the boundary is every day, inclusive of both ends', () => {
    const keys = periodsBetween('daily', FROM, TO, 'UTC');
    expect(keys[0]).toBe('2026-12-20');
    expect(keys[keys.length - 1]).toBe('2027-01-10');
    expect(keys.length).toBe(22);
  });

  it('the period containing `to` is included — a backfill must produce the period in flight', () => {
    const midAugust = utc(2026, 8, 15);
    expect(periodsBetween('monthly', midAugust, midAugust, 'UTC')).toEqual(['2026-08']);
  });

  it('an empty window is [] rather than a throw — a duty that starts tomorrow is normal', () => {
    expect(periodsBetween('monthly', utc(2026, 8, 15), utc(2026, 8, 14), 'UTC')).toEqual([]);
  });

  it('is contiguous across a DST transition, in local days', () => {
    const keys = periodsBetween('daily', utc(2026, 3, 27), utc(2026, 3, 31), 'Europe/Berlin');
    expect(keys).toEqual(['2026-03-27', '2026-03-28', '2026-03-29', '2026-03-30', '2026-03-31']);
    for (let i = 1; i < keys.length; i += 1) {
      const prev = periodBounds('daily', keys[i - 1]!, 'Europe/Berlin');
      const next = periodBounds('daily', keys[i]!, 'Europe/Berlin');
      expect(next.start.getTime()).toBe(prev.end.getTime());
    }
  });

  it('is resolved in the supplied zone', () => {
    // 2026-08-31T20:00Z is 1 September in Shanghai, so the walk reaches 2026-09.
    const from = new Date('2026-08-31T20:00:00Z');
    expect(periodsBetween('monthly', from, from, 'UTC')).toEqual(['2026-08']);
    expect(periodsBetween('monthly', from, from, 'Asia/Shanghai')).toEqual(['2026-09']);
  });
});

// ─────────────────────────────────────────────────────────────────────────

describe('malformed keys are refused, never repaired', () => {
  /**
   * `duly_task` is unique on `(duty, owner, period_key)`. Two spellings of one
   * period are two tasks for one obligation, and nothing downstream can tell
   * they were meant to be the same — so a near-miss key has to fail loudly at
   * the only place that can still see it is a near miss.
   */
  const BAD: Array<[Frequency, string, RegExp]> = [
    ['weekly', '2026-W4', /Malformed weekly period key/],
    ['weekly', '2026-34', /Malformed weekly period key/],
    ['weekly', '2026-W00', /ISO week 0/],
    ['weekly', '2026-W54', /ISO week 54/],
    ['monthly', '2026-8', /Malformed monthly period key/],
    ['monthly', '2026-13', /names month 13/],
    ['quarterly', '2026-Q5', /Malformed quarterly period key/],
    ['quarterly', '2026-3', /Malformed quarterly period key/],
    ['semiannual', '2026-H3', /Malformed semiannual period key/],
    ['annual', '26', /Malformed annual period key/],
    ['daily', '2026-02-30', /not a real calendar date/],
    ['daily', '2026-8-21', /Malformed daily period key/],
    ['fortnightly', '2026-W34', /always odd/],
  ];

  it.each(BAD)('%s rejects %s', (frequency, key, message) => {
    expect(() => periodBounds(frequency, key, 'UTC')).toThrow(message);
    expect(() =>
      dueDateFor({ frequency, periodKey: key, timezone: 'UTC', dueAnchor: 'period_start', dueOffsetDays: 0 }),
    ).toThrow(message);
  });

  it('refuses an unknown frequency and an invalid instant', () => {
    expect(() => periodKeyFor('fortnight' as Frequency, utc(2026, 8, 21), 'UTC')).toThrow(/Unknown frequency/);
    expect(() => periodKeyFor('daily', new Date('nope'), 'UTC')).toThrow(/must be a valid Date/);
    expect(() =>
      dueDateFor({
        frequency: 'monthly',
        periodKey: '2026-08',
        timezone: 'UTC',
        dueAnchor: 'end_of_period' as 'period_end',
        dueOffsetDays: 0,
      }),
    ).toThrow(/Unknown due anchor/);
  });

  it('refuses a year outside the Gregorian range the key spelling assumes', () => {
    expect(() => periodBounds('annual', '1234', 'UTC')).toThrow(/outside the supported range/);
  });
});
