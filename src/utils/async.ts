/**
 * Wrap a promise so failures resolve to `undefined` instead of throwing.
 * Lets you fan out N best-effort calls via `Promise.all` and read the
 * results inline without `Promise.allSettled` + `.status` boilerplate.
 *
 * Usage:
 *   const [name, symbol, decimals] = await Promise.all([
 *     tryAsync(client.readContract({ ..., functionName: "name" })),
 *     tryAsync(client.readContract({ ..., functionName: "symbol" })),
 *     tryAsync(client.readContract({ ..., functionName: "decimals" })),
 *   ]);
 *
 * Errors are swallowed silently — only use for genuinely best-effort calls
 * where missing data is acceptable. For calls where you need to react to
 * failure, use a regular try/catch.
 */
export async function tryAsync<T>(promise: Promise<T>): Promise<T | undefined> {
  try {
    return await promise;
  } catch {
    return undefined;
  }
}
