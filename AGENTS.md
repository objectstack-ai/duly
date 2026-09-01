# Duly — Agent Instructions

This is an **ObjectStack** application: business objects, views, automations and
security are declared as TypeScript metadata, not hand-written CRUD.

- **Entry point:** `objectstack.config.ts` (`defineStack()`)
- **Spec package:** `@objectstack/spec` (Zod-first schemas and types)
- **Namespace:** `duly` · **object prefix:** `duly_` · **app id:** `ai.objectstack.duly`

## ⛔ Worktree-first — before your FIRST file edit

Several agents work this repo at once. The shared checkout has its HEAD switched
and its tree reset **under you**, silently clobbering uncommitted work. A feature
branch on the shared checkout is **not** enough.

```bash
git worktree add ../duly-issue-<n> -b claude/issue-<n>-<slug> main
cd ../duly-issue-<n> && pnpm install
```

Make every edit there.

## ⛔ Never `git stash`

`refs/stash` lives in the **common** `.git` directory, so every worktree shares
one LIFO stack. Two agents stashing in their own worktrees push and pop the
*same* stack — your `pop` restores the other agent's work and reports success.
Use instead, all inside your own worktree:

```bash
git diff > /tmp/wip.patch && git checkout -- <paths>   # then: git apply /tmp/wip.patch
git commit -am wip                                     # then: git reset --soft HEAD~1
```

## ⛔ Claim the issue before you write any code

Assign the issue to yourself and post a claim comment naming your branch, as the
**first action** of the task. Re-read the comments before writing code: an
earlier claim from a different session means the issue is taken, whatever the
assignee field says.

## Verify after every metadata change

Metadata mistakes fail **silently at runtime**: a dangling widget binding
renders an empty chart, a flow left out of its barrel never fires, an
unregistered hook never runs. `pnpm validate` catches most of them. It does not
catch all of them, and rule 4 below names the gap that matters most for flows.

```bash
pnpm validate    # same gates as build, no artifact — the fast inner loop
pnpm typecheck
pnpm test
```

**Never report a metadata change as done until `pnpm validate` passes.**

## Naming conventions

| Context | Convention | Example |
|:--------|:-----------|:--------|
| Config keys (TS props) | `camelCase` | `maxLength`, `defaultValue` |
| Machine names (data values) | `snake_case` | `duly_task`, `period_key` |
| Metadata type names | singular | `'view'`, `'flow'` |
| File names | `{name}.{type}.ts` | `task.object.ts`, `duly.app.ts` |

`role` is a **reserved word** in the platform vocabulary — the author-time linter
rejects it. Use `position` (distribution), `permission_set` (capability),
`business_unit` (hierarchy), or a domain word.

## Rules that are not style

1. **Zod first.** Types derive from schemas via `z.infer<>`.
2. **Barrels — and never edit `objectstack.config.ts`.** Every metadata
   directory is pre-created and already wired into the config, empty ones
   included. Add your entry to your OWN `src/<type>/index.ts` named array
   (`dulyFlows`, `dulyJobs`, …); the config is the one file every parallel task
   would otherwise collide on. A file not in its barrel is dead metadata that
   type-checks and never runs.
   The collections are named arrays rather than `Object.values(barrel)` because
   on an empty namespace `Object.values` has nothing to infer from and resolves
   against the keyed branch of `MetadataCollectionInput`, which makes `name`
   optional and fails the assignment.
3. **Hooks are registered in `defineStack({ hooks })`**, not collected from the
   objects barrel. An unregistered `*.hook.ts` never runs.
4. **Predicates are CEL** — `record.<field>`, never bare `<field>`, on every
   surface: `visible` / `disabled` / `requiredWhen`, validation rules, sharing
   rules, and flow and job conditions.

   *What `pnpm validate` enforces, and where it stops.* The author-time rule
   resolves every `record.` / `previous.` read against the bound object and
   fails loudly and located on a typo — measured on `@objectstack/cli` 17.2.0,
   a flow condition reading `record.needs_colection` gives ``unknown field
   `needs_colection` on `duly_assignment` — did you mean `needs_collection`?``.
   What it does **not** flag, on any surface, is a **bare** identifier: the same
   predicate written `status == "dispatched"` passes `validate` with exit 0.
   That is deliberate. In a flattened flow scope a bare name may genuinely be a
   flow variable, so the platform's `collectBoundRecordReads` never reads a bare
   identifier as a record reference. Filed upstream as
   **objectstack-ai/objectstack#14089**; until it lands,
   `test/flow-predicates.test.ts` is a repo-local **stopgap** over `dulyFlows`
   and `dulyJobs` — written to be deleted when #14089 ships, not maintained.

   *The failure mode is not `null`.* A bare name in a flow does not evaluate to
   null and quietly hide a branch. The engine flattens the trigger record's
   fields into top-level variables, so a bare `status` genuinely **resolves** —
   to the field, or to a same-named flow variable that was seeded first and
   **shadows** it. And when a name resolves to nothing the engine **throws**
   (ADR-0032 §1c: no silent fallback — a non-`ok` result is a real fault, not a
   false condition). So the two real outcomes are "silently means something
   else" and "loud runtime fault". Neither is recoverable by reading the
   predicate, which is why the rule stands: `record.<field>` is the only
   spelling that cannot be captured by a variable declared elsewhere in the
   file, and the only one `validate` can check for you.
5. **Never store what you can filter.** No `is_late`, no `is_overdue`, no
   `is_open`. A stored flag needs a writer that runs every midnight; a formula
   field is virtual and a filter naming one silently matches nothing. Ask
   `status` and `due_date` directly — they are stored and indexed.
6. **`sharingModel` is mandatory and fail-closed.** Unset means private, and the
   publish linter errors on it (ADR-0090 D1/D7). State it deliberately.
7. **Author hierarchy scopes normally; the enterprise edition resolves them.**
   `readScope: 'own_and_reports' | 'unit' | 'unit_and_below' | 'org'` (ADR-0057)
   are resolved by `@objectstack/security-enterprise`, which enterprise
   deployments already carry. Do **not** build an application-level fallback,
   and do **not** add `hierarchy-security` to `requires` — that would fail an
   open-edition boot. In this open-edition checkout those scopes resolve to
   owner-only, so a manager view will show you only your own rows: that is
   expected here, and not a bug to chase.
8. **English is the source language.** Every authored label gets an `en` entry;
   `zh-CN` is hand-translated. Do not hard-code display text in a hook or flow.
9. **Metadata first — a handler is the last resort, not the first.** This is an
   ObjectStack application. Objects, views, flows, jobs, datasets, permission
   sets and actions are the primary tools; a hand-written handler is what you
   reach for when none of them can express the thing.
   **Before writing a handler, check whether the platform already has a
   declarative way to do it.** The spec is on disk — `@objectstack/spec` ships
   its Zod sources — and the answer is usually a key you have not read yet.
   **If the platform genuinely cannot express it, file an issue against
   `objectstack-ai/objectstack` and say so on the card.** Do not quietly write
   around the gap. A workaround in application code is how a platform gap
   becomes permanent and invisible: it works, nobody upstream ever hears about
   it, and the next application writes the same workaround from scratch.
   `test/flow-predicates.test.ts` is what a *declared* workaround looks like —
   labelled a stopgap, pointing at objectstack#14089, and built to be deleted.

## Landing your work

Branch `claude/issue-<n>-<slug>` off `main`, in your own worktree. Push the
branch and open a **draft PR** referencing the issue. All four gates must be
green in the PR before you hand it back:

```bash
pnpm validate && pnpm typecheck && pnpm test && pnpm build
```

## Product invariants — do not "improve" these away

These are the product, not preferences. If a task seems to require breaking one,
stop and raise it on the issue instead of working around it.

- One task has exactly **one** owner.
- Dispatch is idempotent on `(duty, owner, period_key)`.
- **Standing** duties never generate tasks.
- Managers do not enter status. Assigning is their only write.
- Completion never requires evidence, a note, or a percentage.
- `duly_log_entry` never enters a metric, a ranking, or a comparison.
- Item counts are never ranked or compared, anywhere in the UI.
