import { keccak256, toBytes, toFunctionSignature } from "viem";
import { KNOWN_ABIS } from "../helpers/knownAbis";

/**
 * Build a `selector → canonical signature` map from the action-decoder's
 * KNOWN_ABIS registry. Computed once at module load — every function in
 * every known ABI gets keccak256-selected and indexed by 4-byte hex.
 *
 * Used by `effects/decodeSelector` to resolve `SelectorPermission.selector`
 * to a human-readable function name without paying a 4byte API call when
 * the selector belongs to one of the contracts we already know.
 */
const KNOWN_SELECTORS: Map<string, string> = (() => {
  const map = new Map<string, string>();
  for (const { abi } of KNOWN_ABIS) {
    for (const item of abi as ReadonlyArray<{ type?: string }>) {
      if (item?.type !== "function") continue;
      try {
        const sig = toFunctionSignature(item as Parameters<typeof toFunctionSignature>[0]);
        const selector = keccak256(toBytes(sig)).slice(0, 10);
        if (!map.has(selector)) map.set(selector, sig);
      } catch {
        /* skip malformed ABI entries */
      }
    }
  }
  return map;
})();

/** Lookup a 4-byte selector against KNOWN_ABIS. Returns null on miss. */
export function lookupKnownSelector(selector: string): string | null {
  if (!selector) return null;
  const normalized = selector.toLowerCase();
  return KNOWN_SELECTORS.get(normalized) ?? null;
}

/** Extract `name` from `name(arg1,arg2)`. Returns null for malformed input. */
export function functionNameFromSig(sig: string | null): string | null {
  if (!sig) return null;
  const i = sig.indexOf("(");
  return i > 0 ? sig.slice(0, i) : null;
}
