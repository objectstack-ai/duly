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

Metadata mistakes fail **silently at runtime**. A bare field reference in a
predicate (`done` instead of `record.done`) evaluates to `null` and hides the
action on every record; a dangling widget binding renders an empty chart.

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
2. **Barrels.** Each `src/<type>/index.ts` re-exports; the config collects with
   `Object.values()`. A file not in its barrel is dead metadata that type-checks.
3. **Hooks are registered in `defineStack({ hooks })`**, not collected from the
   objects barrel. An unregistered `*.hook.ts` never runs.
4. **Predicates are CEL** — `record.<field>`, never bare `<field>`.
5. **Never store what you can filter.** No `is_late`, no `is_overdue`, no
   `is_open`. A stored flag needs a writer that runs every midnight; a formula
   field is virtual and a filter naming one silently matches nothing. Ask
   `status` and `due_date` directly — they are stored and indexed.
6. **`sharingModel` is mandatory and fail-closed.** Unset means private, and the
   publish linter errors on it (ADR-0090 D1/D7). State it deliberately.
7. **Hierarchy scopes need the enterprise resolver.** `readScope: 'unit_and_below'`
   and friends resolve to owner-only — silently, with no error — unless
   `@objectstack/security-enterprise` is installed. Any feature relying on them
   must say so in its issue and its docs.
8. **English is the source language.** Every authored label gets an `en` entry;
   `zh-CN` is hand-translated. Do not hard-code display text in a hook or flow.

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
