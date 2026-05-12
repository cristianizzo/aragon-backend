import { config } from "../../config";
import { schedule } from "../rateLimiter";
import { type EtherscanSourceResponse, parseEtherscanShape } from "./etherscan";
import type { ExplorerProvider, SourceCodeResult } from "./types";

/**
 * Routescan multi-chain client. Exposes an Etherscan-compat endpoint at
 * `<base>/<chainId>/etherscan/api`, so the response parser is shared with
 * the Etherscan provider.
 */
const ROUTESCAN_TIMEOUT_MS = 15_000;

async function fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null> {
  const url = `${config.ROUTESCAN.BASE_URL}/${chainId}/etherscan/api?module=contract&action=getsourcecode&address=${address}`;

  return schedule("routescan", chainId, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ROUTESCAN_TIMEOUT_MS);
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

export const routescanProvider: ExplorerProvider = {
  kind: "routescan",
  fetchSourceCode,
};
