import { config } from "../../config";
import { schedule } from "../rateLimiter";
import { type EtherscanSourceResponse, parseEtherscanShape } from "./etherscan";
import type { ExplorerProvider, SourceCodeResult } from "./types";

/**
 * zkSync Era's own block-explorer API. The contract-source endpoint is
 * Etherscan-compatible (response shape matches), so we share the parser
 * with the Etherscan provider.
 *
 * Currently only the mainnet endpoint is configured. Sepolia testnet
 * support would add another base URL in `config/index.ts` and a chainId
 * dispatch here.
 */
const ZKSYNC_TIMEOUT_MS = 15_000;

function baseUrlFor(chainId: number): string | null {
  if (chainId === 324) return config.ZKSYNC_EXPLORER.MAINNET_BASE_URL;
  return null;
}

async function fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null> {
  const baseUrl = baseUrlFor(chainId);
  if (!baseUrl) return null;

  const url = `${baseUrl}?module=contract&action=getsourcecode&address=${address}`;

  return schedule("zksync", chainId, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ZKSYNC_TIMEOUT_MS);
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

export const zksyncProvider: ExplorerProvider = {
  kind: "zksync",
  fetchSourceCode,
};
