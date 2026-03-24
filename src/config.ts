/**
 * Centralized configuration for the Aragon indexer.
 * All environment variables are read here — no process.env elsewhere.
 */

import { createPublicClient, defineChain, http } from "viem";
import { arbitrum, avalanche, base, chiliz, mainnet, optimism, polygon, sepolia, zkSync } from "viem/chains";

// --- Custom chains ---

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

// --- Chain RPC Configuration ---

interface ChainConfig {
  chain: any;
  rpcUrl: string;
}

export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  1: { chain: mainnet, rpcUrl: process.env.ENVIO_RPC_URL_1 || "https://ethereum-rpc.publicnode.com" },
  137: { chain: polygon, rpcUrl: process.env.ENVIO_RPC_URL_137 || "https://polygon-bor-rpc.publicnode.com" },
  42161: { chain: arbitrum, rpcUrl: process.env.ENVIO_RPC_URL_42161 || "https://arbitrum-one-rpc.publicnode.com" },
  8453: { chain: base, rpcUrl: process.env.ENVIO_RPC_URL_8453 || "https://base-rpc.publicnode.com" },
  11155111: {
    chain: sepolia,
    rpcUrl: process.env.ENVIO_RPC_URL_11155111 || "https://ethereum-sepolia-rpc.publicnode.com",
  },
  324: { chain: zkSync, rpcUrl: process.env.ENVIO_RPC_URL_324 || "https://mainnet.era.zksync.io" },
  10: { chain: optimism, rpcUrl: process.env.ENVIO_RPC_URL_10 || "https://optimism-rpc.publicnode.com" },
  43114: {
    chain: avalanche,
    rpcUrl: process.env.ENVIO_RPC_URL_43114 || "https://avalanche-c-chain-rpc.publicnode.com",
  },
  747474: { chain: katana, rpcUrl: process.env.ENVIO_RPC_URL_747474 || "https://rpc.katana.network" },
  3338: { chain: peaq, rpcUrl: process.env.ENVIO_RPC_URL_3338 || "https://peaq.api.onfinality.io/public" },
  88888: { chain: chiliz, rpcUrl: process.env.ENVIO_RPC_URL_88888 || "https://rpc.chiliz.com" },
};

// --- Shared viem client (cached per chainId) ---

const clientCache = new Map<number, any>();

export function getClient(chainId: number) {
  if (clientCache.has(chainId)) return clientCache.get(chainId)!;

  const config = CHAIN_CONFIGS[chainId];
  if (!config) throw new Error(`No RPC config for chain ${chainId}`);

  const client = createPublicClient({
    chain: config.chain,
    transport: http(config.rpcUrl),
  });

  clientCache.set(chainId, client);
  return client;
}

/**
 * Non-throwing variant for contractRegister contexts where missing chain is acceptable.
 */
export function getClientSafe(chainId: number) {
  const config = CHAIN_CONFIGS[chainId];
  if (!config) return null;
  return getClient(chainId);
}

// --- Etherscan API ---

export const etherscanConfig = {
  apiKey: process.env.ETHERSCAN_API_KEY || "",
  baseUrl: process.env.ETHERSCAN_API_BASE_URL || "https://api.etherscan.io/v2/api",
};

// --- 4bytes Directory ---

export const fourByteConfig = {
  uri: process.env.FOUR_BYTE_URI || "https://www.4byte.directory/api/v1",
};

// --- IPFS Gateways ---
// Pinata dedicated gateway (aragon-1.mypinata.cloud) is public for reads — no JWT auth needed.
// JWT is only used for pin/unpin operations (not needed in the indexer).

const pinataGatewayUrl = process.env.PINATA_GATEWAY_URI
  ? `${process.env.PINATA_GATEWAY_URI.replace(/\/+$/, "")}/`
  : "https://aragon-1.mypinata.cloud/ipfs/";

const dedicatedGateway = process.env.ENVIO_IPFS_GATEWAY_URL
  ? `${process.env.ENVIO_IPFS_GATEWAY_URL.replace(/\/+$/, "")}/ipfs/`
  : undefined;

export const ipfsConfig = {
  gateways: [
    pinataGatewayUrl,
    ...(dedicatedGateway ? [dedicatedGateway] : []),
    "https://ipfs.io/ipfs/",
    "https://dweb.link/ipfs/",
    "https://cloudflare-ipfs.com/ipfs/",
  ],
  timeout: 10000,
};
