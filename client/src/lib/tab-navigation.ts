const prefix = (userId: number) => `pscm:tab-navigation:v1:${userId}:`;

export function readTabNavigation(userId: number, section: string): unknown {
  try {
    const value = window.sessionStorage.getItem(prefix(userId) + section);
    return value === null ? null : JSON.parse(value);
  } catch {
    return null;
  }
}

export function writeTabNavigation(
  userId: number,
  section: string,
  value: unknown
) {
  try {
    window.sessionStorage.setItem(
      prefix(userId) + section,
      JSON.stringify(value)
    );
  } catch {
    // The workspace still works when the browser disallows session storage.
  }
}

export function clearTabNavigation(userId: number) {
  try {
    const storage = window.sessionStorage;
    const userPrefix = prefix(userId);
    for (let index = storage.length - 1; index >= 0; index--) {
      const key = storage.key(index);
      if (key?.startsWith(userPrefix)) storage.removeItem(key);
    }
  } catch {
    // Signing out only depends on the server session.
  }
}
