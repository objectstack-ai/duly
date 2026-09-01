# Security — what ships, and what a real rollout still has to do

Duly declares three positions, three permission sets and no sharing rules. This
page is the other half: the bindings a package is not allowed to make, the
enterprise dependency a real deployment needs, and the two grants that are
currently narrower than the product intends.

Nothing here is advice about writing security code. There is no security code:
`definePosition`, `definePermissionSet` and `defineSharingRule` are the whole
toolkit, and a permission check written into a handler would be one the
platform's RLS does not know about, does not apply on the REST path, does not
apply over MCP, and never appears in an audit.

---

## The model in one table

| | `duly_member` | `duly_manager` | `duly_admin` |
|:---|:---|:---|:---|
| Who | everyone who owns duties | anyone with reports or a unit | catalog owners, rollout admins |
| `duly_task` | create / read / edit · read **own** · write **own** | inherited | inherited |
| `duly_duty` | create / read · read **own** · write **own** | inherited | **+ edit** · read **org** · write **own** |
| `duly_log_entry` | full control · read **own** · write **own** | inherited | inherited |
| `duly_catalog_item` | read | inherited | **+ create / edit / delete** · write **org** |
| `duly_assignment` | read · read **own** | **+ create / edit** · write **own** | inherited |
| Capabilities | `duly.task.update_status` | inherited | **+ `duly.catalog.apply`, `duly.catalog.sync`** |

"Inherited" is literal: `src/security/permission-sets.ts` builds each map by
spreading the one above it, and `test/security.test.ts` asserts that every
non-overridden entry is the same object. A grant is written once.

Each set is self-contained, so binding **one set to one position** is a correct
deployment — a manager holding only `duly_manager` still has every member grant.

### Three things the table does not say, and should

**A manager writes nothing below them.** Every read widening above is on the
read axis. `writeScope` never leaves `own` on `duly_task` or `duly_duty` in any
set, administrators included. A manager's only write is raising an assignment;
the fan-out then produces one independently-owned task per assignee, and status
entry belongs to the person who owns the work. This is enforced, not intended:
`test/security.test.ts` walks all three sets on both objects.

**An administrator is not a super-user.** No `viewAllRecords` or
`modifyAllRecords` anywhere, no `'*'` wildcard, no `adminScope`. The org-wide
correction path is `duly_catalog_sync` — bounded to cadence fields, gated by a
capability only `duly_admin` holds, and reportable. A correction typed into
somebody's duty record would be none of those things, which is why
`duly_admin`'s `allowEdit` on `duly_duty` still sits behind `writeScope: 'own'`.

**`duly_log_entry` is closed to everyone but its owner.** Including the
administrator. See below.

---

## ⛔ The work log

`readScope: 'own'` for every position, no exceptions, no admin override, no
sharing rule. This is a product invariant and it outranks convenience: a log
people believe their skip-level can read is a log nobody keeps, and the module
then stops producing the one record it exists to produce.

The product allows exactly one widening — a record's own
`visibility: 'manager'`, reaching **that person's manager and nobody else**.
**That widening is not shipped, because this platform version cannot express
it.** A criteria sharing rule's recipient is a single static principal resolved
once per rule, never per matched record, so "the owner's manager" has nothing to
resolve through; the nearest expressible recipient, `position: 'duly_manager'`,
would hand every marked entry to every manager in the tenant, which is the
disclosure the invariant exists to prevent. RLS is not a way around it either —
on a `private` object the RLS filter is AND-composed under the sharing layer's
owner filter, so it can only narrow. The measurement is in
`src/security/sharing-rules.ts`; the upstream issue is
**objectstack-ai/objectstack#14103**.

So today `visibility: 'manager'` stores an intention and grants nothing. That is
fail-closed and it is the right way to be wrong here: a missing grant is visible
and fixable, a grant that reached the wrong people is neither.

The same gap narrows `duly_assignment`, which should be readable by the people
it is addressed to (`assignees`) and is instead readable by whoever raised it.
Assignees still see their own fanned-out `duly_task`, which is the row they work.

---

## An enterprise runtime is a product dependency

The manager model is built on the ADR-0057 depth scopes
(`own_and_reports`, `unit`, `unit_and_below`, `org`). Those are resolved by
**`@objectstack/security-enterprise`**. Without it the platform has no manager
chain and no business-unit tree resolver, so depth collapses to owner-only.

For a real rollout that means:

```bash
pnpm add @objectstack/security-enterprise
```

and adding it to `plugins[]`. Manager visibility is not a feature you can verify
on an open-edition checkout; a manager view there shows you your own rows, and
that is the edition, not a bug.

### ⛔ Two manager grants are currently narrower than this table implies

`duly_manager` on `duly_task` and `duly_duty`, and `duly_admin` on `duly_task`,
should read `unit_and_below`. They are authored `own`.

The reason is not caution. `defineStack` **refuses to load** a permission set
carrying `unit`, `unit_and_below` or `own_and_reports` unless the stack declares
`requires: ['hierarchy-security']` — it is a hard error, not the silent fallback
this repo's own notes describe, and it takes `validate`, `build` and every test
that imports the config. This package may not add that declaration
(`objectstack.config.ts` is off-limits to feature work, and a repo rule forbids
it), so the only authorable depths here are `own` and `org` — and `org` would
hand every manager every task in the tenant.

`own` is also exactly what an open-edition runtime would have *resolved*
`unit_and_below` to, so nothing about today's behaviour differs. What differs is
that the declaration is now honest, and an enterprise deployment inherits an
under-grant it can see rather than a grant that quietly never worked.

The three affected grants are recorded machine-readably in
`HIERARCHY_SCOPES_DEFERRED` (`src/security/permission-sets.ts`) and pinned in
both directions by `test/security.test.ts`: widen a grant without deleting its
row and the test fails; delete a row without widening the grant and the test
fails. Tracked as **#46**, which also carries the measurement showing the
"declaring it fails an open-edition boot" belief to be false.

---

## Binding positions to permission sets is a rollout step

A package cannot do this, and the omission is not an oversight in this app.
`PositionSchema` has no `permissionSets`, no `permissions` and no `users` key and
rejects all three by name: capability reaches a position **only** through
`sys_position_permission_set` rows, which an administrator creates in Setup
(ADR-0090 D3). The one declarative suggestion the platform offers, `isDefault`,
targets the built-in `everyone` anchor and is unavailable to these sets anyway —
the ADR-0090 D5/D9 anchor tier refuses any set carrying `systemPermissions` or a
delete bit, and `duly_member` carries both.

So a fresh install boots with three positions, three permission sets and **zero
bindings**, and every persona is denied until someone does this:

| Position | Bind this permission set |
|:---|:---|
| `duly_member` | `duly_member` |
| `duly_manager` | `duly_manager` |
| `duly_admin` | `duly_admin` |

Then assign people to positions (`sys_user_position`), anchored to their business
unit — the anchor is what the depth scopes resolve against, so an unanchored
assignment is a manager who sees nothing.

Everyone gets `duly_member`. Managers and administrators get their own set
*instead of*, not in addition to, the member set — each one already contains it.

---

## Actions: the capability gate is the only boundary

All five actions run their handlers against `ctx.engine`, the trusted facade —
context-less and RLS/FLS-bypassing **by design**. Object permissions never see
those writes, so `requiredPermissions` (ADR-0066 D4: 403 on the platform action
route and the MCP bridge, mirrored as a UI hide) is the entire boundary.

| Action | Capability | Held by |
|:---|:---|:---|
| `duly_catalog_apply` | `duly.catalog.apply` | `duly_admin` |
| `duly_catalog_sync` | `duly.catalog.sync` | `duly_admin` |
| `duly_task_complete` | `duly.task.update_status` | all three |
| `duly_task_undo` | `duly.task.update_status` | all three |
| `duly_task_skip` | `duly.task.update_status` | all three |

Apply and sync are **separate capabilities** although one set grants both.
Applying a catalog to a new hire is onboarding; syncing rewrites authored cadence
on duties people are already working to — org-wide when `position_code` is
omitted — and is reportable only after the fact. A deployment that wants an
onboarding administrator who cannot rewrite the org's cadence can express that by
binding a set granting only the first.

Two things this table is not. `visible` on the task actions is a **UI hide**: the
button disappears, the route does not. And each task handler's re-read of its
subject under the caller's scope is a **row** check ("is this row yours to see"),
which is load-bearing and stays — but it does not answer "is completing a task
something you may do at all". A read-only auditor with unit-wide visibility
passes the row check and must fail the capability gate. That is why both exist.

---

## Verifying a deployment

```bash
pnpm validate    # reports "Security: 3 Positions  3 Permissions"
pnpm test        # test/security.test.ts asserts every declared scope
```

`test/security.test.ts` asserts the **authored** metadata, never resolved rows —
on an open-edition checkout a row count measures the edition, not the
declaration, and would go green on the day someone deleted a scope. To see
manager visibility actually resolve you need an enterprise runtime and a
populated business-unit tree.
