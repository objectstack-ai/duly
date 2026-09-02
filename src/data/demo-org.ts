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
 * it eventually becomes a claim about a real organisation. It holds in Chinese
 * too — see `demo-zh.ts`, where 安岭集团 is not a company and every 《…》 is an
 * internal policy number rather than a national or industry standard.
 *
 * ── Every display string here follows DULY_DEMO_LOCALE ────────────────────
 * The arrays are authored in English and mapped through `t()` (`demo-locale.ts`)
 * once, at the bottom of each section. Two things fall out of doing it that way
 * rather than by writing the translation inline:
 *
 *  - The English fixture is untouched by the mechanism. In `en`, `t` is the
 *    identity function, so these are byte-for-byte the strings they were.
 *  - Every REFERENCE gets translated with the thing it refers to, because the
 *    map is the only place a name is produced. `unit.parent`, `unit.manager`
 *    and `person.manager` are natural keys pointing at other rows in these same
 *    arrays; translating a name and forgetting one of its referents would break
 *    the org chart rather than merely read oddly.
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

import { DEMO_LOCALE, t } from './demo-locale.js';
import { ZH_PEOPLE } from './demo-zh.js';

/** Reserved by RFC 2606 — a domain that cannot be registered by anyone. */
const DOMAIN = 'ardenline.example';

/**
 * The `sys_user.name` of the account `objectstack dev` logs you in as.
 * Matched by natural key; see the file header for why the row is name-only.
 *
 * ── Why this one string is NOT in the dictionary (#117 item 5) ────────────
 * Every other name here is fixture data: this app writes it, and nothing else
 * reads it. This one names a LIVE CREDENTIAL-BEARING ACCOUNT that a different
 * component mints — `@objectstack/plugin-auth`'s `maybeSeedDevAdmin`, whose
 * `name` is not configurable (only `OS_SEED_ADMIN_EMAIL` / `OS_SEED_ADMIN_PASSWORD`
 * are). So the Chinese spelling is not a translation the fixture may simply
 * decide on; it only holds if something actually renames the account, and the
 * seed's natural-key match has to land on that same row afterwards.
 *
 * `scripts/demo.mjs` does the rename in its priming step, before the seed
 * runs, and MEASURED (2026-09-02, `@objectstack/*` 17.2.0, live `pnpm demo:zh`):
 * the PATCH lands, sign-in with the same credentials still returns 200
 * afterwards, and a second boot replays the seed as a no-op against the
 * renamed row. The evidence is in the PR for #117.
 *
 * The failure this guards is specific and silent: if the rename did not
 * happen, the seed would find no `演示管理员` row, INSERT a fourteenth user,
 * and hand every one of the demo account's duties, tasks and log entries to a
 * person nobody can log in as — leaving My week, My duties, Sent by me and
 * Work log empty on the screen the evaluator actually lands on. Which is why
 * the rename is verified in the script rather than assumed, and why this
 * constant is written where the reasoning is, not as a dictionary row.
 */
export const ADMIN: string = DEMO_LOCALE === 'zh-CN' ? '演示管理员' : 'Dev Admin';

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

const UNITS_EN: readonly DemoUnit[] = [
  { name: 'Ardenline Group', code: 'ARD', kind: 'company', parent: null, manager: 'Nadia Ilves', timezone: 'UTC' },
  { name: 'Northgate Plant', code: 'NGP', kind: 'division', parent: 'Ardenline Group', manager: 'Tomas Bergh', timezone: 'Europe/Berlin' },
  { name: 'Riverside Plant', code: 'RVP', kind: 'division', parent: 'Ardenline Group', manager: 'Elin Halvorsen', timezone: 'UTC' },
  { name: 'Central Office', code: 'CEN', kind: 'division', parent: 'Ardenline Group', manager: 'Nadia Ilves', timezone: 'UTC' },
  // The two teams under one of the sites — the third level.
  { name: 'Northgate Operations', code: 'NGP-OPS', kind: 'department', parent: 'Northgate Plant', manager: 'Marek Dvorak', timezone: 'Europe/Berlin' },
  { name: 'Northgate Quality', code: 'NGP-QA', kind: 'department', parent: 'Northgate Plant', manager: 'Priya Raman', timezone: 'Europe/Berlin' },
];

/**
 * The tree in this compile's language.
 *
 * `code` and `timezone` are NOT translated: the first is the machine handle a
 * customer's own systems join on, the second is an IANA identifier. `parent`
 * and `manager` are, because they are natural keys into the rows above and
 * beside them — a translated `name` with an untranslated `parent` is a tree
 * with no root.
 */
export const UNITS: readonly DemoUnit[] = UNITS_EN.map((unit) => ({
  ...unit,
  name: t(unit.name),
  parent: unit.parent === null ? null : t(unit.parent),
  manager: t(unit.manager),
}));

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
  /**
   * `sys_user.email`, always ASCII on the reserved domain.
   *
   * Carried on the row rather than derived from `name` at the point of use,
   * because the derivation only works on the English name: `emailOf` strips
   * everything that is not `[a-z ]`, which turns 陈志远 into an empty local
   * part and every Chinese person into `@ardenline.example`. The zh-CN
   * mailboxes are authored as pinyin in `demo-zh.ts`; see there for why the
   * address stays ASCII while the display name does not.
   */
  email: string;
}

/**
 * Twelve people, each with a manager and a unit, so `manager_id` and
 * `primary_business_unit_id` are both populated and the chain actually
 * terminates. `Dev Admin` is seeded separately (see the header) and is the
 * thirteenth participant.
 */
const PEOPLE_EN: readonly Omit<DemoPerson, 'email'>[] = [
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

/** `firstname.lastname@ardenline.example`, deterministic from the ENGLISH name. */
export const emailOf = (name: string): string =>
  `${name.toLowerCase().replace(/[^a-z ]/g, '').split(' ').filter(Boolean).join('.')}@${DOMAIN}`;

/**
 * The address a person keeps in this compile's language.
 *
 * English derives it from the name, as it always has. zh-CN takes the pinyin
 * mailbox authored beside the Chinese name — the address stays ASCII in both,
 * on the same reserved domain, which is what `test/seed.test.ts`'s "every
 * seeded address is on a domain that cannot exist" reads.
 */
const addressOf = (english: string): string =>
  DEMO_LOCALE === 'zh-CN' ? `${ZH_PEOPLE[english]!.mailbox}@${DOMAIN}` : emailOf(english);

/** The twelve, in this compile's language. `manager` and `unit` are natural keys, so they follow. */
export const PEOPLE: readonly DemoPerson[] = PEOPLE_EN.map((person) => ({
  name: t(person.name),
  manager: person.manager === null ? null : t(person.manager),
  unit: t(person.unit),
  email: addressOf(person.name),
}));

/**
 * A person's name in this compile's language.
 *
 * {@link ADMIN} is the one name that is deliberately NOT a dictionary entry —
 * see its comment above — so it is passed through untouched while every
 * fixture person goes through `t`. This exists because the alternative is a
 * bare `t()` at each of the places a row's `owner` is mapped, and the day one
 * of them is handed the admin the compile fails with "no zh-CN translation for
 * \"Dev Admin\"", which is a confusing way to be told about a rule that is
 * really about one account.
 */
export const personOf = (name: string): string => (name === ADMIN ? ADMIN : t(name));

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
  person === ADMIN ? t('Northgate Quality') : (UNIT_BY_PERSON.get(person) ?? t('Ardenline Group'));

// ─────────────────────────────────────────────────────────────────────────
// Positions
// ─────────────────────────────────────────────────────────────────────────

/**
 * `duly_catalog_item.position_code` is free text by design — a customer loads
 * their catalog before modelling positions in the platform — so these are
 * job-role codes, NOT the three `definePosition` names in `src/security/`.
 *
 * ── They are written the way a person writes them (#117 item 3) ───────────
 * They used to be `plant_compliance_officer` — a snake_case machine spelling,
 * in a column the Role catalog puts on screen under a 岗位 heading. Free text
 * means the app never parsed it, so nothing anywhere was reading the
 * underscores; they were only ever being read by people, who do not write
 * their own job title that way in either language.
 *
 * The values are still opaque to the app and still matched EXACTLY: the sync
 * and apply actions compare `position_code` verbatim, so `Plant compliance
 * officer` and `plant compliance officer` remain two different positions.
 * What changed is only that the demo's three now read as job titles. A
 * customer's own catalog can spell them however their HR system does.
 */
export const POSITIONS = {
  compliance: t('Plant compliance officer'),
  supervisor: t('Shift supervisor'),
  technician: t('Quality technician'),
} as const;
