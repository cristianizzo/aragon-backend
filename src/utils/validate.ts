/**
 * Mirrors legacy `Utils.validateString`: returns the input untouched only if
 * it's a non-empty (post-trim) string, otherwise `undefined`. Used to reject
 * empty / whitespace-only strings emitted on-chain (subdomains, names, ...)
 * without mutating the value we persist.
 */
export function validateString(input: unknown): string | undefined {
  return typeof input === "string" && input.trim() !== "" ? input : undefined;
}
