# Duly

**Recurring obligation and duty management.**

Every role in an organisation owes a set of things on a repeating clock — a
monthly return, a quarterly inspection, an annual review, a weekly reconciliation.
Most of them are tracked in a spreadsheet, remembered by one person, and
discovered late.

Duly turns that spreadsheet into a system: duties are defined once against a
role, dispatched automatically each period, completed in one click, and rolled up
so every level of management sees the state of play without asking for a status
report.

Built on [ObjectStack](https://github.com/objectstack-ai/objectstack) — metadata-driven,
Apache-2.0, self-hostable, and an MCP server out of the box.

---

## What makes it different

Most task products let you build this. Duly is opinionated about the ways it
goes wrong, and the opinions are enforced by the data model rather than by
documentation:

| Decision | Why |
|:---|:---|
| **A duty is not a task.** One duty × one owner × one period = one task, unique by index. | Dispatch is idempotent. Re-run it, backfill it, crash halfway — no duplicates, no lock. |
| **Standing duties never generate tasks.** | "Keep the register current" cannot be ticked. Modelling it as a task creates a backlog nobody can close, and users learn to ignore the list. |
| **Due dates are anchored inside the period, with lead time.** | Otherwise every annual and semi-annual duty lands in the last week of December. |
| **Stagnation is the headline signal, not completion %.** | `last_update_at` warns weeks before a due date does. A percentage only describes work that already finished. |
| **Self-declared work is recorded but never scored.** The work log is a separate object with no due date and no rollup. | One list holding both governed duties and voluntary notes always ends up measuring reporting enthusiasm. Two objects make that impossible rather than merely against the rules. |
| **Managers have exactly one write action: assign.** | No manager-side status entry, no weekly consolidation form. An assignment fans out to N independent tasks; "3 of 5" is computed, never maintained. |
| **Completion is one click with an undo, and evidence is optional.** | An evidence gate turns a 5-second tick into a 5-minute chore, and the list stops being used. |
| **Item counts are never ranked or compared.** | The moment they are, the busiest people log the least. |

## Quick start

```bash
pnpm install
pnpm dev
```

The Console is at `http://localhost:3000/_console/`, the REST API at
`http://localhost:3000/api/v1`, and the app is itself an MCP server at
`/api/v1/mcp`. Sign in as `admin@objectos.ai` / `admin123`.

### Two ways to start it

Duly ships empty. Evaluating it *for your own organisation* and evaluating *the
idea* are different things, so they are different commands:

| Command | What you get |
|:---|:---|
| `pnpm dev` | An **empty Duly**. The objects, views and automations are all there; the records are yours to add — define your first duty against a role and watch it dispatch. This is also what a real deployment starts from. |
| `pnpm demo` | The same app **preloaded with a worked example**: Ardenline Group, a fictional manufacturer — three sites, twelve people over a three-level org chart, a catalog of duties, and six months of history behind them, so every view has something in it on the first screen. |

`pnpm demo` prepares the database and then starts the server; it is one
command and it works on a clean checkout. Everything it writes is ordinary
data, so you can edit or delete any of it.

To go back to an empty app, delete the local database and start again:

```bash
rm -rf .objectstack/data
pnpm dev
```

Nothing about the fictional organisation is real: every address is on an
RFC 2606 reserved domain, and no real company, person, site or regulation is
named anywhere in it.

Every metadata directory is pre-wired into `objectstack.config.ts`, empty ones
included: add your entry to the named array in your own `src/<type>/index.ts` and
leave the config alone. It is the one file parallel branches collide on.

## Verify before you ship

```bash
pnpm validate    # protocol schema + CEL predicates + widget bindings
pnpm typecheck   # types against @objectstack/spec
pnpm test
```

ObjectStack metadata fails **silently at runtime**, not at edit time. Never
report a metadata change as done until `pnpm validate` passes.

## Layout

```
objectstack.config.ts    defineStack() — the single entry point
src/objects/             duty · task · catalog_item · assignment · log_entry
src/views/               list / calendar / kanban lenses
src/apps/  src/pages/    navigation and custom screens
src/jobs/                the dispatcher and the alert jobs
src/flows/  src/actions/ assignment fan-out, escalation, one-click completion
src/hooks/               object lifecycle hooks (collected here, not from objects/)
src/functions/           pure callables a `script` flow node resolves by name
src/datasets/  src/dashboards/   the semantic layer and what reads it
src/security/            positions, permission sets, sharing rules
src/mappings/  src/data/ catalog import and seed fixtures
src/translations/        en (source) · zh-CN
scripts/                 pnpm demo — prepare the database, then start with the example loaded
docs/product/            positioning, data model, design principles
```

## Documentation

- [Positioning](docs/product/positioning.md) — who this is for and what it is not
- [Data model](docs/product/data-model.md) — the five objects and why each exists
- [Design principles](docs/product/design-principles.md) — the constraints above, argued
- [Roadmap](docs/roadmap.md) — milestones M0–M4

## License

Apache-2.0. See [LICENSE](LICENSE).
