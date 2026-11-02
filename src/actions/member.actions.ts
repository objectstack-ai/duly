// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

import { defineAction } from '@objectstack/spec';

/**
 * `duly_member_open` — the way to reach the member page. ⚠️ A STOPGAP, filed
 * upstream as objectstack-ai/objectstack#28979 and built to be deleted.
 *
 * ── Why a person does not open on `duly_member` by itself ────────────────
 * `duly_member` (`src/pages/member.page.ts`) is a record page over `sys_user`.
 * plugin-auth ships `sys_user_detail` for the same object with
 * `isDefault: true`, and from 18 on the console opens the `isDefault` page
 * first. Measured on 18.2.0 against a live `pnpm demo`: Duly > People > a
 * person opens plugin-auth's admin page, and `duly_member` renders only on
 * the explicit route `/apps/<app>/sys_user/record/<id>/page/duly_member`.
 * Nothing on `PageSchema` lets an app outrank another package's default, and
 * a second default refuses the boot (`DEFAULT_RECORD_PAGE_CONFLICT`). The
 * page's header, gap §5, has the whole measurement.
 *
 * ── What this does instead ────────────────────────────────────────────────
 * It is a `type: 'url'` action on `sys_user` that navigates to that explicit
 * route, with `${ctx.recordId}` as the person in context. Measured on 18.2.0:
 * the action renders in the record's "⋯" menu (the header shows three
 * buttons and folds the rest). Clicking it lands on the member page with
 * every region rendered. That is one click more than the page should cost,
 * and it is not pretended otherwise.
 *
 * **`record_header` only, not `list_item`.** On the People row menu it
 * renders, but 18.2's console runs a row `url` action with no record in
 * context. `${ctx.recordId}`, `${ctx.record.id}` and `${ctx.selection.ids}`
 * all interpolate to empty there, measured live, so the click lands on
 * `/sys_user/record/page/duly_member`, a broken route. A menu item that leads
 * nowhere is worse than none, so the row location is left out until the
 * console fills the row's record in.
 *
 * No `openIn`: an in-app path navigates in place by default, which is what a
 * record-to-record hop should do.
 *
 * The path carries the app's route segment, the stack's package id
 * (`manifest.id` in `objectstack.config.ts`). The spec declares no
 * app-relative form and no `${ctx.*}` member that names the current app, so
 * the segment is written out. `test/member-page.test.ts` pins it against the
 * manifest and the page name.
 *
 * ── Ungated, deliberately, including in Setup > Users ─────────────────────
 * Actions belong to the object, not to the app, so this also shows in Setup's
 * user record and opens into Duly from there. It carries no
 * `requiredPermissions`: it writes nothing, and the page it opens is read-only
 * and row-scoped by the permission sets on what it lists. (Seat ruling on
 * duly#113.)
 *
 * ── When to delete it ─────────────────────────────────────────────────────
 * When objectstack#28979 lands a way for an app to say which record page its
 * own routes open for `sys_user`, declare that, delete this file and its
 * barrel entry, and turn the resolution pins in `test/member-page.test.ts`
 * around.
 */
export const MEMBER_OPEN_ACTION = 'duly_member_open';

export const MemberOpenAction = defineAction({
  name: MEMBER_OPEN_ACTION,
  objectName: 'sys_user',
  label: 'Open member page',
  description: "Open this person's Duly member page: open work, this period's duties, standing duties and recent movement.",
  icon: 'user-round',
  type: 'url',
  target: '/apps/ai.objectstack.duly/sys_user/record/${ctx.recordId}/page/duly_member',
  locations: ['record_header'],
});
