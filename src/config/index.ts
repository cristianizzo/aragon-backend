/**
 * Env-driven config for the Aragon indexer — pure data, read once at import.
 * No logic here; helpers consume this for URLs / API keys / timeouts.
 *
 * Every env var name uses the `ENVIO_` prefix. The Envio Hosted Service
 * (cloud) only forwards env vars starting with `ENVIO_` through to the
 * running indexer, so any var without the prefix is silently dropped in
 * production. Keeping the prefix on all of them — including ones the
 * indexer reads outside the hosted runtime (CI, local dev) — gives a
 * single naming convention and avoids "works locally but missing in
 * cloud" surprises.
 */

const src = process.env;

const str = (key: string, fallback: string): string => src[key] ?? fallback;
/**
 * Read a positive number env var. Falls back when the value is missing
 * OR parses to `NaN` / negative — protects callers from silently
 * propagating bad values into downstream APIs (e.g. timeouts).
 */
const num = (key: string, fallback: number): number => {
  const raw = src[key];
  if (raw === undefined || raw === "") return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
};
const list = (key: string, fallback: readonly string[]): readonly string[] =>
  src[key] ? (src[key] as string).split(",") : fallback;

export const config = {
  // Etherscan v2 — multi-chain ABI / source-code lookup. Used by the
  // proposal-action decoder pipeline (stage 3, after KNOWN_ABIs and
  // EIP-1967 proxy resolution). Covers most EVM chains via the v2 API.
  // Without an API key the call is skipped and the decoder falls through
  // to the 4byte fallback.
  ETHERSCAN: {
    API_KEY: str("ENVIO_ETHERSCAN_API_KEY", ""),
    BASE_URL: str("ENVIO_ETHERSCAN_API_BASE_URL", "https://api.etherscan.io/v2/api"),
  },

  // Per-chain explorer fallbacks for chains Etherscan v2 doesn't index —
  // resolved by the multi-chain explorer router in
  // `src/helpers/explorers/`. Chiliz / Corn route to Routescan, Citrea to
  // Blockscout, Peaq to Subscan, zkSync Era to its own explorer.
  ROUTESCAN: {
    // Avalanche (43114) and any other EVM chain Etherscan v2 misses.
    BASE_URL: str("ENVIO_ROUTESCAN_API_BASE_URL", "https://api.routescan.io/v2/network/mainnet/evm"),
  },
  ZKSYNC_EXPLORER: {
    // zkSync Era (324) — its own block-explorer API.
    MAINNET_BASE_URL: str("ENVIO_ZKSYNC_EXPLORER_MAINNET_BASE_URL", "https://block-explorer-api.mainnet.zksync.io/api"),
  },
  BLOCKSCOUT: {
    // Citrea (4114) — only Blockscout indexes it.
    CITREA_BASE_URL: str("ENVIO_BLOCKSCOUT_CITREA_BASE_URL", "https://explorer.mainnet.citrea.xyz/api"),
  },
  SUBSCAN: {
    // Peaq (3338) — Substrate-based, needs Subscan rather than EVM
    // explorer. API key is optional (free tier rate-limits).
    PEAQ_BASE_URL: str("ENVIO_SUBSCAN_PEAQ_BASE_URL", "https://peaq.api.subscan.io"),
    API_KEY: str("ENVIO_SUBSCAN_API_KEY", ""),
  },

  // 4byte directory — selector → signature lookup, used by both the
  // proposal-action decoder (stage 4 fallback) and the SelectorPermission
  // decoder. No API key needed.
  FOUR_BYTE: {
    URI: str("ENVIO_FOUR_BYTE_URI", "https://www.4byte.directory/api/v1"),
  },

  IPFS: {
    PINATA_GATEWAY: str("ENVIO_PINATA_GATEWAY_URI", "https://aragon-1.mypinata.cloud/ipfs/"),
    DEDICATED_GATEWAY: str("ENVIO_IPFS_GATEWAY_URL", ""),
    PUBLIC_GATEWAYS: list("ENVIO_IPFS_PUBLIC_GATEWAYS", [
      "https://ipfs.io/ipfs/",
      "https://dweb.link/ipfs/",
      "https://cloudflare-ipfs.com/ipfs/",
    ]),
    TIMEOUT_MS: num("ENVIO_IPFS_FETCH_TIMEOUT_MS", 10_000),
  },

  LOG: {
    LEVEL: str("ENVIO_LOG_LEVEL", "info"),
    LOGZIO_KEY: str("ENVIO_LOGZIO_KEY", ""),
    LOGZIO_HOST: str("ENVIO_LOGZIO_HOST", "listener.logz.io"),
    LOGZIO_TYPE: str("ENVIO_LOGZIO_TYPE", "aragon-indexer"),
    ENVIRONMENT: str("ENVIO_ENVIRONMENT", "local"),
  },

  // Handler-time RPC reads use the same providers as HyperSync (see
  // `config.yaml`). `ENVIO_RPC_URL_<chainId>` env override wins if set.
  // Public fallbacks are heavily rate-limited and may silently drop
  // requests.
  RPC: {
    URLS: rpcUrls(),
  },
} as const;

export type ChainId = keyof typeof config.RPC.URLS;

function rpcUrls() {
  const drpcKey = src.ENVIO_NODES_DRPC_API_KEY ?? "";
  const alchemyKey = src.ENVIO_NODES_ALCHEMY_API_KEY ?? "";

  const drpcUrl = (network: string, fallback: string) =>
    drpcKey ? `https://lb.drpc.org/ogrpc?network=${network}&dkey=${drpcKey}` : fallback;
  const alchemyUrl = (network: string, fallback: string) =>
    alchemyKey ? `https://${network}.g.alchemy.com/v2/${alchemyKey}` : fallback;
  // Prefer DRPC, then Alchemy, then the public fallback. Per-chain env
  // override (`ENVIO_RPC_URL_<id>`) wins over all of them when set.
  const pick = (chainId: number, drpcNet: string, alchemyNet: string, publicUrl: string) =>
    str(`ENVIO_RPC_URL_${chainId}`, drpcUrl(drpcNet, alchemyUrl(alchemyNet, publicUrl)));

  return {
    1: pick(1, "ethereum", "eth-mainnet", "https://ethereum-rpc.publicnode.com"),
    10: pick(10, "optimism", "opt-mainnet", "https://optimism-rpc.publicnode.com"),
    137: pick(137, "polygon", "polygon-mainnet", "https://polygon-bor-rpc.publicnode.com"),
    324: str("ENVIO_RPC_URL_324", "https://mainnet.era.zksync.io"),
    3338: str("ENVIO_RPC_URL_3338", "https://peaq.api.onfinality.io/public"),
    4114: str("ENVIO_RPC_URL_4114", "https://rpc.mainnet.citrea.xyz"),
    8453: pick(8453, "base", "base-mainnet", "https://base-rpc.publicnode.com"),
    42161: pick(42161, "arbitrum", "arb-mainnet", "https://arbitrum-one-rpc.publicnode.com"),
    43114: pick(43114, "avalanche", "avax-mainnet", "https://avalanche-c-chain-rpc.publicnode.com"),
    88888: str("ENVIO_RPC_URL_88888", "https://rpc.chiliz.com"),
    747474: str("ENVIO_RPC_URL_747474", "https://rpc.katana.network"),
    11155111: pick(11155111, "sepolia", "eth-sepolia", "https://ethereum-sepolia-rpc.publicnode.com"),
  } as const;
}
