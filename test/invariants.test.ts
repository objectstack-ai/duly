// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { describe, expect, it } from 'vitest';

import { Duty, Task, LogEntry, CatalogItem } from '../src/objects/index.js';

/**
 * These are not schema tests — `pnpm validate` already checks the protocol.
 * They pin the PRODUCT INVARIANTS from AGENTS.md, the ones a well-meaning
 * refactor is most likely to undo because each looks like a small improvement
 * in isolation.
 */
describe('product invariants', () => {
  it('dispatch is idempotent on (duty, owner, period_key)', () => {
    const identity = Task.indexes?.find((i) => i.name === 'duly_task_dispatch_identity');
    expect(identity, 'the dispatch identity index must exist').toBeDefined();
    expect(identity?.fields).toEqual(['duty', 'owner', 'period_key']);
    // Scoped to the organization (ADR-0120): two tenants may legitimately hold
    // the same triple. A `true` here would be a cross-tenant collision.
    expect(identity?.unique).toBe('organization');
  });

  it('a task has exactly one owner', () => {
    expect(Task.fields.owner.multiple).not.toBe(true);
    expect(Task.fields.owner.required).toBe(true);
  });

  it('the work log cannot be scored: no due date, no completion, no status', () => {
    const scoreable = ['due_date', 'status', 'completed_at', 'period_key', 'duty'];
    for (const field of scoreable) {
      expect(
        Object.keys(LogEntry.fields),
        `duly_log_entry must not carry "${field}" — it is what makes the log unscoreable`,
      ).not.toContain(field);
    }
  });

  it('the work log defaults to private', () => {
    const options = LogEntry.fields.visibility.options ?? [];
    const fallback = options.find((o) => o.default);
    expect(fallback?.value).toBe('private');
  });

  it('completion never requires evidence or a percentage', () => {
    expect(Object.keys(Task.fields)).not.toContain('progress_percent');
    expect(Task.fields.note.required).not.toBe(true);
  });

  /**
   * #108 — the attachment column is optional on every path there is.
   *
   * Three ways an evidence gate could arrive, and none of them may: the field
   * itself going `required`, a conditional `requiredWhen` that fires on `done`
   * (which is how it would actually be written), or a validation rule naming
   * the column. `test/task-hook.test.ts` completes a fileless task against a
   * real engine; this is the metadata half, which is where the mistake would
   * be MADE.
   */
  it('an attachment is never required, and no rule reads one', () => {
    const attachments = Task.fields.attachments as {
      required?: boolean; requiredWhen?: unknown; multiple?: boolean; type?: string;
    };
    expect(attachments, 'duly_task must carry an attachments column').toBeDefined();
    expect(attachments.type, 'the platform file field, not a text column of URLs').toBe('file');
    expect(attachments.multiple, 'more than one file, or the first one becomes the record').toBe(true);
    expect(attachments.required, 'an evidence gate turns the tick into a chore').not.toBe(true);
    expect(
      attachments.requiredWhen,
      'a `requiredWhen` on done is the evidence gate written the way it would really be written',
    ).toBeUndefined();

    for (const rule of Task.validations ?? []) {
      expect(
        JSON.stringify(rule),
        `validation "${rule.name}" reads attachments — completion never requires evidence`,
      ).not.toContain('attachments');
    }
  });

  /**
   * #108 — the progress phrase is a phrase, not a score and not a default.
   *
   * A default would put words nobody said on every dispatched row, and the
   * list column would read as news on 186 tasks at once. Blank is the honest
   * value for "nobody has reported anything yet".
   */
  it('the progress phrase starts blank and is never required', () => {
    const progress = Task.fields.progress as {
      required?: boolean; options?: Array<{ value: string; default?: boolean }>;
    };
    expect(progress.required, 'nobody is made to file a status line').not.toBe(true);
    expect((progress.options ?? []).map((o) => o.value))
      .toEqual(['on_time', 'distributed', 'awaiting_feedback', 'in_hand']);
    expect(
      (progress.options ?? []).filter((o) => o.default),
      'a dispatched task has reported nothing yet — no option may claim the default',
    ).toEqual([]);
  });

  /**
   * #108 — the record page's `history` group is exactly the server-owned
   * stamps, and every field is filed somewhere.
   *
   * Both halves matter and both are silent when wrong. A field whose `group`
   * names no declared key is not an error: the platform drops it into an
   * unnamed trailing bucket below the last section, so it renders — just in
   * the wrong place, under no heading. And a new readonly stamp left out of
   * `history` lands in the middle of the edit form, reading as a field
   * somebody forgot to make editable.
   */
  it('every field is filed under a declared group, and history is exactly the readonly stamps', () => {
    const groups = new Set((Task.fieldGroups ?? []).map((g) => g.key));
    expect(groups, 'the three sections the deck asks for').toEqual(
      new Set(['basics', 'progress', 'history']),
    );

    const entries = Object.entries(Task.fields) as Array<[string, { group?: string; readonly?: boolean }]>;
    for (const [name, field] of entries) {
      expect(
        field.group && groups.has(field.group) ? field.group : undefined,
        `duly_task.${name} has no group, or names one that is not declared — it renders `
        + 'in an unnamed bucket after the last section, with nothing in error',
      ).toBeDefined();
    }

    const readonlyFields = entries.filter(([, f]) => f.readonly === true).map(([name]) => name).sort();
    const historyFields = entries.filter(([, f]) => f.group === 'history').map(([name]) => name).sort();
    expect(historyFields, 'the history section IS the set of server-owned stamps')
      .toEqual(readonlyFields);
    expect(readonlyFields.length, 'and it is not vacuously empty').toBeGreaterThan(3);
  });

  it('no MAINTAINED lateness flag exists on the task', () => {
    // The banned shape is a flag whose truth changes with the clock: it needs a
    // writer every midnight and lies the night it does not run. `late_after`
    // and `completed_late` (#52) are deliberately not in this list — each is
    // written once, at the instant it becomes knowable, and never recomputed,
    // which is the same category as `completed_at` beside them. `AGENTS.md`
    // rule 5 carries the boundary; the difference is not the name but whether a
    // second write ever has to happen.
    for (const flag of ['is_late', 'is_overdue', 'is_open', 'is_completed']) {
      expect(Object.keys(Task.fields)).not.toContain(flag);
    }
    for (const stamp of ['late_after', 'completed_late']) {
      expect(
        (Task.fields as Record<string, { readonly?: boolean }>)[stamp]?.readonly,
        `${stamp} must be readonly — a write-once column a caller can set is a column that drifts`,
      ).toBe(true);
    }
  });

  it('caliber is a stored column on both duty and task', () => {
    for (const [name, schema] of [['duly_duty', Duty], ['duly_task', Task]] as const) {
      const values = (schema.fields.source.options ?? []).map((o) => o.value);
      expect(values, `${name}.source`).toEqual(['catalog', 'assigned', 'self']);
    }
  });

  it('a hand-created record is self-declared, not born governed (#50, #55)', () => {
    // The safe default for an ambiguous caliber is the UNscoreable one, on
    // every object that carries the column — not just the one that surfaced
    // it first. A duty or task created with no `source` supplied must land
    // as 'self' — never 'catalog' (which additionally exposes a duty to
    // duly_catalog_sync's cadence rewrite for a catalog item it never came
    // from) and never 'assigned'.
    //
    // Both governed calibers are reachable only when the producer that knows
    // states them explicitly: on duly_duty, duly_catalog_apply writes
    // 'catalog' (#34); on duly_task, the dispatcher copies `duty.source`
    // (#43) and the assignment fan-out writes 'assigned' directly (#33).
    // Neither may ride in on the field default — the default is reached only
    // by a hand-created record, which is self-declared by definition.
    for (const [name, schema] of [['duly_duty', Duty], ['duly_task', Task]] as const) {
      const options = schema.fields.source.options ?? [];
      const defaults = options.filter((o) => o.default);
      expect(defaults, `${name}.source: exactly one option may claim the default`).toHaveLength(1);
      expect(defaults[0]?.value, `${name}.source`).toBe('self');

      for (const governed of ['catalog', 'assigned'] as const) {
        const option = options.find((o) => o.value === governed);
        expect(option?.default, `${name}.source: ${governed} must not be the default`).not.toBe(true);
      }
    }
  });

  it('every object states its sharing model explicitly', () => {
    for (const schema of [Duty, Task, LogEntry, CatalogItem]) {
      expect(schema.sharingModel, `${schema.name} must state an OWD`).toBeTruthy();
    }
  });
});
