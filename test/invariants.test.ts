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

  it('lateness is derived from stored columns, never stored', () => {
    for (const flag of ['is_late', 'is_overdue', 'is_open', 'is_completed']) {
      expect(Object.keys(Task.fields)).not.toContain(flag);
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
