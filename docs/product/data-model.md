# Data model

Five objects. Each exists because collapsing it into another one breaks something
specific.

```
duly_catalog_item ──instantiate──► duly_duty ──dispatch──► duly_task
   (per position)                   (per person)            (per period)
                                                                ▲
                              duly_assignment ──fan-out─────────┘
                              (one → N tasks)

duly_log_entry   (personal record — deliberately connected to nothing that scores)
```

Platform objects reused rather than re-modelled: `sys_user` (people),
`sys_business_unit` (the org tree, via `parent_business_unit_id` and
`manager_user_id`), `sys_user_position` (who holds which position, anchored to a
unit).

---

## `duly_duty` — the standing definition

What a named person owes, how often, and by when *within* each period.

| Group | Fields |
|:---|:---|
| Identity | `name`, `description`, `form`, `owner`, `business_unit` |
| Caliber | `source`, `catalog_item` |
| Cadence | `frequency`, `due_anchor`, `due_offset_days`, `lead_days`, `grace_days`, `timezone` |
| Lifecycle | `status`, `effective_from`, `effective_to`, `last_dispatched_period` |

**Three forms.** `recurring` auto-dispatches. `one_off` is dispatched once.
`standing` never completes and therefore never generates a task — "keep the
register current", "answer the duty phone". Modelling a standing duty as a
recurring task creates an infinite backlog nobody can close, and users respond by
ignoring the entire list. Standing duties are visible and attestable, not
tickable.

**`due_anchor` + `due_offset_days`.** A quarterly duty "due in Q3" is due on
30 September to everyone behind on it. Anchoring inside the period is what stops
annual and semi-annual work collapsing onto the last week of December.
`due_offset_days` counts days from the anchor day, and the anchor day itself is
offset `0` — on `period_start`, `0` is the first day of the period and `4` is
the fifth day; on `period_end`, `0` is the last day of the period and `-3` is
three days before the last.

**`lead_days`.** A task that appears on its due date is already late. Lead time is
the difference between a system that reminds you and one that reports on you.

**`timezone`.** Duly is sold worldwide. "The 5th of the month" needs to know
whose month. Period boundaries resolve in the duty's own IANA zone, not the
server's.

**`source` is the caliber field, and metrics read only this column.** `catalog`
and `assigned` duties are governed — the organisation put them there, so an
on-time rate over them means something. `self` duties are the owner's own
record-keeping: surfaced, never scored. We deliberately do **not** derive a
`governed` boolean from it; a derived flag is a second thing that can drift out
of step with the column it was derived from.

---

## `duly_task` — one occurrence

One duty × one owner × one period. **Unique by index** on
`(duty, owner, period_key)`, scoped to the organization.

That constraint is load-bearing. It is why the dispatcher can be a plain
idempotent job — re-runnable, backfillable, safe to crash halfway through —
instead of needing a distributed lock. Every other design here follows from
wanting that property.

`period_key` spelling, produced by one shared function so every writer agrees:
`2026-08-21` (daily) · `2026-W34` · `2026-08` · `2026-Q3` · `2026-H2` · `2026`.

**`last_update_at` is the most useful field in the product.** Completion
percentage describes work that already finished. `last_update_at` describes work
that has quietly stopped, and it says so weeks before the due date does. It is
server-owned, stamped on every status change and note edit.

**`late_after` and `completed_late` are the lateness pair, and they are stamped
once each.** `late_after` is `due_date + duty.grace_days`, written by the
dispatcher; `completed_late` is `completed_at > late_after`, written by the
completion hook. Both are server-owned and neither is ever recomputed — so the
Late list is a plain date filter, the on-time rate is a count over a boolean,
and the platform gap that made `completed_at <= due_date + duty.grace_days`
unaskable (objectstack#14104) stops being a blocker rather than being resolved.

The consequence is deliberate and worth stating plainly: **editing a duty's
grace does not re-adjudicate work already dispatched or already completed.** A
task records what was owed when it was owed, and a compliance record that
rewrites itself when configuration changes is worth nothing in front of an
auditor. The place a replay onto open tasks would belong is `duly_catalog_sync`,
which already exists to push duty edits onto instantiated records; it does not
do this today.

**Deliberately absent.** `is_late`, `is_overdue`, `is_open`, `is_completed`,
`progress_percent`.

The first four are the *maintained-flag* shape, which is a different thing from
the two stamps above: their truth changes with the clock rather than with the
record, so each needs a writer that runs every midnight, and the night it does
not run every view lies without erroring. A formula field is worse: it is
virtual, so a *filter* naming one silently matches nothing at all. The test is
not "is it derivable" — everything here is derivable — but "would a second write
ever have to happen". `AGENTS.md` rule 5 carries the boundary.

`progress_percent` is a number nobody can verify, which is exactly why it becomes
the number everyone reports. Progress lives in `status` and `last_update_at`.

**`skipped` is a first-class outcome** with a required reason. "The plant was
down; there was nothing to return" is a true answer, and forcing it to be
recorded as `done` or left `open` corrupts the data either way.

---

## `duly_catalog_item` — the duty template, per position

The thing customers already have, usually as a spreadsheet: *these are the 26
things a plant compliance officer owes*. Instantiating a catalog onto a new hire
is the difference between adoption in an afternoon and death during onboarding
because 400 people were each asked to hand-type their own list.

`sharingModel: 'public_read'` on purpose — it describes positions, not people,
and you need to see what a position owes before you take it. `regulation_ref` is
what turns a checklist into an audit answer.

`position_code` is free text rather than a lookup, so a customer can load their
catalog on day one, before they have modelled positions in the platform. (The
field cannot be called `role_code`: `role` is a reserved word in the platform
vocabulary and the author-time linter rejects it.)

---

## `duly_assignment` — one → N

A manager hands one piece of work to five people; it becomes five independent
tasks, each with one owner who updates only their own. Nobody maintains "3 of 5"
— it is a rollup over the children, computed on read.

The alternative — one shared task with five names on it — produces a record
everybody can see and nobody owns, which is the single most common way a task
tool starts being ignored.

`needs_collection` is opt-in: only when the assigner ticks *"I have a follow-up
once everyone is in"* do they get a task of their own. A manager who assigns work
should not automatically inherit a to-do list from having assigned it.

---

## `duly_log_entry` — the work log

The calendar, not the checklist. Separate object, no due date, no completion, no
status, no rollup, private by default.

The first design put self-logged work in the task list behind a "private" toggle
and five rules about what counted. That patches the problem; it does not remove
it. While one list holds both governed duties and voluntary notes, somebody
notices a fuller list looks better, everybody pads, and the count starts
measuring reporting enthusiasm instead of work — with the perverse second-order
effect that the busiest people log the least.

Two objects make that impossible rather than merely against the rules. There is
nothing here to game: no score reads this object, and none ever will.

It exists so that at review time a person can produce a year of real record
instead of reconstructing it from memory. That is a genuine benefit to the
individual, which is the only reason voluntary logging ever gets done.

---

## Security posture

Every object states `sharingModel` explicitly — unset means private and the
publish linter errors on it (ADR-0090 D1/D7).

Manager visibility comes from permission sets with `readScope`, not from an
org-wide default. The ADR-0057 hierarchy scopes — `own_and_reports`, `unit`,
`unit_and_below` — are resolved by `@objectstack/security-enterprise`, which
enterprise deployments carry. We author against them directly and build no
application-level fallback. (`org` is a flat scope, not a hierarchy one; it is
used on the catalog and nowhere near a person's rows.)

Authoring a hierarchy scope **requires** `requires: ['hierarchy-security']` in
`objectstack.config.ts`, which this package declares. Omitting it is not a
silent degradation — `defineStack` refuses to load the stack, which is the
platform deliberately turning the old fail-closed-to-owner-only into an
authoring-time error (ADR-0049: otherwise the metadata would lie).

Declaring the capability installs nothing and breaks nothing. On an
open-edition checkout, with `@objectstack/security-enterprise` absent, every
gate stays green and `pnpm validate` prints one warning naming the package that
provides the capability. **That warning is the expected state of this repo.**

The scopes then resolve to owner-only here, so a manager view shows you your own
rows. That is the edition, not a defect; anyone verifying manager visibility
needs an enterprise runtime to see it work.
