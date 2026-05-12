import type { ExplorerKind } from "./types";

/**
 * Per-chain explorer fallback list. Mirrors legacy
 * `proxyProvider/web3Provider.ts` and `proxyProvider/index.ts`:
 *
 *   - Citrea → Blockscout only
 *   - zkSync (Era + Sepolia) → ZkSync first, then Etherscan/Routescan
 *   - Chiliz / Corn → Routescan only
 *   - Peaq → Subscan only
 *   - Katana → Etherscan only (legacy `katanaProvider`)
 *   - Everything else (eth, opt, polygon, base, arb, avax, sepolia) →
 *     Etherscan, then Routescan
 *
 * The order is the priority — the coordinator stops at the first provider
 * that returns a result with `abi !== null`.
 */
export function explorersForChain(chainId: number): readonly ExplorerKind[] {
  switch (chainId) {
    case 4114: // Citrea mainnet
      return ["blockscout"];
    case 324: // zkSync Era
      return ["zksync", "etherscan", "routescan"];
    case 88888: // Chiliz
      return ["routescan"];
    case 3338: // Peaq
      return ["subscan"];
    case 747474: // Katana
      return ["etherscan"];
    default:
      return ["etherscan", "routescan"];
  }
}
