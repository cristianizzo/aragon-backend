/**
 * Env-driven config for the Aragon indexer — pure data, read once at import.
 * No logic here; helpers consume this for URLs / API keys / timeouts.
 * Per-chain routing (which explorer / price API / RPC per chainId) lives in
 * `docs/CHAIN_INTEGRATIONS.md`.
 */

const src = process.env;

const str = (key: string, fallback: string): string => src[key] ?? fallback;
const num = (key: string, fallback: number): number => (src[key] ? Number(src[key]) : fallback);
const list = (key: string, fallback: readonly string[]): readonly string[] =>
  src[key] ? (src[key] as string).split(",") : fallback;

export const config = {
  // Etherscan v2 — multi-chain ABI / source-code lookup. Used by the
  // proposal-action decoder pipeline (Stage 3, after KNOWN_ABIs and
  // EIP-1967 proxy resolution). Covers most EVM chains via the v2 API.
  // Without an API key the call is skipped and the decoder falls through
  // to the 4byte fallback.
  ETHERSCAN: {
    API_KEY: str("ETHERSCAN_API_KEY", ""),
    BASE_URL: str("ETHERSCAN_API_BASE_URL", "https://api.etherscan.io/v2/api"),
  },

  // Per-chain explorer fallbacks for chains Etherscan v2 doesn't index.
  // The action decoder currently uses Etherscan ONLY — these endpoints
  // are wired for the multi-chain explorer router (TODO: see
  // docs/MIGRATION_GAPS.md). Until that lands, indexing on the listed
  // chains will lose ABI-based action decoding and fall straight through
  // to the 4byte signature lookup.
  ROUTESCAN: {
    // Avalanche (43114) and any other EVM chain Etherscan v2 misses.
    BASE_URL: str("ROUTESCAN_API_BASE_URL", "https://api.routescan.io/v2/network/mainnet/evm"),
  },
  ZKSYNC_EXPLORER: {
    // zkSync Era (324) — its own block-explorer API.
    MAINNET_BASE_URL: str("ZKSYNC_EXPLORER_MAINNET_BASE_URL", "https://block-explorer-api.mainnet.zksync.io/api"),
  },
  BLOCKSCOUT: {
    // Citrea (4114) — only Blockscout indexes it.
    CITREA_BASE_URL: str("BLOCKSCOUT_CITREA_BASE_URL", "https://explorer.mainnet.citrea.xyz/api"),
  },
  SUBSCAN: {
    // Peaq (3338) — Substrate-based, needs Subscan rather than EVM
    // explorer. API key is optional (free tier rate-limits).
    PEAQ_BASE_URL: str("SUBSCAN_PEAQ_BASE_URL", "https://peaq.api.subscan.io"),
    API_KEY: str("SUBSCAN_API_KEY", ""),
  },

  // 4byte directory — selector → signature lookup, used by both the
  // proposal-action decoder (Stage 4 fallback) and the SelectorPermission
  // decoder. No API key needed.
  FOUR_BYTE: {
    URI: str("FOUR_BYTE_URI", "https://www.4byte.directory/api/v1"),
  },

  IPFS: {
    PINATA_GATEWAY: str("PINATA_GATEWAY_URI", "https://aragon-1.mypinata.cloud/ipfs/"),
    DEDICATED_GATEWAY: str("ENVIO_IPFS_GATEWAY_URL", ""),
    PUBLIC_GATEWAYS: list("IPFS_PUBLIC_GATEWAYS", [
      "https://ipfs.io/ipfs/",
      "https://dweb.link/ipfs/",
      "https://cloudflare-ipfs.com/ipfs/",
    ]),
    TIMEOUT_MS: num("IPFS_FETCH_TIMEOUT_MS", 10_000),
  },

  LOG: {
    LEVEL: str("LOG_LEVEL", "info"),
    LOGZIO_KEY: str("LOGZIO_KEY", ""),
    LOGZIO_HOST: str("LOGZIO_HOST", "listener.logz.io"),
    LOGZIO_TYPE: str("LOGZIO_TYPE", "aragon-indexer"),
    ENVIRONMENT: str("ENVIRONMENT", "local"),
  },

  // Handler-time RPC reads use the same providers as HyperSync (see
  // `config.yaml`). `RPC_URL_<chainId>` env override wins if set. Public
  // fallbacks are heavily rate-limited and may silently drop requests.
  RPC: {
    URLS: rpcUrls(),
  },
} as const;

export type ChainId = keyof typeof config.RPC.URLS;

function rpcUrls() {
  const drpcKey = src.NODES_DRPC_API_KEY ?? "";
  const alchemyKey = src.NODES_ALCHEMY_API_KEY ?? "";

  const drpcUrl = (network: string, fallback: string) =>
    drpcKey ? `https://lb.drpc.org/ogrpc?network=${network}&dkey=${drpcKey}` : fallback;
  const alchemyUrl = (network: string, fallback: string) =>
    alchemyKey ? `https://${network}.g.alchemy.com/v2/${alchemyKey}` : fallback;
  // Prefer DRPC, then Alchemy, then the public fallback. Per-chain env
  // override (`RPC_URL_<id>`) wins over all of them when set.
  const pick = (chainId: number, drpcNet: string, alchemyNet: string, publicUrl: string) =>
    str(`RPC_URL_${chainId}`, drpcUrl(drpcNet, alchemyUrl(alchemyNet, publicUrl)));

  return {
    1: pick(1, "ethereum", "eth-mainnet", "https://ethereum-rpc.publicnode.com"),
    10: pick(10, "optimism", "opt-mainnet", "https://optimism-rpc.publicnode.com"),
    137: pick(137, "polygon", "polygon-mainnet", "https://polygon-bor-rpc.publicnode.com"),
    324: str("RPC_URL_324", "https://mainnet.era.zksync.io"),
    3338: str("RPC_URL_3338", "https://peaq.api.onfinality.io/public"),
    4114: str("RPC_URL_4114", "https://rpc.mainnet.citrea.xyz"),
    8453: pick(8453, "base", "base-mainnet", "https://base-rpc.publicnode.com"),
    42161: pick(42161, "arbitrum", "arb-mainnet", "https://arbitrum-one-rpc.publicnode.com"),
    43114: pick(43114, "avalanche", "avax-mainnet", "https://avalanche-c-chain-rpc.publicnode.com"),
    88888: str("RPC_URL_88888", "https://rpc.chiliz.com"),
    747474: str("RPC_URL_747474", "https://rpc.katana.network"),
    11155111: pick(11155111, "sepolia", "eth-sepolia", "https://ethereum-sepolia-rpc.publicnode.com"),
  } as const;
}
