// Copyright (c) 2026 ObjectStack. Licensed under the Apache-2.0 license.

/**
 * Mint the `sys_user` rows a suite's fixtures name as owners.
 *
 * From @objectstack 18 a reduced test kernel mounts plugin-auth's identity
 * objects (`createIdentityObjectsPlugin()`): it is what creates the Default
 * Organization every tenant-scoped row is stamped with. With it `sys_user` is
 * a registered object, so a user lookup is checked the way it is on a real
 * install — a fixture whose `owner` names no row is refused
 * `reference_not_found`. Through 17.x these suites booted the in-memory driver
 * with no `sys_user` at all, and the check never ran.
 *
 * The id IS the handle the fixture already writes (`'user_alice'`), so the
 * fixtures read the same and each suite says which people it needs. Idempotent:
 * a factory that mints per insert can call it on every row.
 *
 * Each person is also made a member of the organization (`sys_member`), as a
 * real install's `auto` membership policy binds a user to the default
 * organization when the account is created. From @objectstack 18.4 a person's
 * data access requires a current membership under every tenancy posture
 * (ADR-0093 D8.1, objectstack e542831): a context `buildContextForUser`
 * resolves for a user with no membership carries an empty
 * `accessible_org_ids`, its reads resolve to nothing and its writes are
 * refused `403 PERMISSION_DENIED`. Through 18.3 the `single` posture let such
 * a person through, so these fixtures never needed the row.
 */

const SYSTEM = { isSystem: true } as const;

interface UserWriter {
  find(object: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export async function ensureUsers(data: UserWriter, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const found = await data.find('sys_user', { where: { id } }, { context: SYSTEM });
    if (!(Array.isArray(found) && found.length > 0)) {
      await data.insert('sys_user', { id, name: id, email: `${id}@example.invalid` }, { context: SYSTEM });
    }
    await ensureMembership(data, id);
  }
}

/** Bind `userId` to the default organization, once. */
async function ensureMembership(data: UserWriter, userId: string): Promise<void> {
  const organizations = await data.find('sys_organization', {}, { context: SYSTEM });
  const organization = Array.isArray(organizations) ? (organizations[0] as { id?: unknown } | undefined) : undefined;
  if (organization?.id == null) throw new Error('ensureUsers: no organization to make a member of');
  const organization_id = String(organization.id);
  const held = await data.find('sys_member', { where: { user_id: userId, organization_id } }, { context: SYSTEM });
  if (Array.isArray(held) && held.length > 0) return;
  await data.insert('sys_member', { user_id: userId, organization_id, role: 'member' }, { context: SYSTEM });
}
