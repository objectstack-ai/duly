# Configurability — what a customer can change without code

**Verdict.** On `@objectstack/*` **17.3.0** (what this repo's lockfile installs;
18.1.0 is the newest on npm and was not measured), a customer's administrator
can run Duly's *content* alone: load, edit and retire catalog items, set every
duty's frequency, anchor, offset, lead and grace, build the business-unit tree
and its membership, create positions, clone a permission set and bind it to a
position — all on ordinary console screens, and all of it survives a rebuild
and restart because it is data. What they cannot change is anything Duly
*declares*: the frequency vocabulary, the default lead and grace days, the
progress phrases, the stagnation thresholds, the reminder and dispatch timing,
and the set of languages. The Studio opens Duly as **"Read-only · browsable"**,
and the metadata API refuses `object`, `field`, `dataset`, `page`, `job` and
`flow` overlays outright (`NOT_OVERRIDABLE`). The texts in between — dashboard
tiles, list views, email templates, translations — are writable through the
metadata API only, with no console screen, and two of those doors misbehave:
a dashboard or view overlay is saved and then hidden behind the package's own
translation bundle, and an email-template overlay is reverted on the next boot
while the API keeps reporting it as active. The shortest list of platform fixes
that would let a customer do the rest: (1) org overlays for a package object's
select options and field defaults; (2) org overlays for datasets and pages, or
parameters on them, so a threshold can move in one place; (3) let an org
overlay beat the package's translation bundle; (4) make email-template overlays
survive a boot and key them per locale; (5) console screens for translation and
email-template overlays; (6) runtime-addable locales; (7) an org-level knob for
flow schedule offsets and job schedules.

## How this was measured

- **Platform:** every row is `@objectstack/*` 17.3.0 — `cli`, `runtime`,
  `rest`, `console`, `setup` and `platform-objects` all resolve to 17.3.0 in
  `node_modules/.pnpm`.
- **Boot:** `objectstack dev --compile --ui` on a free port with an empty
  SQLite home (`OS_HOME` pointed at a scratch directory), demo seed off, signed
  in as the minted dev admin (`admin@objectos.ai`), who is a **platform
  admin**. Every metadata write below needs the `manage_metadata` capability;
  no Duly permission set grants it (see `AGENTS.md`, "Who can customize a
  view"), so in a deployment these are writes for whoever holds
  `admin_full_access`.
- **Each change:** attempted through the console where a screen exists and
  through the same REST door the console uses (`PUT /api/v1/meta/<type>/<name>`,
  `POST`/`PATCH /api/v1/data/<object>`), then read back through
  `GET /api/v1/meta/<type>/<name>` (what the console renders),
  `GET /api/v1/meta/<type>/<name>/layers` (what is stored), and the backing
  `sys_*` rows.
- **Survival:** the server was stopped, `objectstack build` run (exit 0), the
  server booted again on the same database, and every value read back.
  "Survives" in the table means that rebuild-and-restart. A package version
  bump on an existing database was **not measured**.
- **Registry answer** (`GET /api/v1/meta`, per type): org overlay
  (`allowOrgOverride`) is allowed for exactly `view`, `dashboard`, `report`,
  `translation` and `email_template`. Every other type's overlay is refused
  with:

  > `[NOT_OVERRIDABLE] '<type>' is not allowOrgOverride in the registry.
  > Overlay-allowed: view, dashboard, report, translation, email_template. Set
  > OS_METADATA_WRITABLE to enable additional types at runtime.`

  `OS_METADATA_WRITABLE` is an operator environment variable on the server,
  not a Setup setting, so it is not "without code" for a customer and is not
  counted as reachable here.
- **Studio:** `/_console/studio` lists Duly under *"INSTALLED (READ-ONLY ·
  BROWSABLE)"* and says *"Code-loaded packages are read-only (browse only)"*.
  Inside it every pillar (Data, Automations, Interfaces) carries a *Read-only*
  badge. No row below is editable through Studio.

Placeholders in this document (`Placeholder Plant A`, `acme_reviewer`, …) are
invented values typed during the measurement.

## The matrix

Verdicts: **editable** · **editable but lost on redeploy** · **not reachable**.
"API only" means the write works but no console screen for it was found.

| Knob | Where it is authored | Editable at runtime? (17.3.0, measured) | Survives `objectstack build` + restart? | If not: platform gap |
|:-----|:---------------------|:-----------------------------------------|:-----------------------------------------|:---------------------|
| **Catalog items** — create, edit, retire | data: `duly_catalog_item` rows | **editable.** Duly app → *Catalog item* has *New*, *Import*, *Edit inline*; retire is the *Active* toggle. REST: `POST` 201, `PATCH` 200, `active: false` 200, read back. | **yes** — row unchanged after rebuild. | — |
| **Duty cadence per item / per duty** — frequency, anchor, offset, lead, grace | data: fields on `duly_catalog_item` and `duly_duty` | **editable.** Record form shows all five; `PATCH` to `quarterly` / lead 10 / grace 4 / offset −5 read back exactly. Catalog edits reach existing duties only through `duly_catalog_sync`; a duty's grace edit does not move `late_after` on tasks already dispatched (by design, `AGENTS.md` rule 5). | **yes** | — |
| **Frequency and anchor vocabulary** — the picklist itself (e.g. add "bi-monthly") | metadata: `Field.select` options in `catalog-item.object.ts`, `duty.object.ts` | **not reachable.** `PUT /api/v1/meta/object/duly_duty` with the full authored object → 403 `NOT_OVERRIDABLE` (`'object' is not allowOrgOverride`). `PUT /api/v1/meta/field/duly_task.progress` → 403 `not_overridable` (*"Fields are not standalone artifacts"*). Studio read-only. | n/a | Gap G1 — package object select options / defaults not org-overridable. |
| **Default lead, grace, offset** (7 / 0 / 0 on a new recurring item or duty) | metadata: field `defaultValue` in the same two objects | **not reachable** — same 403 as above; the only path is typing the value on each record. | n/a | Gap G1. |
| **Progress phrase options** — add, remove, reorder | metadata: `duly_task.progress` `Field.select` options | **not reachable** — `PUT` object 403 `NOT_OVERRIDABLE`. | n/a | Gap G1. |
| **Progress phrase wording** — relabel an existing phrase | metadata + translation bundle | **editable, API only.** `PUT /api/v1/meta/translation/<name>` with `objects.duly_task.fields.progress.options.on_time` → 200; the served option label changed for that locale only (`en` changed, `zh-CN` still `已按期完成`). No translation screen exists in Setup. | **yes** | Gap G3 — no console screen for translation overlays. |
| **Stagnation thresholds** (7 / 14 / 30 days) | metadata, in four places: `duly_stagnation` dataset measures, `duly_task.stalled` view filter, `duly_member` page filter, dashboard tile texts | **not reachable as one knob.** Dataset `PUT` → 403 `NOT_OVERRIDABLE`; page `PUT` → 403 `NOT_OVERRIDABLE`. The view filter *can* move (`{14_days_ago}` → `{21_days_ago}`, view overlay 200, served), and a dashboard overlay can rebind a tile among the shipped 7 / 14 / 30 measures (200, served `untouched_over_7d`) — so a customer can make the list and the tiles disagree, but cannot move 14 to 21 everywhere. | view and dashboard overlays: **yes** | Gap G2 — dataset and page not org-overridable (or not parameterisable). |
| **Dashboard tile titles and descriptions** | metadata: `duly_duty_health` widgets; text also in the `en` / `zh-CN` bundles | **dashboard overlay: saved but not shown.** `PUT /api/v1/meta/dashboard/duly_duty_health` → 200 *"Saved customization overlay"*; `/layers` `effective` carries the new title; the served `GET` and the console still show *"Not moving"*. The package translation is applied on read after the overlay. **Translation overlay: editable, API only** — `dashboards.duly_duty_health.widgets.not_moving_14d.title` → 200, console shows the new title. The dashboard page has no edit control. | **yes** (both overlays still stored and the translation still served) | Finding F1 — overlay shadowed by the package translation. Gap G3. |
| **List views** — columns, sort, filters, label | metadata: `src/views/*.view.ts` | **editable, API only** for structure (filter change above served). The view **label** shows F1: overlay label stored, served label still *"All tasks"*. | **yes** | Finding F1. |
| **Email template subject / body** | metadata: `src/email-templates/*`, projected into `sys_email_template` rows (one per name × locale) | **editable but lost on redeploy**, through the metadata door: `PUT /api/v1/meta/email_template/duly.task_overdue` → 200 `projectionApplied`, the `sys_email_template` row changed. After rebuild + restart all three metadata-door edits were back to the package text (boot rewrote them, `updated_at` = boot time) while `/layers` still reports the edit as `effective` and the overlay row stays `active`. Also: the overlay is keyed by `name` only — a `zh-CN` `PUT` replaced the `en` overlay of the same name. **Row edit:** `PATCH /api/v1/data/sys_email_template/<id>` → 200, and that row **did** survive the restart. The *Email Template* list exists at `/_console/apps/setup/sys_email_template` but is not in the Setup sidebar (sidebar lists *Notification Templates*, a different object). | metadata door: **no**. Row edit: yes on restart; package version bump not measured. | Finding F2. Gap G3. |
| **Reminder timing and dispatch schedule** (lead / due-soon / overdue sweeps; daily dispatch) | metadata: `reminders.flow.ts` schedule offsets, `dispatch.job.ts` | **not reachable.** `PUT /api/v1/meta/job/duly_dispatch` → 403 `not_overridable` (*"Declare it in source … and redeploy"*); registry `flow`: `allowOrgOverride: false`. Studio *Automations* shows the flows read-only. | n/a | Gap G5. |
| **Positions** — create, rename | metadata: `src/security/positions.ts`, projected into `sys_position` | **editable.** Setup → *Positions* → *New* (`POST /api/v1/data/sys_position` 201, listed at once). The metadata door also saves (`PUT /api/v1/meta/position/acme_auditor` 200, label edit on `duly_member` 200), but neither reached `sys_position` — the list Setup shows — until the next boot. | **yes** (and the metadata-door edits appear only after it) | Finding F3. |
| **Permission sets** — change grants, bind to positions | metadata: `src/security/permission-sets.ts`, projected into `sys_permission_set` | **package sets: not reachable by design** — `PUT /api/v1/meta/permission/duly_member` → 403 *"declared by package 'ai.objectstack.duly' and is locked in this environment … Clone it instead"*. **Clone: editable** — the record page offers *Clone*; a cloned set saved under a new name (200) is listed in Setup. **Binding:** `POST sys_position_permission_set` (`position_id`, `permission_set_id`) 201, and the set's page lists the user *"via position duly_member"*. Editing a clone's grants through Studio was not measured (the set page links *"Design in Studio →"*). | **yes** | — (the lock is deliberate and its error names the way out) |
| **Business units and membership** | data: `sys_business_unit`, `sys_business_unit_member`, `sys_user_position` | **editable.** Setup → *Business Units* has *New*, *Import*, *Org Chart*; `POST` 201 on all three objects. Manager depth still resolves owner-only in the open edition (`AGENTS.md` rule 7). | **yes** | — |
| **Locale bundles** — wording of `en` / `zh-CN` | metadata: `src/translations/*` | **editable, API only** — translation overlay 200, served for that locale (see the two rows above). | **yes** | Gap G3. |
| **Locale bundles** — add a language (e.g. `fr`) | `objectstack.config.ts` `i18n.supportedLocales` | **not reachable.** A `fr` translation overlay is accepted (200) and stored, but `Accept-Language: fr` is served English: the supported list is compile-time. Setup → *Localization* sets only the default language. | n/a | Gap G4. |

## Findings and gaps, for filing

None of these is worked around in this repo, and none is filed from this card;
each carries the evidence a platform issue needs.

**F1 — An org overlay on a dashboard or view is shadowed by the package's
translation bundle.** Reach: `PUT /api/v1/meta/dashboard/duly_duty_health`
answers 200 *"Saved customization overlay"*; `GET` of the same item, and the
console, keep serving the package title; `/layers` shows the edit in both
`overlay` and `effective`. Seam: `RestServer.translateMetaItem` applies
`translateMetadataDocument` after the overlay merge and passes `packagedBase`
for `object` only, so for every other type a bundled translation of the
original string wins. Dedupe words: *overlay shadowed by translation*,
*dashboard widget title overlay ignored*, *translateMetaItem packagedBase*,
*view label overlay*.

**F2 — An email-template overlay is reverted in `sys_email_template` at the
next boot while the metadata API still reports it active, and the overlay is
one per name rather than per locale.** Reach: `PUT
/api/v1/meta/email_template/duly.task_overdue` → 200 `projectionApplied`; after
`objectstack build` and a restart the row is back to the package subject,
`/layers` `effective` still carries the edit. A second `PUT` with
`locale: 'zh-CN'` replaced the stored `en` overlay. The delivery path renders
from the `(name, locale)` row (`src/email-templates/reminders.email-template.ts`
header), so the edit stops reaching inboxes without any signal. Dedupe words:
*email template overlay lost on restart*, *sys_email_template projection
reverted*, *email_template overlay locale*, *projectionApplied*.

**F3 — Positions saved through the metadata API do not appear in
`sys_position` until the next boot.** Reach: `PUT
/api/v1/meta/position/acme_auditor` → 200 *"Saved position … state=active"*;
`GET /api/v1/data/sys_position` (what Setup → *Positions* lists) does not
include it until a restart, when it appears. A permission-set `PUT` on the same
store answers with `projectionApplied` and is listed at once. Dedupe words:
*position projection sys_position*, *metadata position not listed*,
*position overlay boot only*.

**Gaps (capability, not defects).** These are the platform's declared
behaviour today; they are listed because a template customer needs them.

- **G1** — package `object` / `field`: select options and `defaultValue` are
  not org-overridable (frequency vocabulary, default lead and grace, progress
  phrases). Dedupe words: *org overlay object select options*, *picklist
  extension package object*, *field defaultValue overlay*.
- **G2** — `dataset` and `page` are not org-overridable, so a threshold
  authored there cannot move. Dedupe words: *dataset allowOrgOverride*,
  *page overlay NOT_OVERRIDABLE*, *dataset measure parameter*.
- **G3** — no console screen for `translation` or `email_template` overlays,
  and the *Email Template* list is not in the Setup sidebar (objectui). Dedupe
  words: *translation editor Setup*, *email template Setup navigation*,
  *dashboard edit control*.
- **G4** — `supportedLocales` is compile-time; a stored translation for an
  unlisted locale is never served. Dedupe words: *add locale runtime*,
  *supportedLocales Setup*, *translation fallback unsupported locale*.
- **G5** — `flow` and `job` are not org-overridable, so a schedule offset or
  cron cannot be tuned per deployment. Dedupe words: *flow schedule override*,
  *job cron org override*, *time_relative offsetDays configurable*.

## What this means for the template

The M4 promise — *install it, load your own catalog, run it without us* — holds
for the catalog, the people and the org structure today. It does not yet hold
for anything a customer would call "settings": the vocabulary, the defaults,
the thresholds and the timing ship as code, and changing them means a fork.
The texts are halfway: writable, but only by someone who knows the metadata
API and, for dashboards and email, only once F1 and F2 are fixed.
