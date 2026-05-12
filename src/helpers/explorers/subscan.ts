import { config } from "../../config";
import { schedule } from "../rateLimiter";
import type { AbiItem, ExplorerProvider, SourceCodeResult } from "./types";

/**
 * Subscan client — Substrate-based, distinct shape from Etherscan.
 *
 * Used for Peaq (chainId 3338). The endpoint is POST-based and returns a
 * `data.{abi, source, contract_name}` envelope that we normalise into the
 * shared `SourceCodeResult`. Authentication via `X-API-Key` header is
 * optional — without it the call is rate-limited to ~5 req/s by Subscan.
 */
const SUBSCAN_TIMEOUT_MS = 15_000;

interface SubscanContractResponse {
  data?: {
    abi?: string;
    source?: string;
    contract_name?: string;
    name?: string;
  };
}

function baseUrlFor(chainId: number): string | null {
  if (chainId === 3338) return config.SUBSCAN.PEAQ_BASE_URL;
  return null;
}

async function fetchSourceCode(chainId: number, address: string): Promise<SourceCodeResult | null> {
  const baseUrl = baseUrlFor(chainId);
  if (!baseUrl) return null;

  const url = `${baseUrl}/api/scan/evm/contract`;

  return schedule("subscan", chainId, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), SUBSCAN_TIMEOUT_MS);
    try {
      const response = await fetch(url, {
        method: "POST",
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(config.SUBSCAN.API_KEY ? { "X-API-Key": config.SUBSCAN.API_KEY } : {}),
        },
        body: JSON.stringify({ address }),
      });
      if (!response.ok) return { abi: null, source: null, contractName: null };
      const json = (await response.json()) as SubscanContractResponse;
      return parseSubscanShape(json);
    } catch {
      return { abi: null, source: null, contractName: null };
    } finally {
      clearTimeout(timeout);
    }
  });
}

function parseSubscanShape(json: SubscanContractResponse): SourceCodeResult {
  const data = json?.data;
  if (!data?.abi) return { abi: null, source: null, contractName: null };
  let abi: readonly AbiItem[] | null = null;
  try {
    abi = JSON.parse(data.abi) as readonly AbiItem[];
  } catch {
    /* malformed ABI */
  }
  return { abi, source: data.source ?? null, contractName: data.contract_name ?? data.name ?? null };
}

export const subscanProvider: ExplorerProvider = {
  kind: "subscan",
  fetchSourceCode,
};
