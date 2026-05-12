import { config } from "../../config";
import { schedule } from "../rateLimiter";
import { type EtherscanSourceResponse, parseEtherscanShape } from "./etherscan";
import type { ExplorerProvider, SourceCodeResult } from "./types";

/**
 * Blockscout client — Etherscan-compatible v1 layer (`?module=contract&
 * action=getsourcecode`) is supported on all current Blockscout deployments
 * and returns the same shape, so we reuse the Etherscan parser.
 *
 * Currently only Citrea mainnet is mapped (mirrors legacy
 * `EvmExplorerEnum.BLOCKSCOUT` routing). To add another Blockscout-indexed
 * chain, configure its base URL in `src/config/index.ts` and extend
 * `baseUrlFor` here.
 */
const BLOCKSCOUT_TIMEOUT_MS = 15_000;

function baseUrlFor(chainId: number): string | null {
  if (chainId === 4114) return config.BLOCKSCOUT.CITREA_BASE_URL;
  return null;
}

async function fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null> {
  const baseUrl = baseUrlFor(chainId);
  if (!baseUrl) return null;

  const url = `${baseUrl}?module=contract&action=getsourcecode&address=${address}`;

  return schedule("blockscout", chainId, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), BLOCKSCOUT_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return { abi: null, source: null, contractName: null };
      return parseEtherscanShape((await response.json()) as EtherscanSourceResponse);
    } catch {
      return { abi: null, source: null, contractName: null };
    } finally {
      clearTimeout(timeout);
    }
  });
}

export const blockscoutProvider: ExplorerProvider = {
  kind: "blockscout",
  fetchSourceCode,
};
