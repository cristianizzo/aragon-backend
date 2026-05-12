/**
 * Viem `PublicClient` provider, keyed by chain id. One memoised client per
 * chain. Reads RPC URLs from `config.RPC.URLS`. Custom (non-viem-bundled)
 * chains are defined inline below.
 */

import { type Chain, createPublicClient, defineChain, http, type PublicClient } from "viem";
import { arbitrum, avalanche, base, chiliz, mainnet, optimism, polygon, sepolia, zksync } from "viem/chains";
import { type ChainId, config } from "../config";

const katana = defineChain({
  id: 747474,
  name: "Katana",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.katana.network"] } },
});

const peaq = defineChain({
  id: 3338,
  name: "Peaq",
  nativeCurrency: { name: "PEAQ", symbol: "PEAQ", decimals: 18 },
  rpcUrls: { default: { http: ["https://peaq.api.onfinality.io/public"] } },
});

const citrea = defineChain({
  id: 4114,
  name: "Citrea",
  nativeCurrency: { name: "cBTC", symbol: "cBTC", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.citrea.xyz"] } },
});

const CHAIN_BY_ID: Record<ChainId, Chain> = {
  1: mainnet,
  10: optimism,
  137: polygon,
  324: zksync,
  3338: peaq,
  4114: citrea,
  8453: base,
  42161: arbitrum,
  43114: avalanche,
  88888: chiliz,
  747474: katana,
  11155111: sepolia,
};

const cache = new Map<ChainId, PublicClient>();

const isSupported = (chainId: number): chainId is ChainId => chainId in CHAIN_BY_ID;

export function getClient(chainId: number): PublicClient {
  if (!isSupported(chainId)) throw new Error(`Unsupported chain: ${chainId}`);
  let client = cache.get(chainId);
  if (!client) {
    client = createPublicClient({
      chain: CHAIN_BY_ID[chainId],
      transport: http(config.RPC.URLS[chainId]),
    }) as PublicClient;
    cache.set(chainId, client);
  }
  return client;
}

export const getClientSafe = (chainId: number): PublicClient | null =>
  isSupported(chainId) ? getClient(chainId) : null;
