# Design principles

Ten constraints. Each one is a position on a way this category of product
reliably fails. They are enforced by the schema, the tests in `test/invariants.test.ts`,
and the review bar — not by documentation alone.

---

### 1. A duty is not a task

The definition and the occurrence are different objects with different
lifecycles. Editing "the monthly return is now due on the 7th" must not rewrite
the history of the last eleven months, and closing August must not touch the
rule.

### 2. Dispatch is idempotent, by index

`(duty, owner, period_key)` is unique. This is the load-bearing constraint of the
whole system: it lets the dispatcher be an ordinary job that can be re-run,
backfilled, or killed halfway through with no duplicates and no lock. Any change
that weakens it is a change to the architecture, not to a detail.

### 3. Standing duties never generate tasks

"Keep the register current" cannot be ticked. A product that generates a task for
it produces a backlog that can never reach zero, and a list that can never reach
zero stops being read. Standing duties are visible and attestable, not tickable.

### 4. Due dates live inside the period, with lead time

Anchor plus offset, not "due at period end". Otherwise every annual and
semi-annual duty in the organisation lands in the last week of December, and the
one month the system is least useful is the month it is needed most.

Lead time is the other half. A task that first appears on its due date is not a
reminder; it is a report on a failure that already happened.

### 5. Stagnation is the headline signal, not completion %

`last_update_at` older than N days is the earliest honest warning a manager gets.
It fires weeks before a due date, on exactly the work that is going nowhere. A
completion percentage only describes work that already finished — by the time it
moves, the decision it should have informed is behind you.

### 6. Governed and self-declared work are separated by object, not by flag

Rules that say "don't count the voluntary stuff" do not survive contact with an
organisation. Someone notices that a fuller list looks better, everybody pads,
and the count ends up measuring reporting enthusiasm — with the busiest people
logging the least.

`duly_log_entry` has no due date, no status, no completion and no rollup. There
is nothing to game because there is nothing to score.

**A good design makes the bad thing impossible. A good rule only makes it against
the rules.**

### 7. Item counts are never ranked or compared

Not in a dashboard, not in an export, not in a "top contributors" widget, not as
a sort order that implies it. This is the specific mechanism by which principle 6
gets undone one well-meaning ticket at a time.

### 8. Managers have exactly one write action: assign

No status entry, no weekly consolidation form, no sign-off queue, no
manager-authored progress notes. Every additional manager-side write is a
reporting ritual with a nicer UI, and it is the ritual — not the spreadsheet —
that the customer is actually trying to escape.

An assignment fans out to N independent tasks. "3 of 5" is computed. Assigning
does not create a to-do for the assigner unless they explicitly ask for one.

### 9. Completion is one click, with an undo, and evidence is optional

No modal, no mandatory note, no required attachment, no percentage. Use undo
instead of confirmation. An evidence gate turns a 5-second tick into a 5-minute
chore, and a list that costs five minutes per item is a list people stop using —
after which the system reports 100% compliance on a dataset nobody maintains.

Attachments exist and are welcome. They are never a condition of completing
anything.

### 10. Never store what you can filter

No `is_late`, `is_overdue`, `is_open`, `is_completed`. A stored flag needs a
writer that runs every midnight, and the night it does not run, every view built
on it lies without erroring. A formula field is worse — it is virtual, so a
filter naming one matches nothing at all, silently.

`status`, `due_date` and `last_update_at` are stored and indexed. Ask them.

---

## How these get enforced

| Principle | Enforcement |
|:---|:---|
| 2 | Unique index + `test/invariants.test.ts` |
| 3 | Dispatcher skips `form: 'standing'`; covered by dispatcher tests |
| 5 | `last_update_at` is `readonly` and hook-stamped; the "Not moving" view ships in the default app |
| 6 | Separate object with no scoreable fields; asserted in `test/invariants.test.ts` |
| 7 | Review bar. Any PR adding a count-based ranking is rejected on sight |
| 8 | No manager-side write surface exists to extend |
| 9 | `note` and attachments are optional; no `progress_percent` field exists |
| 10 | Asserted in `test/invariants.test.ts`; `pnpm validate` rejects predicate typos |
