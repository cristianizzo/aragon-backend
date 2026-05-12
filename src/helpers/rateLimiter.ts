import Bottleneck from "bottleneck";

/**
 * Per-provider rate limiters.
 *
 * Mirrors legacy `BottleneckModule` (app-backend `src/modules/bottleneck.ts`)
 * — a singleton-per-(provider, chainId) Bottleneck instance, picked up by
 * helpers that wrap each provider's HTTP transport.
 *
 * Limits are conservative defaults sized to the free-tier quotas of each
 * public API. They can be overridden via env (`<PROVIDER>_MAX_CONCURRENT`,
 * `<PROVIDER>_MIN_TIME_MS`) to let operators dial concurrency up when
 * running with paid keys.
 *
 * Why per-(provider, chainId) and not per-provider?
 *   Etherscan and friends apply quotas per API key. Different chains share
 *   the same key on the v2 multi-chain endpoint, so technically one
 *   limiter would suffice — but Routescan/Blockscout/ZkSync use distinct
 *   endpoints per network. Keying by (provider, chainId) is uniform and
 *   matches legacy, which makes capacity planning per-network trivial.
 */

export type ProviderKind = "etherscan" | "routescan" | "zksync" | "blockscout" | "subscan" | "fourByte";

interface Limits {
  /** Maximum number of in-flight requests at any given time. */
  maxConcurrent: number;
  /** Minimum spacing between consecutive requests (ms). 0 disables spacing. */
  minTimeMs: number;
}

const num = (key: string, fallback: number): number => (process.env[key] ? Number(process.env[key]) : fallback);

// Defaults: free-tier-friendly. Etherscan free is 5 req/s, Routescan ~10
// req/s, 4byte directory ~5 req/s. ZkSync / Blockscout / Subscan have no
// published per-key limit but we throttle anyway to avoid IP bans.
const DEFAULTS: Record<ProviderKind, Limits> = {
  etherscan: { maxConcurrent: num("ETHERSCAN_MAX_CONCURRENT", 5), minTimeMs: num("ETHERSCAN_MIN_TIME_MS", 200) },
  routescan: { maxConcurrent: num("ROUTESCAN_MAX_CONCURRENT", 5), minTimeMs: num("ROUTESCAN_MIN_TIME_MS", 100) },
  zksync: {
    maxConcurrent: num("ZKSYNC_EXPLORER_MAX_CONCURRENT", 3),
    minTimeMs: num("ZKSYNC_EXPLORER_MIN_TIME_MS", 200),
  },
  blockscout: { maxConcurrent: num("BLOCKSCOUT_MAX_CONCURRENT", 3), minTimeMs: num("BLOCKSCOUT_MIN_TIME_MS", 200) },
  subscan: { maxConcurrent: num("SUBSCAN_MAX_CONCURRENT", 2), minTimeMs: num("SUBSCAN_MIN_TIME_MS", 500) },
  fourByte: { maxConcurrent: num("FOUR_BYTE_MAX_CONCURRENT", 4), minTimeMs: num("FOUR_BYTE_MIN_TIME_MS", 250) },
};

const limiters: Map<string, Bottleneck> = new Map();

/**
 * Schedule `fn` through the (provider, chainId) limiter — creating it on
 * first use. The limiter survives for the process lifetime; the indexer's
 * effect cache short-circuits most calls anyway, so the queue rarely backs
 * up after the initial sync window.
 */
export function schedule<T>(provider: ProviderKind, chainId: number, fn: () => Promise<T>): Promise<T> {
  const key = `${provider}:${chainId}`;
  let limiter = limiters.get(key);
  if (!limiter) {
    const limits = DEFAULTS[provider];
    limiter = new Bottleneck({ maxConcurrent: limits.maxConcurrent, minTime: limits.minTimeMs });
    limiters.set(key, limiter);
  }
  return limiter.schedule(fn);
}
