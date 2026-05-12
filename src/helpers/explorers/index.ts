import { blockscoutProvider } from "./blockscout";
import { etherscanProvider } from "./etherscan";
import { routescanProvider } from "./routescan";
import { explorersForChain } from "./routing";
import { subscanProvider } from "./subscan";
import type { ExplorerKind, ExplorerProvider, SourceCodeResult } from "./types";
import { zksyncProvider } from "./zksync";

export type { AbiItem, SourceCodeResult } from "./types";

const PROVIDERS: Record<ExplorerKind, ExplorerProvider> = {
  etherscan: etherscanProvider,
  routescan: routescanProvider,
  zksync: zksyncProvider,
  blockscout: blockscoutProvider,
  subscan: subscanProvider,
};

/**
 * Public coordinator — walks the per-chain provider priority list and
 * returns the first response with a parsed ABI. A response with `abi: null`
 * is NOT a hit (the contract may simply be unverified on that explorer);
 * we keep walking and only return the final null shape if every provider
 * misses.
 *
 * Per-provider Bottleneck rate-limits are applied inside each provider's
 * `fetchSourceCode` (see `helpers/rateLimiter.ts`), so concurrent callers
 * across chains share the appropriate queues without us managing them
 * here.
 */
export async function fetchContractSourceCode(chainId: number, address: string): Promise<SourceCodeResult> {
  const empty: SourceCodeResult = { abi: null, source: null, contractName: null };
  for (const kind of explorersForChain(chainId)) {
    const result = await PROVIDERS[kind].fetchSourceCode(chainId, address);
    if (result?.abi) return result;
  }
  return empty;
}
