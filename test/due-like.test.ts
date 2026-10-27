// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { FieldSchema } from '@objectstack/spec/data';

import stack from '../objectstack.config.js';

/**
 * Overdue styling is a DECLARATION on the field, not something the console
 * works out (#151).
 *
 * Up to @objectstack 17.x the date cell guessed "this is a deadline" from the
 * field name, so `due_date` rendered `Overdue 5d` in red with nothing declared.
 * Spec 18 dropped the guess for `dueLike` / `settledWhen`, and the upgrade
 * (#144) shipped My week with overdue tasks as plain dates — every gate green,
 * because no gate can see how a date renders. This file is the gate for that:
 * the next upgrade that drops or renames the keys goes red here instead of in
 * a person's week.
 *
 * It reads the objects off the composed stack — what `defineStack` hands the
 * runtime — so a declaration that exists in source but not in the stack fails.
 *
 * The settled set is written out per object, and every status option must be
 * classified as settled or live. A status added later fails the second test
 * until somebody decides whether its deadline still counts.
 */
const DEADLINES = {
  duly_task: {
    settled: ['done', 'skipped', 'cancelled'],
    live: ['open', 'in_progress'],
    source: "record.status in ['done', 'skipped', 'cancelled']",
  },
  duly_assignment: {
    settled: ['closed'],
    live: ['draft', 'dispatched'],
    source: "record.status == 'closed'",
  },
} as const;

const objectNamed = (name: string) => {
  const object = stack.objects?.find((o) => o.name === name);
  if (!object) throw new Error(`${name} is not in the composed stack`);
  return object;
};

describe.each(Object.entries(DEADLINES))('%s.due_date is a declared deadline', (name, expected) => {
  const object = objectNamed(name);
  const due = object.fields.due_date;

  it('declares dueLike with a settledWhen that names the terminal statuses', () => {
    expect(due.type).toBe('date');
    expect(due.dueLike).toBe(true);
    expect(due.settledWhen).toEqual({ dialect: 'cel', source: expected.source });
  });

  it('classifies every status option as settled or live', () => {
    const values = (object.fields.status.options ?? []).map((o) => o.value).sort();
    expect(values).toEqual([...expected.settled, ...expected.live].sort());
  });

  it('passes the spec door that refuses settledWhen without dueLike', () => {
    const parsed = FieldSchema.safeParse(due);
    expect(parsed.success, parsed.success ? '' : JSON.stringify(parsed.error.issues)).toBe(true);
    expect(parsed.data?.dueLike).toBe(true);
    expect(parsed.data?.settledWhen).toEqual(due.settledWhen);
  });
});
