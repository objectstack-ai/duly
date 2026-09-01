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

## Who it is for

**Primary.** Organisations of 200–5,000 people where operating roles carry
regulated or standardised recurring duties, and where being late is visible to
someone outside the company:

- Manufacturing and process industry — EHS, quality, maintenance regimes
- Utilities, energy and infrastructure
- Financial services operations and regulated back-office
- Healthcare provider operations and accreditation
- Multi-site facilities, logistics and food service

**Buyer.** The person accountable for the calendar being met and unable to prove
it today: Head of EHS / Quality / Compliance / Operations. In smaller
organisations, the COO.

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

## Why ObjectStack

Not incidental — it is the reason a small team can ship this credibly:

- Objects, views, permissions, flows and dashboards are metadata, so a customer's
  own catalog, extra fields and local terminology are configuration rather than a
  fork.
- Row-level security and hierarchy scopes are platform capabilities, not
  application code that has to be audited per release.
- Self-hostable and Apache-2.0, which is a purchase requirement in most of the
  primary verticals.
- Every deployment is an MCP server, so "ask the system what is late in the
  Rotterdam plant" is available without building a chat feature.

## Pricing shape (working assumption, not committed)

Per active user per month, with a floor. Assignment recipients and read-only
managers count; a role catalog is not billable. Self-hosted and cloud at the same
list price — the licence is the product, not the hosting.

## Positioning statement

> For organisations whose operating roles carry recurring duties they must be
> able to prove they met, Duly is a recurring-obligation system that dispatches
> every duty on time, records completion in one click, and shows managers what is
> late and what has stopped — without anyone filing a status report. Unlike
> project trackers and to-do apps, Duly is built around the period, the owner and
> the consequence, and it refuses by design the reporting rituals that make those
> tools fail at this job.
