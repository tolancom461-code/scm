export type AccessUser = { id: number; role: string; permissions: string[] };
/** Owners' complete grants are resolved by the same server policy center. */
export const allowed = (user: AccessUser, permission: string) =>
  user.permissions.includes(permission);
