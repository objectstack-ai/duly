# Duly

**Recurring duties for the people who owe them — the standard ObjectStack template app.**

Every operating role owes a set of things on a repeating clock: a monthly
return, a quarterly inspection, an annual review, a weekly reconciliation.
Today most of them live in a spreadsheet, remembered by one person, with the
reminders and the "done" messages scattered through a chat group, and they are
discovered late. Duly replaces that spreadsheet and that group. Duties are
defined once against a role, dispatched automatically each period, completed in
one click, and rolled up so every level of management sees the state of play
without asking anyone for a status report.

Duly is the duty layer, and it is owned by the operating roles themselves. It
sits **beside** an EHS or QHSE suite rather than replacing it: the suite stays
the system of record for incidents, chemicals, permits and environmental data,
and Duly answers only who owes which recurring obligation, in which period, and
whether it was done on time. It is a template: install it, load your own
catalog, and run it without us. Built on
[ObjectStack](https://github.com/objectstack-ai/objectstack) — metadata-driven,
Apache-2.0, self-hostable, and an MCP server out of the box. The
[positioning](docs/product/positioning.md) page says what it is and what it
will not become.

> **中文简介。** Duly 是 ObjectStack 的标准模板应用，管理每个岗位按固定周期欠下的
> 事——月报、季度检查、年度评审、每周对账。它替代的是「一张 Excel 表加一个微信群」：
> 履职只定义一次，按期自动派发，一键完成，逐级汇总，管理者不用向任何人要进度。
> 它是履职层，由业务岗位自己持有；与 EHS/QHSE 系统并列而非替代——事故、化学品、
> 许可和环境数据仍以那套系统为准。用 `pnpm demo:zh` 看一个中文示例组织。

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

`pnpm dev` starts **empty**: the objects, views, automations and permission
sets are all there, and the only record is the account you signed in with. That
is also what a real deployment starts from. The
[template-readiness checklist](docs/template-checklist.md) records what a fresh
clone was measured to boot with.

To start again from nothing, delete the local database:

```bash
rm -rf .objectstack/data
pnpm dev
```

## Load your own catalog

Your list already exists — a spreadsheet per role, usually. Getting it in is
the platform's **Import** button on each object list, not anything Duly wrote:
upload, confirm the mapping, import. The CSVs in [`samples/`](samples) are
shaped to go straight through it; use them as the template for your own
columns.

| Sample | Import it on | Rows |
|:---|:---|:---|
| [`samples/business-units.csv`](samples/business-units.csv) | Setup → People & Organization → Business Units | 6 |
| [`samples/people.csv`](samples/people.csv) | Setup → People & Organization → Users | 12 |
| [`samples/catalog-items.csv`](samples/catalog-items.csv) | Duly → Setup → Role catalog | 21 |
| [`samples/duties.csv`](samples/duties.csv) | Duly → Setup → All duties | 19 |

Import them **in that order**. A duty's owner, business unit and catalog item
are looked up **by name**, so the rows they point at have to exist first.

**[Getting started →](docs/getting-started.md)** is the whole path in about
ten minutes: install, sign in, import the four files, confirm and approve a
duty, dispatch, and open the owner's week — with the two steps the platform
cannot finish yet marked where you will meet them.

### What the columns have to say

- **Headers are field API names** (`position_code`, `due_offset_days`). The
  wizard auto-matches every one of them at high confidence. The **Download
  template** link on the Upload step gives you the same columns as labels
  instead; both are accepted.
- **Lookups are written as names, not ids.** `owner` takes a person's name or
  their email; `business_unit` takes the unit's **name** (its code will not
  resolve); `catalog_item` takes the catalog item's name. This is the same
  natural-key rule the seed loader uses.
- **A name that matches nothing skips that row and says so**, with a
  *Download failed rows* file to fix and re-import. Nothing is linked to a
  best guess.
- **Blank means "leave unset"**, so the object's defaults apply. That is what
  lets one file carry all three duty forms: a `standing` row leaves the five
  cadence columns empty and lands with them all null, which is exactly what
  `standing_no_frequency` requires.
- **Read-only columns are never written.** They are visible in the mapping
  step as `— Skip —` or `(match only)`, so a column that will not land says so
  before you import.
- **Re-importing needs the match option.** *When a row matches an existing
  record* defaults to *Always create new*; running the same file twice
  otherwise gives you two copies.

`test/import-samples.test.ts` holds every sample header to the object's own
schema, so renaming a field fails the build instead of quietly importing a
blank column. **[The full walk, screen by screen, with what each step was
measured to do →](docs/import/walkthrough.md)**

## Try the demo

To see the finished picture before you load anything, start with the worked
example instead:

| Command | What you get |
|:---|:---|
| `pnpm demo` | The same app **preloaded with a worked example**: a fictional manufacturer with three sites, twelve people over a three-level org chart, a catalog of duties, and six months of history behind them, so every view has something in it on the first screen. |
| `pnpm demo:zh` | The same worked example **in Chinese**: its people, its duty catalog and its history all in zh-CN, so the records read the same language as the interface. Identical in every other respect: same objects, same row counts, same history. The account you sign in with is renamed 演示管理员 to match. |

`pnpm demo` prepares the database and then starts the server; it is one
command and it works on a clean checkout. Everything it writes is ordinary
data, so you can edit or delete any of it.

The two demos are the **same fixture in two languages**, not two datasets:
one org chart, one duty catalog, one history planner, with the display strings
resolved through `src/data/demo-zh.ts`. Machine values — unit codes, period
keys, statuses, timezones — are identical in both. The language is chosen at
compile time by `DULY_DEMO_LOCALE`, so switching between them on a database you
have already seeded gives you **both** organisations in it;
`rm -rf .objectstack/data` first.

Nothing about the fictional organisation is real: every address is on an
RFC 2606 reserved domain, and no real company, person, site or regulation is
named anywhere in it, in either language. Every reference the catalog cites is
an invented internal document, never a national or industry standard.

## Customise

Everything below the catalog is metadata, so it changes as a file in `src/`,
not as a fork.

| To change | Where |
|:---|:---|
| **The catalog** — what each position owes, how often, with how much lead and grace | Data, not code: the Role catalog and All duties lists, or a fresh import. Per-duty `lead_days` and `grace_days` are ordinary columns. |
| **The one-tap progress phrases** | `progress` on `src/objects/task.object.ts`; their Chinese in `src/translations/zh-CN.ts` |
| **The "not moving" thresholds** (> 14 and > 30 days untouched) | `src/datasets/stagnation.dataset.ts` and the dashboard that reads it, `src/dashboards/duty-health.dashboard.ts` |
| **The languages** | `src/translations/` — English is the source; every authored label needs an `en` entry |
| **Who sees what** | `src/security/permission-sets.ts` (`duly_member`, `duly_manager`, `duly_admin`) |

Which of these an administrator can also change in Setup or Studio without
touching code is being measured; the configurability matrix (#129) will be
linked here when it lands.

Every metadata directory is pre-wired into `objectstack.config.ts`, empty ones
included: add your entry to the named array in your own `src/<type>/index.ts`
and leave the config alone.

## Verify before you ship

```bash
pnpm validate    # protocol schema + CEL predicates + widget bindings
pnpm typecheck   # types against @objectstack/spec
pnpm test
pnpm build
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
src/mappings/  src/data/ catalog import and the demo fixture (src/data/demo-*)
src/translations/        en (source) · zh-CN
scripts/                 pnpm demo — prepare the database, then start with the example loaded
samples/                 CSVs for the platform's standard Import (see above)
docs/                    getting started and the template-readiness checklist
docs/product/            positioning, data model, design principles
docs/import/             the recorded import walk, screen by screen
```

## Documentation

- [Getting started](docs/getting-started.md) — your own list, in about ten minutes
- [Template-readiness checklist](docs/template-checklist.md) — what a fresh clone was measured to do
- [Positioning](docs/product/positioning.md) — who this is for and what it is not
- [Data model](docs/product/data-model.md) — the five objects and why each exists
- [Design principles](docs/product/design-principles.md) — the constraints above, argued
- [Importing an existing list](docs/import/walkthrough.md) — the standard Import, walked and measured
- [Roadmap](docs/roadmap.md) — capability gates, ending at the template gate: install it, load your catalog, run it without us

## License

Apache-2.0. See [LICENSE](LICENSE).
