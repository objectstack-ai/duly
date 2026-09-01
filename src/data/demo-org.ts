// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * The demo organisation: a business-unit tree, the people in it, and the three
 * positions their duties hang off.
 *
 * Everything here is INVENTED. No real company, person, site or regulation is
 * named anywhere in this seed — the domain is under RFC 2606's reserved
 * `.example` TLD, which can never resolve, and every "reference" a catalog item
 * cites is an internal policy number belonging to a company that does not
 * exist. That is a hard rule of this fixture, not a stylistic preference: a
 * demo seed is copied, screenshotted and pasted into decks, and a real name in
 * it eventually becomes a claim about a real organisation.
 *
 * ── Why the person you log in as is IN the org chart ──────────────────────
 * `objectstack dev` seeds a loginable admin (`admin@objectos.ai` / `admin123`)
 * whose `sys_user.name` is `Dev Admin`, via `plugin-auth`'s `maybeSeedDevAdmin`.
 * That is the account an evaluator actually lands in, so every `{current_user_id}`
 * view — My week, My duties, Sent by me, Work log — is scoped to it. A demo
 * whose data belongs entirely to twelve OTHER people renders those four screens
 * empty on first boot, which is the exact failure this seed exists to prevent.
 *
 * So `Dev Admin` is a full participant below: they own duties, tasks, an
 * assignment and a work log. {@link ADMIN} is how the fixture refers to them.
 *
 * ⚠️ The `sys_user` seed row for `Dev Admin` carries its natural key and
 * NOTHING ELSE, deliberately. Two orderings have to both come out right:
 *
 *  - **`objectstack dev`, fresh DB.** `AuthPlugin` is registered before the
 *    app plugin (`serve.ts` mounts it at step 5d, the app's own plugins after),
 *    so the real admin account already exists when this seed runs. The loader
 *    finds it by `name`, `isNoOpReplay` compares only the fields the seed
 *    declares — just `name` — finds them equal, and SKIPS. Nothing is written
 *    to the live account. Add an `email` here and that stops being true: the
 *    row would be updated, and a changed email is a login the evaluator no
 *    longer has.
 *  - **A kernel with no auth plugin** (the vitest suites, `createStandaloneStack`).
 *    No such account exists, so the row is inserted and `owner: 'Dev Admin'`
 *    still resolves. Without it every task owned by the admin would be refused
 *    with `Owner is required`, because `duly_task.owner` is a natural-key
 *    reference into `sys_user.name` and `owner` is `required: true`.
 */

/** Reserved by RFC 2606 — a domain that cannot be registered by anyone. */
const DOMAIN = 'ardenline.example';

/**
 * The `sys_user.name` of the account `objectstack dev` logs you in as.
 * Matched by natural key; see the file header for why the row is name-only.
 */
export const ADMIN = 'Dev Admin';

// ─────────────────────────────────────────────────────────────────────────
// Business units — three levels, as ADR-0057 D2 models them
// ─────────────────────────────────────────────────────────────────────────

export interface DemoUnit {
  name: string;
  code: string;
  kind: 'company' | 'division' | 'department';
  parent: string | null;
  /** `sys_business_unit.manager_user_id` — set at every level so a hierarchy scope has something to resolve. */
  manager: string;
  /** IANA zone the duties in this unit compute their periods in. */
  timezone: string;
}

export const UNITS: readonly DemoUnit[] = [
  { name: 'Ardenline Group', code: 'ARD', kind: 'company', parent: null, manager: 'Nadia Ilves', timezone: 'UTC' },
  { name: 'Northgate Plant', code: 'NGP', kind: 'division', parent: 'Ardenline Group', manager: 'Tomas Bergh', timezone: 'Europe/Berlin' },
  { name: 'Riverside Plant', code: 'RVP', kind: 'division', parent: 'Ardenline Group', manager: 'Elin Halvorsen', timezone: 'UTC' },
  { name: 'Central Office', code: 'CEN', kind: 'division', parent: 'Ardenline Group', manager: 'Nadia Ilves', timezone: 'UTC' },
  // The two teams under one of the sites — the third level.
  { name: 'Northgate Operations', code: 'NGP-OPS', kind: 'department', parent: 'Northgate Plant', manager: 'Marek Dvorak', timezone: 'Europe/Berlin' },
  { name: 'Northgate Quality', code: 'NGP-QA', kind: 'department', parent: 'Northgate Plant', manager: 'Priya Raman', timezone: 'Europe/Berlin' },
];

const UNIT_BY_NAME = new Map(UNITS.map((u) => [u.name, u]));

/** The zone a unit's duties compute periods in. Unknown unit ⇒ `duly_duty.timezone`'s own default. */
export const timezoneOf = (unit: string): string => UNIT_BY_NAME.get(unit)?.timezone ?? 'UTC';

// ─────────────────────────────────────────────────────────────────────────
// People
// ─────────────────────────────────────────────────────────────────────────

export interface DemoPerson {
  name: string;
  /** `sys_user.manager_id`, by natural key. `null` only for the top of the chain. */
  manager: string | null;
  unit: string;
}

/**
 * Twelve people, each with a manager and a unit, so `manager_id` and
 * `primary_business_unit_id` are both populated and the chain actually
 * terminates. `Dev Admin` is seeded separately (see the header) and is the
 * thirteenth participant.
 */
export const PEOPLE: readonly DemoPerson[] = [
  { name: 'Nadia Ilves', manager: null, unit: 'Ardenline Group' },
  { name: 'Tomas Bergh', manager: 'Nadia Ilves', unit: 'Northgate Plant' },
  { name: 'Elin Halvorsen', manager: 'Nadia Ilves', unit: 'Riverside Plant' },
  { name: 'Owen Pryce', manager: 'Nadia Ilves', unit: 'Central Office' },
  { name: 'Marek Dvorak', manager: 'Tomas Bergh', unit: 'Northgate Operations' },
  { name: 'Priya Raman', manager: 'Tomas Bergh', unit: 'Northgate Quality' },
  { name: 'Sami Okonkwo', manager: 'Marek Dvorak', unit: 'Northgate Operations' },
  { name: 'Yuki Tanabe', manager: 'Marek Dvorak', unit: 'Northgate Operations' },
  { name: 'Rosa Delgado', manager: 'Priya Raman', unit: 'Northgate Quality' },
  { name: 'Ibrahim Chaudhry', manager: 'Priya Raman', unit: 'Northgate Quality' },
  { name: 'Ana Ferreira', manager: 'Elin Halvorsen', unit: 'Riverside Plant' },
  { name: 'Greta Lindqvist', manager: 'Elin Halvorsen', unit: 'Riverside Plant' },
];

/** `firstname.lastname@ardenline.example`, deterministic from the display name. */
export const emailOf = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean).join('.')}@${DOMAIN}`;

const UNIT_BY_PERSON = new Map(PEOPLE.map((p) => [p.name, p.unit]));

/**
 * The unit a person's work rolls up to.
 *
 * `Dev Admin` is not in {@link PEOPLE} — their `sys_user` row is name-only on
 * purpose — so their unit is stated here instead. It reaches the data the same
 * way a real one would: denormalised onto each duty and task at creation, which
 * is what `duly_task.business_unit` is for.
 */
export const unitOf = (person: string): string =>
  person === ADMIN ? 'Northgate Quality' : (UNIT_BY_PERSON.get(person) ?? 'Ardenline Group');

// ─────────────────────────────────────────────────────────────────────────
// Positions
// ─────────────────────────────────────────────────────────────────────────

/**
 * `duly_catalog_item.position_code` is free text by design — a customer loads
 * their catalog before modelling positions in the platform — so these are
 * job-role codes, NOT the three `definePosition` names in `src/security/`.
 */
export const POSITIONS = {
  compliance: 'plant_compliance_officer',
  supervisor: 'shift_supervisor',
  technician: 'quality_technician',
} as const;
