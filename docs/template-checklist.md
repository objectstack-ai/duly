# Template-readiness checklist

`create-objectstack` copies this repository as somebody else's starting point.
What it copies has to read as *their* app on the first boot: empty, with the
worked example one command away and nothing else; no customer or demo company
named outside the fixture that owns it; package metadata a scaffold can keep.

Every row below is a **measurement on a fresh clone**, not a reading of the
source. The last measurement is recorded with each row: the commit, the
command and what it answered. Re-run the commands before you change a row's
verdict; a row nobody re-measured is a row that has drifted.

**Last measured:** `004380e` (main after #138), `@objectstack/*` 17.3.0,
Node 22.22.0, pnpm 10.28.0, 2026-10-26.

| # | Item | Verdict |
|:--|:-----|:--------|
| 1 | `pnpm dev` boots empty, with the dev admin able to sign in | ✅ |
| 2 | No demo rows unless `pnpm demo` | ✅ |
| 3 | `.objectstack/` and `dist/` are ignored | ✅ |
| 4 | No demo company or customer named outside `src/data/demo-*` and `samples/` | ❌ — 2 files keep the demo company by design, 11 files keep customer-deck references; see below |
| 5 | `package.json` name, description and version fit a scaffold | ✅ |
| 6 | Licence headers present | ✅ |
| 7 | The ten-minute path in [getting-started](getting-started.md) runs end to end | ❌ — two platform gaps, see below |

## How to measure

```bash
git clone https://github.com/objectstack-ai/duly.git && cd duly
pnpm install --frozen-lockfile
pnpm dev --port 3917          # leave running; sign in from another shell
```

Sign in and count rows with the REST API the Console itself uses:

```bash
O=http://localhost:3917
curl -s -c /tmp/duly.cookies -H "origin: $O" -H 'content-type: application/json' \
  -d '{"email":"admin@objectos.ai","password":"admin123"}' \
  -o /dev/null -w 'sign-in %{http_code}\n' "$O/api/v1/auth/sign-in/email"
for o in sys_user sys_business_unit duly_catalog_item duly_duty duly_task duly_assignment duly_log_entry; do
  printf '%-20s ' "$o"
  curl -s -b /tmp/duly.cookies -H "origin: $O" "$O/api/v1/data/$o?top=1" | node -pe 'JSON.parse(require("fs").readFileSync(0)).total'
done
```

## 1 · Empty first boot, with a way in

Fresh clone, no `.objectstack/` and no `dist/` before the boot, `DULY_DEMO_SEED`
unset.

| Measured | Answer |
|:---|:---|
| `pnpm install --frozen-lockfile` | exit 0, 18.4 s |
| `pnpm dev --port 3917` | serving within 20 s; banner ends `Press Ctrl+C to stop` |
| sign in `admin@objectos.ai` / `admin123` | `200`, the account is named `Dev Admin` |
| `sys_user` | 1 (the dev admin) |
| `sys_business_unit` · `duly_catalog_item` · `duly_duty` · `duly_task` · `duly_assignment` · `duly_log_entry` | 0 · 0 · 0 · 0 · 0 · 0 |
| `sys_user_permission_set` | 2, both the dev admin's own platform bindings |

The boot prints one diagnostic, from the platform rather than from Duly: the
freshly compiled artifact's `required: true` fields are converted forward to
`storage.notNull: true` (ADR-0087, `field-required-notnull-explicit`), with a
note that the conversion retires from the load path in protocol 18. It does
not stop the boot, and it is recorded here because it is the first thing a new
owner of the template reads.

## 2 · Demo rows only on `pnpm demo`

Same clone, `.objectstack/` and `dist/` deleted, then `pnpm demo` (port 3918).

| Object | `pnpm dev` | `pnpm demo` |
|:---|---:|---:|
| `sys_user` | 1 | 13 |
| `sys_business_unit` | 0 | 6 |
| `duly_catalog_item` | 0 | 20 |
| `duly_duty` | 0 | 31 |
| `duly_task` | 0 | 172 |
| `duly_assignment` | 0 | 2 |
| `duly_log_entry` | 0 | 15 |

Sign-in after `pnpm demo`: `200`. The demo still needs its priming boot to get
there (`scripts/demo.mjs`, objectstack-ai/objectstack#14157); retiring it is
#131, not this checklist.

## 3 · Local state is ignored

After both boots above, `git status --porcelain --ignored` prints exactly:

```
!! .objectstack/
!! dist/
!! node_modules/
```

Nothing untracked, nothing modified.

## 4 · No demo company or customer named outside the fixture

```bash
git grep -c -iE 'ardenline|安岭' -- ':!src/data/demo-*' ':!samples/'
git grep -c -iE '\bdeck\b|方案|pre-sales' -- src test docs/import
```

**The demo company, outside the fixture** — 2 files, both on purpose:

| File | Lines | Why it stays |
|:---|---:|:---|
| `docs/import/walkthrough.md` | 4 | It is the recorded import of `samples/`; its screenshots show those rows by name. |
| `test/seed-locale.test.ts` | 4 | It pins the demo fixture's own spellings in both languages. |

`README.md` no longer names it (it described the demo by its company name in
three places; it now says "a fictional manufacturer").

**References to the original customer's sales deck** — not met. Code comments
and test titles cite the deck's page numbers (`deck p20`, `方案 p7`) as the
reason for a design choice:

| File | Lines |
|:---|---:|
| `src/dashboards/duty-health.dashboard.ts` | 12 |
| `src/views/task.view.ts` | 8 |
| `test/views.test.ts` | 5 |
| `src/translations/zh-CN.ts` | 3 |
| `src/objects/task.object.ts` | 2 |
| `test/dashboard.test.ts` | 2 |
| `src/datasets/duty-health.dataset.ts` | 1 |
| `test/invariants.test.ts` | 1 |
| `test/seed-locale.test.ts` | 1 |
| `test/import-samples.test.ts` | 1 |
| `docs/import/walkthrough.md` | 1 (`pre-sales demo`) |

None of them reaches a screen, but each one tells the template's next owner to
go and read a document they do not have. The fix is to restate each reason in
the product's own terms; it sits outside the files this checklist's card was
allowed to touch, so it is listed rather than done.

## 5 · Package metadata

`package.json`: `name` `duly`, `version` `0.1.0` (kept), `private: true`,
`license` `Apache-2.0`, `description` "Duly — the ObjectStack template app for
recurring duties: define once, dispatch every period, see the state of play
without asking.", `keywords` for the scaffold's catalogue. No `repository`,
`author` or `homepage` field, deliberately: a scaffold copy would inherit them
and point at this repository.

## 6 · Licence headers

```bash
for f in $(git ls-files '*.ts' '*.mjs' '*.js'); do
  head -3 "$f" | grep -q 'Licensed under the Apache-2.0' || echo "MISSING $f"
done
```

104 of 104 source files carry `// Copyright (c) 2026 ObjectStack. Licensed under
the Apache-2.0 license.`; nothing printed. `LICENSE` is Apache-2.0.

## 7 · The ten-minute path

Walked on `pnpm dev` against an empty database, signed in as the dev admin,
through the endpoints the Console's own buttons post to. Step numbers are the
ones in [getting-started](getting-started.md).

| Step | Measured | Answer |
|:---|:---|:---|
| 2 · Business units | `POST /api/v1/data/sys_business_unit/import` | 6 created, 0 errors |
| 3 · People | `POST /api/v1/auth/admin/import-users`, `passwordPolicy: auto` | 12 created, 12 delivered as an email invitation to the dev outbox |
| 4 · Role catalog | `POST /api/v1/data/duly_catalog_item/import` | 21 created, 0 errors |
| 5 · Duties | `POST /api/v1/data/duly_duty/import` | 19 created, 0 errors; 18 `to_confirm`, 1 `to_review` |
| 6 · Confirm & approve | `PATCH duly_duty` → `to_review`, then → `approved`, as the admin | `200`, `200` |
| 7 · Dispatch | — | ❌ **no run-now door.** `duly_dispatch` is a nightly cron (`0 1 * * *`, UTC). `@objectstack/*` 17.3.0 has no CLI command, REST route or Console button that triggers a job on demand. |
| 8 · The owner signs in | invitation link → `reset-password` → sign-in | `200`; then `403 PERMISSION_DENIED` on `duly_task` and `duly_duty` until the person is given *Duly — team member* |
| 8 · The owner sees their duty | `GET /api/v1/data/duly_duty` as that person, member set bound | ❌ **total 0.** A duty they create themselves reads back (total 1). |

Two things fail, and neither is a step a reader can fix:

- **No run-now for the dispatcher.** The first tasks appear after the next
  01:00 UTC run, with `pnpm dev` still running. The ten-minute path is a
  ten-minute path up to step 6 and an overnight one after it.
- **An imported duty is invisible to its own owner.** The member set grants
  `readScope: 'own'`, which the platform resolves against the record's platform
  owner (`owner_id`), not against the duty's `owner` field. An import is written
  by the administrator, so `owner_id` is the administrator and the person named
  in `owner` is not the one who can read it.

Also observed, not a blocker: the invitation the People import sends is worded
as a password reset ("Reset your ObjectStack password … We received a request
to reset the password"), which reads oddly to someone who never had one.
