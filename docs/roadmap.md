# Roadmap

Milestones are capability gates, not dates. Each one ends with something a
customer could actually run.

**v1 = M0 + M1 + M2.** Dispatch plus visibility is the shippable product; M3 and
M4 are planned and specified but do not gate the first release.

## M0 — Foundation ✅

The repo boots, validates, type-checks, tests and builds. Five objects, five view
containers, one app, CI, and the product docs that the rest of the work is
measured against.

## M1 — The dispatch spine

*Gate: a duty defined on Monday produces the right task, in the right period, on
the right date, in the owner's timezone — and running the dispatcher twice
changes nothing.*

- Period engine (`period_key`, boundaries, due-date resolution, DST-safe)
- Dispatcher job — idempotent, backfill-capable, skips standing duties
- Task lifecycle hook — `completed_at` and `last_update_at` stamping
- One-click completion action with undo
- Catalog instantiation — a position's catalog onto a person
- Assignment fan-out flow

## M2 — Visibility without reporting

*Gate: a manager can answer "what is late and what has stopped, across my unit"
in one screen, having entered no data.*

- Positions and permission sets, authored against the ADR-0057 depth scopes.
  `@objectstack/security-enterprise` resolves them in enterprise deployments; no
  application-level fallback is built, and an open-edition checkout correctly
  shows owner-only rows
- Unit rollups and the duty-health dataset
- Manager dashboard: late, not-moving, on-time rate by unit — no rankings
- Lead-time reminders, overdue escalation, stagnation alerts
- Kanban / calendar / gantt lenses over the same data

## M3 — The individual's reason to use it *(post-v1)*

*Gate: a user who has kept the system current for a year can produce their own
review material from it in under a minute.*

- Work log UI, private by default
- Period summary export (document + copyable text)
- Mobile-first task list and completion (PWA; note there is no ready-made
  navigation shell — `mobileNavigation` was removed in spec 17.0.0)
- Offline completion queue

## M4 — Install it, load your catalog, run it without us *(post-v1)*

*Gate: a customer can install it, load their own catalog, and run it without us.*

This is the milestone that makes Duly the standard ObjectStack template app
rather than one organisation's deployment. Three items landed under the
milestone's earlier title and stay landed: i18n with `en` as the source language
and `zh-CN` hand-translated behind a coverage gate; the platform's standard
Import for an existing duty catalog; and the demo dataset in two languages.
What remains:

- Repo is template-shaped: empty on `pnpm dev`, demo opt-in, no customer naming,
  README quick start for "load your own catalog"
- Industry catalog packs, importable in ten minutes, en + zh-CN, invented
  references only: food-safety daily/weekly/monthly control, ISO 9001 internal
  audit & calibration, EHS inspections
- Release canary: a scheduled workflow runs the four gates against the newest
  `@objectstack/*` and opens an issue on red
- `create-objectstack` carries a `duly` (compliance calendar) template — lives
  in the platform repository, not here
- Deployment & upgrade docs and a container image; MCP surface documented;
  accessibility & dark mode
- Positioning and README rewritten for the new positioning (layering vs EHS
  suites; template first)

## Parked

Ruled by the maintainer on 2026-10-26, in the epic that defines M4:

> Direct sales, the customer's phase-2 QHSE module and phase-3 scoring are out;
> per-customer IM connectors are out.

> Phase-2 QHSE checklists · phase-3 supervision and scoring · work calendar ·
> per-customer IM connectors · any ranking or league table

No milestone carries these five — QHSE checklists, supervision and scoring, a
work calendar, per-customer IM connectors, direct sales. Re-opening one is a
maintainer ruling, not a card. Each has its one-line reason in
[positioning](product/positioning.md#what-we-will-not-build).

## Explicitly out of scope

Daily status reporting · performance scores and league tables · timesheets ·
project planning (dependencies, critical path, resource levelling) · mandatory
evidence on completion · any manager-side data entry beyond assigning.

See [positioning](product/positioning.md#what-we-will-not-build) for why each of
these is declined rather than deferred.
