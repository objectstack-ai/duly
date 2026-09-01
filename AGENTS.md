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
unregistered hook never runs. `pnpm validate` catches most of them — including
a bare field reference on every predicate surface but one. Rule 4 below says
which one, and why it is the exception.

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
   surface: object validation rules, field `requiredWhen` / conditional rules,
   action `visible` / `disabled`, sharing rules, hook conditions, and flow node
   and edge conditions.

   *What decides whether the gate catches you is SCOPE, not which surface you
   are on.* An expression is evaluated either with the record bound as the
   `record` namespace and nothing at top level (**record scope**), or with the
   record's fields additionally flattened into top-level variables
   (**flattened scope**). `validate` judges a bare identifier only in the first.

   **Record-scoped surfaces — `validate` enforces this, and the failure really
   is `null`.** Object validation rules, field conditional rules, action
   `visible` / `disabled`, sharing rules and hook conditions all bind the record
   as a namespace only, so a bare name binds nothing, the expression evaluates
   to null, and the rule or action silently never fires. `validate` catches it
   before it ships. Measured on `@objectstack/cli` 17.2.0, mutating
   `duly_task`'s `skip_needs_reason` rule to `status == "skipped" && …` exits 1
   with:

   > object 'duly_task' · validation 'skip_needs_reason': bare reference
   > `status` — a formula/validation expression binds the record as the
   > `record` namespace, not at top level, so `status` resolves to nothing and
   > the expression silently evaluates to null. Write `record.status`.

   A misspelt **qualified** read is caught everywhere, flows included:
   `record.needs_colection` in a flow condition gives ``unknown field
   `needs_colection` on `duly_assignment` — did you mean `needs_collection`?``.

   **Flow node and edge conditions are the one exception — no gate at all.**
   They run in flattened scope, where a bare name may genuinely be a flow
   variable (a loop iterator, a `get_record` output, an assignment target), so
   the platform's `collectBoundRecordReads` deliberately never reads a bare
   identifier as a record reference. The same predicate written
   `status == "dispatched"` in a flow start condition passes `validate` with
   **exit 0**.

   *And in a flow the failure is not `null` either.* A bare `status` there
   **resolves** — to the flattened field, or to a same-named flow variable that
   was seeded first and **shadows** it. That shadowing case is the subtler bug:
   the predicate reads correctly and silently means something else. When a name
   resolves to nothing the engine **throws** (ADR-0032 §1c: no silent fallback —
   a non-`ok` result is a real fault, not a false condition). So on this one
   surface the outcomes are "silently means something else" and "loud runtime
   fault", never the quiet null of the record-scoped surfaces above.

   Filed upstream as **objectstack-ai/objectstack#14089**. Until it lands,
   `test/flow-predicates.test.ts` is a repo-local **stopgap** covering exactly
   the unguarded surfaces — flow node and edge conditions, walked over
   `dulyFlows`, with `dulyJobs` walked as a tripwire — and it is written to be
   deleted when #14089 ships, not maintained.
5. **Never store what you can filter.** No `is_late`, no `is_overdue`, no
   `is_open`. A stored flag needs a writer that runs every midnight; a formula
   field is virtual and a filter naming one silently matches nothing. Ask
   `status` and `due_date` directly — they are stored and indexed.
6. **`sharingModel` is mandatory and fail-closed.** Unset means private, and the
   publish linter errors on it (ADR-0090 D1/D7). State it deliberately.
7. **A hierarchy scope REQUIRES `requires: ['hierarchy-security']`. Omitting it
   is an author-time hard error, not a silent fallback.**
   `readScope`/`writeScope` `'own_and_reports' | 'unit' | 'unit_and_below'`
   (ADR-0057) are the hierarchy scopes, resolved by
   `@objectstack/security-enterprise`. `objectstack.config.ts` already declares
   the capability — you should not need to touch it — and you author the scopes
   normally. Build no application-level fallback.

   **Grant one without the declaration and `defineStack` refuses to load**, in
   `validateHierarchyScopeCapability`. It is not the config file being fussy;
   it is the platform closing the exact hole this rule used to tell you to live
   with. The platform's own words:

   > A stack that uses one MUST declare `requires: ['hierarchy-security']`;
   > otherwise the open runtime would silently fail closed to owner-only (the
   > metadata would lie, ADR-0049). **This makes that an authoring-time error
   > instead.**

   Because the check runs inside `defineStack()`, an undeclared scope takes
   `validate`, `build` **and** every test that imports the config — so the
   symptom is the whole suite going red at once, not one assertion.

   **Declaring it does NOT fail an open-edition boot.** Measured on this
   checkout with `@objectstack/security-enterprise` **not** installed:
   `validate`, `typecheck`, `test` and `build` all exit 0, the kernel logs
   `Bootstrap complete`, and `validate` prints exactly one warning naming the
   package that provides the capability. **That warning is the expected state
   of this repo — do not silence it.** The only two ways to make it go away are
   installing the enterprise package (deliberately not done here) and deleting
   the declaration (which puts the hard error back).

   In this open-edition checkout the scopes then resolve to **owner-only**, so
   a manager view shows you only your own rows. That is the edition, not a bug
   to chase; verifying manager visibility for real needs an enterprise runtime
   and a populated business-unit tree.

   ⛔ **`org` is not a hierarchy scope** and passes the check with no
   declaration at all. That is the trapdoor: it is the nearest thing to hand
   when a scope will not load and you want "some visibility for managers", and
   it discloses every row in the tenant. Depth for managers is
   `unit_and_below`. Narrower than intended is visible and fixable;
   `org` is neither.
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
