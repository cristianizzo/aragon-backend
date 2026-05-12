/**
 * Shared types for the explorer-client layer.
 *
 * Each provider exposes a `fetchSourceCode(chainId, address)` returning the
 * same `SourceCodeResult` shape. The router (`./routing.ts`) picks providers
 * per chain; the public coordinator (`./index.ts`) walks the priority list
 * and returns the first hit.
 */

export type ExplorerKind = "etherscan" | "routescan" | "zksync" | "blockscout" | "subscan";

export interface AbiItem {
  type: string;
  name?: string;
  inputs?: ReadonlyArray<{ name?: string; type: string }>;
}

export interface SourceCodeResult {
  /** Parsed ABI as objects, or null when the source is unverified / parse fails. */
  abi: readonly AbiItem[] | null;
  /** Raw flattened source — used by the NatSpec parser. Null when unavailable. */
  source: string | null;
  /** Contract name (the `:Name` suffix is stripped). Null when unavailable. */
  contractName: string | null;
}

/** A single provider implementation — invoked by the router. */
export interface ExplorerProvider {
  kind: ExplorerKind;
  /**
   * Returns `null` when the provider can't service this chain (missing URL,
   * unsupported network) so the router can fall through. Returns a result
   * with `abi: null` when the contract is genuinely unverified — that is
   * NOT a failure and the router should treat it as a final answer.
   */
  fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null>;
}
