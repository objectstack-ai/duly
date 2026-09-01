// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The period engine — the one module that owns what a period IS.
 *
 * Everything downstream (the dispatcher, the backfill, the seed, every view
 * that groups by period) agrees on periods only because it agrees on this
 * file. Pure functions: no I/O, no clock, no platform imports.
 *
 * ── Why calendar parts and not milliseconds ──────────────────────────────
 * A day is not 24 hours and a local midnight is not guaranteed to exist. Every
 * boundary here is computed on CALENDAR PARTS in the supplied IANA zone and
 * converted to an instant exactly once, at the end. The alternative — take a
 * UTC instant and add 86_400_000 — is correct for about 363 days a year, which
 * is the worst possible failure rate: too rare to catch in review, frequent
 * enough that every organisation hits it twice a year.
 *
 * Two named hazards this file is built around, both verified against the
 * host's tzdata in `test/period.test.ts`:
 *
 *   - `Europe/Berlin` 2026-03-29 — the clock jumps 02:00 → 03:00, so the wall
 *     time 02:00 has no instant at all that day.
 *   - `America/Santiago` 2026-09-06 — the shift happens AT midnight, so the
 *     wall time 00:00 has no instant. The naive two-pass inversion
 *     (`guess - offsetAt(guess - offsetAt(guess))`) does not merely round here:
 *     it converges on 2026-09-06T03:00Z, whose local time is 23:00 on
 *     September **5th** — the previous period. That is why
 *     {@link instantFromWall} verifies its answer instead of trusting the
 *     second pass.
 *
 * ── No date library ──────────────────────────────────────────────────────
 * `Intl.DateTimeFormat` with a `timeZone` supplies the local parts and, by
 * comparing those parts against the instant, the zone's offset at that instant.
 * That is everything the arithmetic below needs, so this file adds no runtime
 * dependency.
 */

// ─────────────────────────────────────────────────────────────────────────
// Vocabulary
// ─────────────────────────────────────────────────────────────────────────

/**
 * The cadences a recurring duty can hold. Same spelling as
 * `duly_duty.frequency`'s option values — a mismatch here would type-check and
 * then fail at run time on real metadata.
 */
export const FREQUENCIES = [
  'daily',
  'weekly',
  'fortnightly',
  'monthly',
  'quarterly',
  'semiannual',
  'annual',
] as const;

export type Frequency = (typeof FREQUENCIES)[number];

/** Which end of the period `dueOffsetDays` counts from. */
export type DueAnchor = 'period_start' | 'period_end';

export interface PeriodBounds {
  /** First instant of the period. */
  start: Date;
  /** First instant of the NEXT period — the window is `[start, end)`. */
  end: Date;
}

export interface DueDateInput {
  frequency: Frequency;
  periodKey: string;
  timezone: string;
  dueAnchor: DueAnchor;
  dueOffsetDays: number;
}

/**
 * Keys are stored in `duly_task.period_key` / `duly_duty.last_dispatched_period`,
 * both `maxLength: 16`. The longest key this module can produce is `YYYY-MM-DD`
 * (10), so the guard has headroom; it exists to turn a future spelling change
 * into a loud failure here rather than a silent truncation in the database.
 */
const PERIOD_KEY_MAX_LENGTH = 16;

/**
 * Calendar years this module will accept or emit. The lower bound is the start
 * of the Gregorian calendar (before it, "the 5th of the month" does not mean
 * what anyone thinks it means); the upper bound keeps every key's year exactly
 * four digits, which is what the key spellings and `maxLength` assume.
 */
const MIN_YEAR = 1583;
const MAX_YEAR = 9999;

// ─────────────────────────────────────────────────────────────────────────
// Civil dates — a calendar with no zone and no time of day
// ─────────────────────────────────────────────────────────────────────────

/**
 * A local calendar day. Deliberately NOT a `Date`: half the bugs this module
 * exists to prevent come from a value that looks like a day but is really an
 * instant, and so silently carries a zone with it.
 */
interface CivilDate {
  year: number;
  /** 1-12. */
  month: number;
  /** 1-31. */
  day: number;
}

/**
 * Days since the epoch for a civil date.
 *
 * `Date.UTC` is used here purely as Gregorian calendar arithmetic — UTC has no
 * DST, so this is exact day counting, not a timezone conversion.
 */
function civilToEpochDay(date: CivilDate): number {
  return Date.UTC(date.year, date.month - 1, date.day) / 86_400_000;
}

function epochDayToCivil(epochDay: number): CivilDate {
  const d = new Date(epochDay * 86_400_000);
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() };
}

function addDays(date: CivilDate, days: number): CivilDate {
  return epochDayToCivil(civilToEpochDay(date) + days);
}

function compareCivil(a: CivilDate, b: CivilDate): number {
  return civilToEpochDay(a) - civilToEpochDay(b);
}

/** Length of a calendar month — the leap-year rule, asked once, in one place. */
function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** `YYYY-MM-DD`, the spelling `duly_task.due_date` (a `date` field) stores. */
function formatCivil(date: CivilDate): string {
  return `${String(date.year).padStart(4, '0')}-${pad2(date.month)}-${pad2(date.day)}`;
}

const CIVIL_DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

function parseCivil(value: string, what: string): CivilDate {
  const match = CIVIL_DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`${what} must be a YYYY-MM-DD calendar date, received ${JSON.stringify(value)}`);
  }
  const [, y, m, d] = match;
  const date = { year: Number(y), month: Number(m), day: Number(d) };
  assertYearInRange(date.year, what);
  if (date.month < 1 || date.month > 12 || date.day < 1 || date.day > daysInMonth(date.year, date.month)) {
    throw new RangeError(`${what} is not a real calendar date: ${JSON.stringify(value)}`);
  }
  return date;
}

function assertYearInRange(year: number, what: string): void {
  if (year < MIN_YEAR || year > MAX_YEAR) {
    throw new RangeError(`${what} year ${year} is outside the supported range ${MIN_YEAR}-${MAX_YEAR}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Zone plumbing — local parts in, instants out
// ─────────────────────────────────────────────────────────────────────────

/** A local wall-clock reading: a civil date plus a time of day. */
interface WallTime extends CivilDate {
  hour: number;
  minute: number;
  second: number;
}

/**
 * `Intl.DateTimeFormat` construction is the expensive part of every call
 * below, and the dispatcher runs this per duty per period. One formatter per
 * zone, built once.
 */
const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timezone: string): Intl.DateTimeFormat {
  const cached = formatterCache.get(timezone);
  if (cached) return cached;
  let formatter: Intl.DateTimeFormat;
  try {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone: timezone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      // `hour12: false` still renders midnight as hour 24 under some ICU
      // builds. `h23` is the spelling that always yields 00-23.
      hourCycle: 'h23',
      era: 'short',
    });
  } catch {
    throw new RangeError(`Unknown IANA timezone: ${JSON.stringify(timezone)}`);
  }
  formatterCache.set(timezone, formatter);
  return formatter;
}

/** The wall-clock reading a zone shows at an instant. */
function wallTimeAt(instant: Date, timezone: string): WallTime {
  const parts = formatterFor(timezone).formatToParts(instant);
  const found: Record<string, string> = {};
  for (const part of parts) {
    if (part.type !== 'literal') found[part.type] = part.value;
  }
  if (found.era === 'B') {
    // Only reachable via a Date far outside MIN_YEAR..MAX_YEAR. Refuse rather
    // than emit a key whose year silently means something else.
    throw new RangeError('Instants before the common era are not supported');
  }
  return {
    year: Number(found.year),
    month: Number(found.month),
    day: Number(found.day),
    hour: Number(found.hour),
    minute: Number(found.minute),
    second: Number(found.second),
  };
}

/** The zone's UTC offset, in milliseconds, at a given instant. */
function offsetMsAt(instant: Date, timezone: string): number {
  const wall = wallTimeAt(instant, timezone);
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  return asIfUtc - instant.getTime();
}

/** Wall times as one comparable number, so "is this reading later than that one" is exact. */
function wallOrdinal(wall: WallTime): number {
  return (
    civilToEpochDay(wall) * 86_400 + wall.hour * 3_600 + wall.minute * 60 + wall.second
  );
}

/**
 * The instant at which a zone's clock reads `wall`.
 *
 * Three cases, and the two interesting ones are the reason this is not a
 * one-liner:
 *
 *   - **Normal.** Exactly one instant matches.
 *   - **Ambiguous** (clocks went back — that wall time happens twice). Returns
 *     the FIRST occurrence, so a period starts when its first midnight starts,
 *     not an hour into itself.
 *   - **Nonexistent** (clocks went forward — that wall time never happens).
 *     Resolves FORWARD to the first instant whose local reading is past the
 *     requested one, i.e. the transition itself. A period whose first local
 *     moment was skipped begins at the moment the zone resumed.
 *
 * Candidates come from the offsets a day either side of the target, which
 * brackets every transition in tzdata; the answer is then VERIFIED against the
 * zone rather than assumed, because on a midnight shift the unverified answer
 * lands in the previous day (see the file header).
 */
function instantFromWall(wall: WallTime, timezone: string): Date {
  const asIfUtc = Date.UTC(wall.year, wall.month - 1, wall.day, wall.hour, wall.minute, wall.second);
  const probes = [asIfUtc - 86_400_000, asIfUtc, asIfUtc + 86_400_000];

  const candidates = new Set<number>();
  for (const probe of probes) {
    candidates.add(asIfUtc - offsetMsAt(new Date(probe), timezone));
  }

  const wanted = wallOrdinal(wall);
  let earliestExact: number | undefined;
  let earliestAfter: number | undefined;

  for (const candidate of [...candidates].sort((a, b) => a - b)) {
    const actual = wallOrdinal(wallTimeAt(new Date(candidate), timezone));
    if (actual === wanted) {
      earliestExact ??= candidate;
    } else if (actual > wanted) {
      earliestAfter ??= candidate;
    }
  }

  if (earliestExact !== undefined) return new Date(earliestExact);
  if (earliestAfter !== undefined) return new Date(earliestAfter);
  // Unreachable for any zone in tzdata: at least one candidate is always at or
  // past the requested reading. Fail loudly rather than return a wrong instant.
  throw new RangeError(
    `Could not resolve ${formatCivil(wall)} ${pad2(wall.hour)}:${pad2(wall.minute)} in ${timezone}`,
  );
}

/** The first instant of a local calendar day — midnight, or the first moment that exists after it. */
function startOfLocalDay(date: CivilDate, timezone: string): Date {
  return instantFromWall({ ...date, hour: 0, minute: 0, second: 0 }, timezone);
}

/** The local calendar day a zone is on at an instant. */
function localDayOf(instant: Date, timezone: string): CivilDate {
  const wall = wallTimeAt(instant, timezone);
  return { year: wall.year, month: wall.month, day: wall.day };
}

// ─────────────────────────────────────────────────────────────────────────
// ISO-8601 weeks
// ─────────────────────────────────────────────────────────────────────────
//
// The week-year in a `YYYY-Www` key is the ISO WEEK-YEAR, which is not the
// calendar year: 2027-01-01 belongs to `2026-W53`, and 2026-01-01 belongs to
// `2026-W01`. Getting this wrong does not throw — it files a task under a key
// nobody queries.

/** ISO weekday, Monday = 1 … Sunday = 7. */
function isoWeekday(date: CivilDate): number {
  const utcDow = new Date(Date.UTC(date.year, date.month - 1, date.day)).getUTCDay();
  return utcDow === 0 ? 7 : utcDow;
}

/** The Monday of the ISO week containing `date`. */
function isoWeekStart(date: CivilDate): CivilDate {
  return addDays(date, 1 - isoWeekday(date));
}

/**
 * The Monday on which ISO week 1 of `weekYear` begins — the week containing
 * 4 January, which is the ISO rule stated the short way.
 */
function isoWeekOneStart(weekYear: number): CivilDate {
  return isoWeekStart({ year: weekYear, month: 1, day: 4 });
}

/** The ISO week-year and week number of a civil date. */
function isoWeekOf(date: CivilDate): { weekYear: number; week: number } {
  // The Thursday of a week always falls in that week's ISO year — the whole
  // algorithm in one sentence.
  const thursday = addDays(isoWeekStart(date), 3);
  const weekYear = thursday.year;
  const week = Math.round((civilToEpochDay(isoWeekStart(date)) - civilToEpochDay(isoWeekOneStart(weekYear))) / 7) + 1;
  return { weekYear, week };
}

/**
 * 52 or 53. December 28 is always in the last ISO week of its week-year, which
 * is the cheapest correct way to ask.
 */
function isoWeeksInYear(weekYear: number): number {
  return isoWeekOf({ year: weekYear, month: 12, day: 28 }).week;
}

// ─────────────────────────────────────────────────────────────────────────
// Period shapes — one place per frequency, in local calendar days
// ─────────────────────────────────────────────────────────────────────────

const KEY_PATTERNS: Record<Frequency, RegExp> = {
  daily: /^(\d{4})-(\d{2})-(\d{2})$/,
  weekly: /^(\d{4})-W(\d{2})$/,
  fortnightly: /^(\d{4})-W(\d{2})$/,
  monthly: /^(\d{4})-(\d{2})$/,
  quarterly: /^(\d{4})-Q([1-4])$/,
  semiannual: /^(\d{4})-H([1-2])$/,
  annual: /^(\d{4})$/,
};

const KEY_SHAPES: Record<Frequency, string> = {
  daily: 'YYYY-MM-DD',
  weekly: 'YYYY-Www',
  fortnightly: 'YYYY-Www (odd ISO week)',
  monthly: 'YYYY-MM',
  quarterly: 'YYYY-Qn',
  semiannual: 'YYYY-Hn',
  annual: 'YYYY',
};

function assertFrequency(frequency: Frequency): void {
  if (!FREQUENCIES.includes(frequency)) {
    throw new RangeError(
      `Unknown frequency ${JSON.stringify(frequency)}; expected one of ${FREQUENCIES.join(', ')}`,
    );
  }
}

/**
 * The first local calendar day of the period that contains `date`.
 *
 * ── Fortnights ───────────────────────────────────────────────────────────
 * Anchored so that ISO week 1 of every week-year begins a fortnight, per the
 * spelling contract. Fortnights therefore start on ODD ISO weeks and are named
 * by their starting week. The consequence, in a 53-week week-year (2020, 2026,
 * 2032…): W53 is a ONE-week fortnight, because W01 of the next week-year must
 * begin a fortnight and cannot also be the back half of this one. That is
 * forced by the anchoring rule, not chosen here — the alternative (a 14-day
 * cycle running continuously across the year boundary) contradicts "ISO week 1
 * begins one" in exactly those years. Periods stay contiguous either way: no
 * gaps, no overlaps, and the key still round-trips.
 */
function periodStartOf(frequency: Frequency, date: CivilDate): CivilDate {
  switch (frequency) {
    case 'daily':
      return date;
    case 'weekly':
      return isoWeekStart(date);
    case 'fortnightly': {
      const { weekYear, week } = isoWeekOf(date);
      const startWeek = week % 2 === 1 ? week : week - 1;
      return addDays(isoWeekOneStart(weekYear), (startWeek - 1) * 7);
    }
    case 'monthly':
      return { year: date.year, month: date.month, day: 1 };
    case 'quarterly':
      return { year: date.year, month: Math.floor((date.month - 1) / 3) * 3 + 1, day: 1 };
    case 'semiannual':
      return { year: date.year, month: date.month <= 6 ? 1 : 7, day: 1 };
    case 'annual':
      return { year: date.year, month: 1, day: 1 };
  }
}

/** The first local calendar day of the period AFTER the one starting at `start`. */
function nextPeriodStart(frequency: Frequency, start: CivilDate): CivilDate {
  switch (frequency) {
    case 'daily':
      return addDays(start, 1);
    case 'weekly':
      return addDays(start, 7);
    case 'fortnightly': {
      const { weekYear, week } = isoWeekOf(start);
      // A fortnight that would run past the end of its week-year stops at the
      // year boundary, because W01 of the next week-year begins a fortnight.
      const span = week + 1 <= isoWeeksInYear(weekYear) ? 14 : 7;
      return addDays(start, span);
    }
    case 'monthly':
      return start.month === 12
        ? { year: start.year + 1, month: 1, day: 1 }
        : { year: start.year, month: start.month + 1, day: 1 };
    case 'quarterly':
      return start.month === 10
        ? { year: start.year + 1, month: 1, day: 1 }
        : { year: start.year, month: start.month + 3, day: 1 };
    case 'semiannual':
      return start.month === 7
        ? { year: start.year + 1, month: 1, day: 1 }
        : { year: start.year, month: 7, day: 1 };
    case 'annual':
      return { year: start.year + 1, month: 1, day: 1 };
  }
}

/** The key naming the period that contains `date`. */
function keyOf(frequency: Frequency, date: CivilDate): string {
  switch (frequency) {
    case 'daily':
      assertYearInRange(date.year, 'period');
      return formatCivil(date);
    case 'weekly':
    case 'fortnightly': {
      const { weekYear, week } = isoWeekOf(periodStartOf(frequency, date));
      assertYearInRange(weekYear, 'period');
      return `${weekYear}-W${pad2(week)}`;
    }
    case 'monthly':
      assertYearInRange(date.year, 'period');
      return `${date.year}-${pad2(date.month)}`;
    case 'quarterly':
      assertYearInRange(date.year, 'period');
      return `${date.year}-Q${Math.floor((date.month - 1) / 3) + 1}`;
    case 'semiannual':
      assertYearInRange(date.year, 'period');
      return `${date.year}-H${date.month <= 6 ? 1 : 2}`;
    case 'annual':
      assertYearInRange(date.year, 'period');
      return String(date.year);
  }
}

/**
 * The first local calendar day of the period a key names.
 *
 * Strict: a key that is merely close (`2026-W4`, `2026-Q5`, `2026-W54`, an even
 * week for a fortnight) is REFUSED, not repaired. A tolerant parser here would
 * be the single most expensive kindness in the product — `duly_task` is unique
 * on `(duty, owner, period_key)`, so two spellings of one period are two tasks
 * for one obligation, and nothing downstream can tell they were meant to be
 * the same.
 */
function startOfKey(frequency: Frequency, periodKey: string): CivilDate {
  assertFrequency(frequency);
  if (typeof periodKey !== 'string') {
    throw new RangeError(`Period key must be a string, received ${typeof periodKey}`);
  }
  const match = KEY_PATTERNS[frequency].exec(periodKey);
  if (!match) {
    throw new RangeError(
      `Malformed ${frequency} period key ${JSON.stringify(periodKey)}; expected ${KEY_SHAPES[frequency]}`,
    );
  }
  const year = Number(match[1]);
  assertYearInRange(year, 'period key');

  switch (frequency) {
    case 'daily':
      return parseCivil(periodKey, 'period key');
    case 'weekly':
    case 'fortnightly': {
      const week = Number(match[2]);
      const weeks = isoWeeksInYear(year);
      if (week < 1 || week > weeks) {
        throw new RangeError(
          `Period key ${JSON.stringify(periodKey)} names ISO week ${week}, but ${year} has ${weeks} weeks`,
        );
      }
      if (frequency === 'fortnightly' && week % 2 === 0) {
        throw new RangeError(
          `Fortnight keys name the STARTING ISO week, which is always odd; ` +
            `${JSON.stringify(periodKey)} names week ${week}. Did you mean ${year}-W${pad2(week - 1)}?`,
        );
      }
      return addDays(isoWeekOneStart(year), (week - 1) * 7);
    }
    case 'monthly': {
      const month = Number(match[2]);
      if (month < 1 || month > 12) {
        throw new RangeError(`Period key ${JSON.stringify(periodKey)} names month ${month}`);
      }
      return { year, month, day: 1 };
    }
    case 'quarterly':
      return { year, month: (Number(match[2]) - 1) * 3 + 1, day: 1 };
    case 'semiannual':
      return { year, month: Number(match[2]) === 1 ? 1 : 7, day: 1 };
    case 'annual':
      return { year, month: 1, day: 1 };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────────────────────────────────

/**
 * The key of the period containing `instant`, resolved in `timezone`.
 *
 * The zone is not a formatting detail: at 2026-09-01T04:00Z a duty in
 * `Asia/Shanghai` is already in September while one in `UTC` is still in
 * August, and both are right.
 */
export function periodKeyFor(frequency: Frequency, instant: Date, timezone: string): string {
  assertFrequency(frequency);
  assertInstant(instant);
  const key = keyOf(frequency, localDayOf(instant, timezone));
  assertKeyFits(key);
  return key;
}

/**
 * The half-open instant window `[start, end)` of the period a key names.
 *
 * `end` is the first instant of the NEXT period, so windows tile the timeline
 * with no gap and no overlap — `start <= t && t < end` is the whole membership
 * test, and no consumer has to reason about whether a boundary instant belongs
 * to the period it starts or the one it ends.
 *
 * `start` is local midnight, or — where the zone skipped it — the first instant
 * that exists after it. On a local day the zone skipped entirely (a date-line
 * move, e.g. `Pacific/Apia` 2011-12-30) the period is genuinely empty and
 * `start` equals `end`; that is the honest answer, not a bug to round away.
 */
export function periodBounds(frequency: Frequency, periodKey: string, timezone: string): PeriodBounds {
  assertFrequency(frequency);
  const start = startOfKey(frequency, periodKey);
  return {
    start: startOfLocalDay(start, timezone),
    end: startOfLocalDay(nextPeriodStart(frequency, start), timezone),
  };
}

/**
 * The calendar day a duty is due, as `YYYY-MM-DD`.
 *
 * A day and not an instant, because `duly_duty` / `duly_task` store `date`.
 *
 * ── Offset semantics ─────────────────────────────────────────────────────
 * `dueOffsetDays` counts days FROM THE ANCHOR DAY, with 0 meaning the anchor
 * day itself: `period_start` + 0 is the first day of the period,
 * `period_end` + 0 is the last day of the period (a quarterly duty "due in Q3"
 * lands on 30 September), and `period_end` - 1 is the day before that.
 * Both fields default to `0` on `duly_duty`, and this is the reading under
 * which that default means something on either anchor.
 *
 * ── Clamping ─────────────────────────────────────────────────────────────
 * The result is always inside the period. `period_start` + 30 on a February
 * is the 28th (29th in a leap year), never 2 March; `period_end` - 90 on a
 * month is the 1st, never the previous month. A due date outside its own
 * period would break the one thing the whole product is indexed on — a task's
 * period and its due date pointing at different months.
 */
export function dueDateFor(opts: DueDateInput): string {
  const { frequency, periodKey, timezone, dueAnchor, dueOffsetDays } = opts;
  assertFrequency(frequency);
  if (dueAnchor !== 'period_start' && dueAnchor !== 'period_end') {
    throw new RangeError(
      `Unknown due anchor ${JSON.stringify(dueAnchor)}; expected 'period_start' or 'period_end'`,
    );
  }
  if (!Number.isInteger(dueOffsetDays)) {
    throw new RangeError(`dueOffsetDays must be a whole number of days, received ${dueOffsetDays}`);
  }
  // The zone is validated even though the answer is a pure calendar day: a
  // typo'd zone must fail here, on the duty that holds it, rather than later on
  // whichever consumer happens to ask for an instant first.
  formatterFor(timezone);

  const first = startOfKey(frequency, periodKey);
  const last = addDays(nextPeriodStart(frequency, first), -1);
  const anchor = dueAnchor === 'period_start' ? first : last;
  const target = addDays(anchor, dueOffsetDays);

  if (compareCivil(target, first) < 0) return formatCivil(first);
  if (compareCivil(target, last) > 0) return formatCivil(last);
  return formatCivil(target);
}

/**
 * The day a task starts showing up in its owner's list: `dueDate` minus
 * `leadDays`.
 *
 * Pure calendar arithmetic on two civil values — no zone is involved, because
 * both ends are already local calendar days. Lead time deliberately does NOT
 * clamp into the period: a monthly duty due on the 3rd with 7 days of lead is
 * meant to appear in the previous month. That is the point of lead time, and
 * the reason it is not expressed as an offset.
 */
export function visibleFromFor(dueDate: string, leadDays: number): string {
  if (!Number.isInteger(leadDays)) {
    throw new RangeError(`leadDays must be a whole number of days, received ${leadDays}`);
  }
  return formatCivil(addDays(parseCivil(dueDate, 'dueDate'), -leadDays));
}

/**
 * Every period key from the one containing `from` to the one containing `to`,
 * ascending, contiguous, no duplicates. For backfill.
 *
 * Both ends are INCLUSIVE of the period that contains them: a backfill from a
 * duty's `effective_from` to "now" has to produce the period currently in
 * flight, or the run finishes one task short every time. `to` before `from`
 * yields `[]` rather than throwing — an empty backfill window is a normal
 * state for a duty that starts tomorrow, not an error.
 *
 * Every key returned is one {@link periodKeyFor} could itself have returned
 * for some instant in the range. That equivalence is why a local day the zone
 * skipped entirely (`Pacific/Apia` 2011-12-30) is walked past rather than
 * emitted: it holds no instants, so a task filed against it would be a task
 * for a day nobody lived through, and `periodBounds` would hand its owner an
 * empty window.
 */
export function periodsBetween(frequency: Frequency, from: Date, to: Date, timezone: string): string[] {
  assertFrequency(frequency);
  assertInstant(from, 'from');
  assertInstant(to, 'to');
  if (to.getTime() < from.getTime()) return [];

  const lastStart = periodStartOf(frequency, localDayOf(to, timezone));
  let cursor = periodStartOf(frequency, localDayOf(from, timezone));
  // Boundaries are shared between neighbours, so the walk resolves one instant
  // per period rather than two — it carries the previous boundary forward.
  let cursorInstant = startOfLocalDay(cursor, timezone);

  const keys: string[] = [];
  while (compareCivil(cursor, lastStart) <= 0) {
    const next = nextPeriodStart(frequency, cursor);
    /* c8 ignore next 3 -- a stuck cursor would hang the dispatcher; assert instead of loop */
    if (compareCivil(next, cursor) <= 0) {
      throw new RangeError(`Period walk stalled at ${formatCivil(cursor)} for frequency ${frequency}`);
    }
    const nextInstant = startOfLocalDay(next, timezone);

    if (nextInstant.getTime() > cursorInstant.getTime()) {
      const key = keyOf(frequency, cursor);
      assertKeyFits(key);
      keys.push(key);
    }

    cursor = next;
    cursorInstant = nextInstant;
  }
  return keys;
}

function assertInstant(value: Date, what = 'instant'): void {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new RangeError(`${what} must be a valid Date`);
  }
}

function assertKeyFits(key: string): void {
  /* c8 ignore next 3 -- guards a future spelling change, unreachable for today's shapes */
  if (key.length > PERIOD_KEY_MAX_LENGTH) {
    throw new RangeError(`Period key ${JSON.stringify(key)} exceeds period_key maxLength ${PERIOD_KEY_MAX_LENGTH}`);
  }
}
