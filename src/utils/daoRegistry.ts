import { indexer } from "envio";

/**
 * Per-chain Set view of envio's in-memory DAO address registry. Used by the
 * wildcard ERC-20 / ERC-721 Transfer handlers to filter out the 99.99% of
 * events that don't touch a known DAO without paying a `context.Dao.get()`
 * round-trip per event.
 *
 * The underlying source — `indexer.chains[chainId].DAO.addresses` — is
 * maintained by envio as DAOs get registered via
 * `context.chain.DAO.add(addr)` in `DAORegistry.DAORegistered`.
 *
 * Why a Set: with thousands of registered DAOs across Ethereum, `Array.includes`
 * is O(n) per check. `Set.has` is O(1). For wildcard handlers running over
 * billions of Transfers, that difference compounds.
 *
 * Why a cache: rebuilding the Set per handler call costs O(n) — the cache
 * keeps a Set per chain reused across calls until envio's address array
 * reference changes (i.e. a new DAO got registered). Reference equality is
 * the cheapest possible invalidation signal.
 *
 * Recommended by Envio (per discussion on enviodev/hyperindex#1201) until
 * the framework adds HyperSync-level filtering for wildcard handlers, at
 * which point this helper will be obsolete and we can drop it.
 */
const daoSetCache = new Map<number, { ref: readonly string[]; set: Set<string> }>();

export function getDaoSet(chainId: number): Set<string> {
  // `indexer.chains` is typed with literal chain ids (e.g. `1`, `137`); a
  // plain `number` index breaks the literal lookup. We accept any number
  // at the boundary (callers pass `event.chainId`) and cast — the underlying
  // map has the runtime entry whether or not TS sees the literal type.
  const ref = (indexer.chains as unknown as Record<number, { DAO: { addresses: readonly string[] } }>)[chainId]?.DAO
    .addresses;
  if (!ref) return new Set();
  const cached = daoSetCache.get(chainId);
  if (cached && cached.ref === ref) return cached.set;
  const set = new Set<string>(ref);
  daoSetCache.set(chainId, { ref, set });
  return set;
}
