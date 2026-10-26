# Positioning

## Category

**Recurring obligation management** — sometimes sold as a *compliance calendar*.

Not a project tracker (Asana, Jira, Monday). Not a personal to-do app (Todoist,
Things). Not a GRC suite (ServiceNow IRM, LogicGate, AuditBoard). Duly sits in
the gap all three leave open: **work that repeats, is owed by a named person, and
has a consequence if it is late.**

Project trackers assume work is finite and planned. To-do apps assume the list is
personal and nobody else needs to see it. GRC suites assume a compliance team
owns the calendar and everyone else responds to their requests. The recurring
duties of an ordinary operating role fit none of those assumptions, which is why
they end up in a spreadsheet.

## Form

Duly is the **standard ObjectStack template app** and its reference
implementation — a platform asset, not a standalone product. It is used the way
a template is used: install it, load your own duty catalog or pick one of the
shipped industry packs, and run it without us. Everything beneath the catalog —
objects, views, dispatch, permissions, dashboards, translations — ships finished
and is yours to change as metadata rather than as a fork.

The thing it displaces is not a suite. It is the spreadsheet plus the chat
group: one person's list of what each role owes, and the group where the
reminders, the excuses and the "done" messages scroll past and are lost. Duly is
judged against that pair, on the first screen, by the person who maintains the
spreadsheet today.

## Beside EHS/QHSE suites, not against them

An EHS or QHSE suite stays the system of record for incidents, chemicals,
permits and environmental data. Duly models none of those. It is the duty layer
— *who owes which recurring obligation, in which period, and whether it was done
on time* — and it is owned by the operating roles themselves, not by the
compliance team that owns the suite.

Two things cross the boundary and nothing more is promised: a catalog item can
cite the suite's procedure or register as its `regulation_ref`, and a completion
in Duly is an owner and a timestamp, never a copy of the evidence the suite
holds. No connector between the two is part of the template.

## Who it is for

**Primary.** Organisations of 200–5,000 people where operating roles carry
regulated or standardised recurring duties, and where being late is visible to
someone outside the company:

- Manufacturing and process industry — EHS, quality, maintenance regimes
- Utilities, energy and infrastructure
- Financial services operations and regulated back-office
- Healthcare provider operations and accreditation
- Multi-site facilities, logistics and food service

**Who adopts it.** Two people, for two reasons. The operating manager who owns
the spreadsheet today — the EHS, quality, maintenance or operations lead whose
name is on the list and who cannot prove it was met — adopts it to stop being
the list. The platform team that wants a reference ObjectStack application
adopts it to read a complete app — objects, security, flows, dashboards,
translations, tests — written the way the platform intends, and to start their
own from it.

**Users.** Two, with sharply different needs.
*Individual contributors* need the week's obligations in one place and a tick
that takes a second. *Managers* need to know what is late and what is quietly
going nowhere, without asking anyone to file a report.

## The problem, stated plainly

1. Recurring duties live in spreadsheets owned by one person, and are discovered
   late — often by an auditor.
2. What each role owes is written down once at hiring and never surfaces again.
3. Low-frequency work (annual, semi-annual) has no due date inside its period, so
   it all lands in December.
4. Managers ask for status; status reporting becomes the work.
5. Nobody can see the difference between work that is progressing slowly and work
   that has stopped, until the deadline passes.

## What we will not build

Stated as clearly as what we will, because each of these is a request we expect
to receive and intend to decline:

- **Daily status reporting.** Not a feature, not an option. Products that add it
  turn into the thing they replaced.
- **Performance scores and league tables.** Item counts are never ranked or
  compared. The moment they are, the busiest people log the least.
- **Timesheets.** Different product, different buyer, corrosive to this one.
- **A project planner.** No dependencies, no critical path, no resource
  levelling. Duties are independent by construction.
- **Mandatory evidence on completion.** Attachments stay optional. An evidence
  gate turns a 5-second tick into a 5-minute chore and the list stops being used.
- **A manager-side data entry surface.** Assigning is the only write a manager
  makes.

The five below were parked by the maintainer's ruling of 2026-10-26, which
positioned Duly as the standard template app "rather than as a standalone
product bet": *"Direct sales, the customer's phase-2 QHSE module and phase-3
scoring are out; per-customer IM connectors are out."*

- **QHSE checklists (phase 2).** Inspection content — the questions, the
  readings, the findings — belongs to the suite that is the system of record for
  it. Duly records that the inspection was owed and when it was done, and stops
  there.
- **Supervision and scoring (phase 3).** A score over duties is a league table
  under another name, and the second item above has already declined it: the
  moment completion is scored, the busiest people complete the least.
- **A work calendar.** Duly's unit is the period and the owner, not the hour.
  Scheduling people's time is a different product; the calendar lens over tasks
  is as far as this one goes.
- **Per-customer IM connectors.** A connector maintained for one organisation's
  chat tool is a fork, and a template that carries forks stops being a template.
  The MCP surface every deployment already exposes is the general answer.
- **Direct sales.** Duly is a platform asset and reference implementation. It
  reaches people as part of ObjectStack, and its roadmap is set by the ruling
  above, not by whichever prospect is in the room.

## Why ObjectStack

Not incidental — it is the reason a small team can ship this credibly:

- Objects, views, permissions, flows and dashboards are metadata, so a customer's
  own catalog, extra fields and local terminology are configuration rather than a
  fork.
- Row-level security and hierarchy scopes are platform capabilities, not
  application code that has to be audited per release.
- Self-hostable and Apache-2.0, which is a hard requirement in most of the
  primary verticals.
- Every deployment is an MCP server, so "ask the system what is late in the
  Rotterdam plant" is available without building a chat feature.

## Positioning statement

> Duly is the standard ObjectStack template app for recurring obligations:
> install it, load your own duty catalog or one of the shipped packs, and run it
> without us. It dispatches every duty on time, records completion in one click,
> and shows managers what is late and what has stopped — without anyone filing a
> status report. It replaces the spreadsheet and the chat group that hold this
> work today, and beside an EHS or QHSE suite it is the duty layer, not a second
> system of record. Unlike project trackers and to-do apps, Duly is built around
> the period, the owner and the consequence, and it refuses by design the
> reporting rituals that make those tools fail at this job.

> Duly 是 ObjectStack 的标准模板应用，用于管理周期性履职：装上它，载入自己的履职
> 目录或随附的某个行业目录包，不需要我们参与就能运行。它按期派发每一项履职，一键
> 记录完成，让管理者看到哪些已经逾期、哪些已经停滞——不需要任何人填报进度。它替代
> 的是今天承载这些工作的 Excel 表加微信群；对 EHS / QHSE 套件，它是并存的履职层，
> 不是第二套记录系统。与项目管理工具和待办应用不同，Duly 围绕周期、责任人和后果来
> 构建，并从设计上拒绝那些让这类工具在此处失效的汇报仪式。
