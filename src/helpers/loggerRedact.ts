/**
 * Hide API keys embedded in URLs before logs leave the process.
 *
 * Only the URL formats this codebase actually uses for RPC providers are
 * scrubbed — the rest of the URL stays intact so logs remain useful for
 * debugging (path, query params, host).
 */

const REDACTED = "[REDACTED]";

const URL_KEY_PATTERNS: ReadonlyArray<readonly [RegExp, string]> = [
  // Alchemy: https://*.g.alchemy.com/v2/<key>
  [/(alchemy\.com\/v2\/)[A-Za-z0-9_-]{20,}/gi, `$1${REDACTED}`],
  // dRPC: ?dkey=<key>
  [/([?&]dkey=)[^&\s"']+/gi, `$1${REDACTED}`],
  // Ankr: rpc.ankr.com/<chain>/<key>
  [/(rpc\.ankr\.com\/[A-Za-z0-9_-]+\/)[A-Za-z0-9_-]{20,}/gi, `$1${REDACTED}`],
];

export function redactUrlKeys(input: string): string {
  let out = input;
  for (const [pattern, replacement] of URL_KEY_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Walk a plain JSON-like payload in place and scrub any URL API keys found
 * in string leaves. Intended for the output of a `JSON.parse(JSON.stringify(...))`
 * snapshot — i.e. after live objects (Error instances, circular refs) have
 * already been flattened — so we never touch shared references.
 */
export function redactPayload(value: unknown, seen: WeakSet<object> = new WeakSet()): void {
  if (value == null || typeof value !== "object") return;
  if (seen.has(value as object)) return;
  seen.add(value as object);

  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const v = value[i];
      if (typeof v === "string") {
        const redacted = redactUrlKeys(v);
        if (redacted !== v) value[i] = redacted;
      } else {
        redactPayload(v, seen);
      }
    }
    return;
  }

  const obj = value as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    const current = obj[key];
    if (typeof current === "string") {
      const redacted = redactUrlKeys(current);
      if (redacted !== current) obj[key] = redacted;
    } else {
      redactPayload(current, seen);
    }
  }
}
