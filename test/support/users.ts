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
 */

const SYSTEM = { isSystem: true } as const;

interface UserWriter {
  find(object: string, query: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
  insert(object: string, data: Record<string, unknown>, options?: Record<string, unknown>): Promise<unknown>;
}

export async function ensureUsers(data: UserWriter, ids: readonly string[]): Promise<void> {
  for (const id of ids) {
    const found = await data.find('sys_user', { where: { id } }, { context: SYSTEM });
    if (Array.isArray(found) && found.length > 0) continue;
    await data.insert('sys_user', { id, name: id, email: `${id}@example.invalid` }, { context: SYSTEM });
  }
}
