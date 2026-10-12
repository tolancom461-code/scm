/** MySQL/TiDB rolls back the complete victim transaction on error 1213.
 * Retry only that error: a network/commit error may already have committed. */
export function isDeadlock(error: unknown): boolean {
  const seen = new Set<unknown>();
  let current = error;
  while (current && typeof current === "object" && !seen.has(current)) {
    seen.add(current);
    const candidate = current as {
      code?: unknown;
      errno?: unknown;
      cause?: unknown;
    };
    if (candidate.code === "ER_LOCK_DEADLOCK" || candidate.errno === 1213)
      return true;
    current = candidate.cause;
  }
  return false;
}

export async function retryTransaction<T>(
  execute: () => Promise<T>,
  pause: (milliseconds: number) => Promise<void> = milliseconds =>
    new Promise(resolve => setTimeout(resolve, milliseconds))
): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await execute();
    } catch (error) {
      if (attempt >= 2 || !isDeadlock(error)) throw error;
      await pause(50 * (attempt + 1) + Math.floor(Math.random() * 50));
    }
  }
}
