import { config } from "../../config";
import { schedule } from "../rateLimiter";
import type { AbiItem, ExplorerProvider, SourceCodeResult } from "./types";

/**
 * Etherscan v2 multi-chain client. One endpoint, `chainid` param picks the
 * network — covers most major EVM chains. Returns `null` when no API key
 * is configured so the router can fall through to the next provider; an
 * unverified contract returns `{abi: null, ...}` (a final, non-fallthrough
 * answer).
 */
const ETHERSCAN_TIMEOUT_MS = 15_000;

export interface EtherscanSourceResponse {
  result?: Array<{ ABI?: string; SourceCode?: string; ContractName?: string }>;
}

async function fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null> {
  if (!config.ETHERSCAN.API_KEY) return null;

  const url = `${config.ETHERSCAN.BASE_URL}?module=contract&action=getsourcecode&address=${address}&chainid=${chainId}&apikey=${config.ETHERSCAN.API_KEY}`;

  return schedule("etherscan", chainId, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ETHERSCAN_TIMEOUT_MS);
    try {
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return { abi: null, source: null, contractName: null };
      const json = (await response.json()) as EtherscanSourceResponse;
      return parseEtherscanShape(json);
    } catch {
      return { abi: null, source: null, contractName: null };
    } finally {
      clearTimeout(timeout);
    }
  });
}

/**
 * Etherscan / Routescan / ZkSync share the same response shape (Routescan
 * exposes an `etherscan/api` compatibility endpoint, ZkSync mimics it).
 * Exported so those siblings can reuse the parser without duplication.
 */
export function parseEtherscanShape(json: EtherscanSourceResponse): SourceCodeResult {
  const result = json?.result?.[0];
  if (!result || !result.ABI || result.ABI === "Contract source code not verified") {
    return { abi: null, source: null, contractName: null };
  }
  let abi: readonly AbiItem[] | null = null;
  try {
    abi = JSON.parse(result.ABI) as readonly AbiItem[];
  } catch {
    /* malformed ABI — treat as unverified */
  }
  // Strip `:ContractName` qualifier some chains emit.
  const rawName = result.ContractName || null;
  const contractName = rawName ? (rawName.split(":").pop() ?? rawName) : null;
  return { abi, source: result.SourceCode || null, contractName };
}

export const etherscanProvider: ExplorerProvider = {
  kind: "etherscan",
  fetchSourceCode,
};
