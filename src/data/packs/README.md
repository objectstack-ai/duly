# Catalog packs

A **pack** is a ready-made catalog of recurring duties for one industry: who
does what, how often, and what record shows it was done. Turn one on, and a
new Duly opens with a real catalog you can edit, instead of an empty table.

A pack is **data only**. It adds rows to the role catalog (`duly_catalog_item`),
the same rows you would otherwise import from a spreadsheet. It adds no
screens, fields or automation, and it creates no people, duties or tasks.

> **A pack is a starting point, not legal advice.** Every pack here is
> written from public sources. It is not a compliance opinion, not
> certification advice and not any company's actual list. Check it against the
> rules that apply to your plant, then change it until it describes your plant.

## The packs in this repo

| Id | What it covers | Positions | Duties |
|:---|:---|:---|:---|
| `food-safety` | Recurring food-safety duties of a food manufacturer (食品生产企业食品安全周期性履职): the PRC Food Safety Law, GB 14881-2013, SAMR Order No. 60 (日管控 / 周排查 / 月调度) and HACCP | 8 | 38 |
| `iso-9001` | Recurring duties of an ISO 9001 quality management system, for a manufacturer or a service business holding the certificate (ISO 9001 质量管理体系周期性履职): internal audit, management review, external providers, calibration, nonconforming output, documented information, customer satisfaction | 9 | 39 |

The `iso-9001` pack cites ISO 9001:2015 by **clause number and clause title
only**, in Chinese through GB/T 19001-2016, the identical national adoption.
The standard's text is copyrighted and none of it is reproduced: each duty's
wording is the pack's own. Its certification-audit row cites no clause,
because certification is the certification body's scheme, not a clause of
the standard.

## Turn a pack on

Packs are chosen with one environment variable, `DULY_PACK`. It is read when
the app is compiled, and every `pnpm dev` / `pnpm demo` compiles, so a pack takes
effect on the next start.

| You want | Run |
|:---|:---|
| An empty app (the default) | `pnpm dev` |
| An empty app with the food-safety catalog in it | `DULY_PACK=food-safety pnpm dev` |
| The same, in Chinese | `DULY_PACK=food-safety DULY_DEMO_LOCALE=zh-CN pnpm dev` |
| An empty app with the ISO 9001 catalog in it | `DULY_PACK=iso-9001 pnpm dev` |
| The demo (it loads `food-safety` by itself) | `pnpm demo` / `pnpm demo:zh` |
| The demo with the ISO 9001 pack instead | `DULY_PACK=iso-9001 pnpm demo:zh` |
| The demo without the pack | `DULY_PACK=none pnpm demo` |

On Windows, set the variable first (`set DULY_PACK=food-safety`, or
`$env:DULY_PACK="food-safety"` in PowerShell), then run the command.

- **Language.** A pack writes each row in one language: Chinese when
  `DULY_DEMO_LOCALE=zh-CN`, English otherwise. The variable is the same one the
  demo uses. Starting a second time in the other language adds the other
  language's rows next to the first ones, so start clean
  (`rm -rf .objectstack/data`) when you switch.
- **One pack, or several.** Naming a pack loads that pack and no other, the
  demo's default included: `DULY_PACK=iso-9001 pnpm demo` has no food-safety
  rows. To load several, separate their ids with commas:
  `DULY_PACK=food-safety,iso-9001`.
- **A typo stops the start.** An id that names no pack is refused with the list
  of ids there are. It never loads nothing quietly.

## What happens to your edits

The pack writes a row **only when no row of that name exists yet.** Once it is
in, the row is yours: change the wording, the frequency or the position, and a
later start with the pack still on leaves your version alone. The row's
**name** is how the pack recognises it. Rename a row, and the pack sees its
own row as missing and adds it again.

A row you **delete** comes back on the next start with the pack on, because
it is missing again. So once the catalog is yours, **turn the pack off**:
start without `DULY_PACK` (or with `DULY_PACK=none`). Everything the pack
wrote stays; it is ordinary data.

To remove a pack's rows entirely, turn the pack off, then delete the rows on
**Duly → Setup → Role catalog** (select them, then delete). On a development
machine, `rm -rf .objectstack/data` starts from nothing.

## From the catalog to people's work

A catalog row is a duty **template** for a position. Nobody owes it yet. To
hand it out, use **Apply role catalog** on the role catalog: pick the position
and the people who hold it, and each of them gets their own duty for every
active row of that position. Those duties then go through confirmation and
approval and are dispatched on their cadence. See [Getting started](../../../docs/getting-started.md).

## The row shape

Each pack is one file, `src/data/packs/<pack-id>/pack.ts`. Every duty is one
entry in its `duties` list, one column per line, in this order:

```ts
{
  position: 'qc',
  name: { zh: '检验与监控仪器校准核查', en: 'Instrument calibration check' },
  done: { zh: '核对温度计、压力表……', en: 'Confirm that thermometers, pressure gauges…' },
  evidence: { zh: '仪器校准台账和校准证书。', en: 'The calibration register and the certificates.' },
  form: 'recurring', frequency: 'monthly', dueAnchor: 'period_start', dueOffsetDays: 5, leadDays: 7, graceDays: 3,
  reference: gb14881('5.2.2', '监控设备', 'monitoring equipment'),
},
```

| Column | Becomes | What to write |
|:---|:---|:---|
| `position` | Position | A key from the pack's `positions` list, such as `qc`. The list gives each key its name in both languages, and that name is what the catalog shows. Positions here are plain names; you do not need to set them up anywhere first. |
| `name` | Duty | The duty in a few words, in Chinese (`zh`) and English (`en`). **It must be unique**, across this pack, every other pack and the demo catalog. It is the key the pack recognises the row by. |
| `done` | What "done" means | One or two sentences: what someone has actually done when this is done. |
| `evidence` | added to What "done" means, as **Evidence to keep: …** / **留存证据：…** | The record a plant keeps to show it was done. This is guidance. Duly never makes someone attach evidence to complete a task. |
| `form` | Form | `recurring` (has a cadence), `standing` (an ongoing responsibility that is never "done", only confirmed) or `one_off`. |
| `frequency` | Frequency | `daily`, `weekly`, `fortnightly`, `monthly`, `quarterly`, `semiannual` or `annual`. Recurring rows only. |
| `dueAnchor` | Due date anchored to | `period_start` or `period_end`. Recurring rows only. |
| `dueOffsetDays` | Offset | Whole days from the anchor day. From the start: 0 is the first day and 4 the fifth. From the end: 0 is the last day and -3 three days before it. Recurring rows only. |
| `leadDays` | Lead time | How many days before the due date the task appears. Recurring rows only. |
| `graceDays` | Grace | Days after the due date before the task counts as late, from 0 to 30. Not on standing rows. |
| `reference` | Reference | Optional. The law, standard or clause the duty comes from, in both languages. Give an article or clause number only where you checked it against the published text, and leave the column out where there is no single source. |

A **standing** row leaves out all five cadence columns. A **one-off** row keeps
only `graceDays`. The app refuses a row that breaks either rule, so the start
tells you, rather than a duty quietly going wrong.

### Add one duty

1. Open the pack's file, such as `src/data/packs/food-safety/pack.ts`.
2. Copy an entry from the same position and change it.
3. Restart with the pack on. The new row is in the role catalog, and the rows
   you already had are left alone.

To take a duty out of the pack, delete its entry. That stops the pack adding
it to a new database. A database that already has the row keeps it until you
delete it there (see above).

### From a spreadsheet

A spreadsheet with one row per duty maps onto this file column for column.
Lay it out with the headers `position`, `name_zh`, `name_en`, `done_zh`,
`done_en`, `evidence_zh`, `evidence_en`, `form`, `frequency`, `dueAnchor`,
`dueOffsetDays`, `leadDays`, `graceDays`, `reference_zh`, `reference_en`, and
each row becomes one entry above. If you only want your own catalog and not a
pack, you do not need this file at all: import the spreadsheet on the role
catalog's **Import** button ([samples/catalog-items.csv](../../../samples/catalog-items.csv)
is the template).

### A new pack

1. Copy `food-safety/` to `src/data/packs/<your-pack-id>/`. Ids are lowercase
   and hyphenated.
2. Give it its own `id`, `title`, `positions` and `duties`.
3. Add it to `CATALOG_PACKS` in `src/data/packs/index.ts`.
4. Run `pnpm verify`. `test/catalog-pack.test.ts` checks every pack in that
   list: both languages on every string, unique names, no name the demo
   already uses, every position used, every column within its limit. It also
   starts the app with the pack on, in both languages, and checks that every
   row landed.
