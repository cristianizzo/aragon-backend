---
name: chain-integrations
description: >-
  Use when working on per-chain integrations — block explorers (Etherscan,
  Routescan, zkSync, Blockscout, Subscan), token balances, token / native /
  historical prices (CoinGecko, Alchemy Price API), Tenderly simulation, or
  RPC provider routing (Alchemy / DRPC / public). Covers which service each
  of the 12 supported chains uses as primary + fallback, including special
  cases (Citrea uses Blockscout, Peaq uses Subscan + ERC-20-mapped native,
  Chiliz can't use Etherscan, etc.). Reference: docs/CHAIN_INTEGRATIONS.md.
---

# Chain Integrations

Full per-chain mapping lives at `docs/CHAIN_INTEGRATIONS.md` (single source of truth — keep it in sync when code changes).

## Supported chains

`1, 10, 137, 324, 3338, 4114, 8453, 11155111, 42161, 43114, 88888, 747474`
(ethereum, optimism, polygon, zksync, peaq, citrea, base, sepolia, arbitrum, avalanche, chiliz, katana)

Listed in `src/config/index.ts` under `RPC.URLS` (the `ChainId` type derives from these keys).

## What goes where

| Concern | File |
|---|---|
| URL / API key / timeout / endpoint | `src/config/index.ts` (env-driven, zero logic) |
| viem `PublicClient` cache + `getClient/getClientSafe` | `src/helpers/rpcProvider.ts` |
| Per-chain explorer cascade (e.g. `[Etherscan, Routescan]` for ethereum, `[Blockscout]` for citrea) | helper (not yet implemented — `helpers/explorerProvider.ts` planned) |
| CoinGecko `networkId` / `nativeTokenId` lookup | helper (not yet implemented — `helpers/priceProvider.ts` planned) |
| Alchemy network slug for historical prices | helper (not yet implemented) |
| Tenderly simulation client | helper (not yet implemented — `helpers/tenderly.ts` planned) |

## Quick reference (special cases)

- **Citrea (4114)**: only Blockscout indexes it. Alchemy enhanced API (`alchemy_getTokenBalances`) returns `EAPIs not enabled` — must route to Blockscout v2 token-balance endpoint. CoinGecko does NOT have Citrea in its on-chain index → no token prices, only native (`bitcoin` → cBTC).
- **Peaq (3338)**: Substrate chain. Native token tracked as ERC-20 at `0x0000000000000000000000000000000000000809`. Subscan is the only explorer; Alchemy/DRPC don't support it.
- **Chiliz (88888)**: Etherscan v2 multichain does NOT support it — Routescan only.
- **Katana (747474)**: Etherscan v2 supports it. Token balances via Etherscan (Alchemy not available).
- **zkSync (324)**: zkSync block explorer is primary; Etherscan/Routescan are fallbacks because zkSync has its own ABI format quirks.

## When code changes

If you add/remove a chain, change explorer routing, change price API mapping, or change Tenderly config:

1. Update `src/config/index.ts` (URLs, keys, timeouts).
2. Update the helper that does the routing (when implemented).
3. **Update `docs/CHAIN_INTEGRATIONS.md`** — the table is the contract for what's expected per chain.
4. Update `config.yaml` if the chain itself changes (start_block, registry addresses, contract list).

## Env var conventions

- RPC URL override: `RPC_URL_<chainId>` (e.g., `RPC_URL_137`)
- Explorer base URLs / keys: `<EXPLORER>_<KEY>` (e.g., `ETHERSCAN_API_KEY`, `ROUTESCAN_API_BASE_URL`, `BLOCKSCOUT_CITREA_BASE_URL`)
- Price APIs: `COINGECKO_*`, `ALCHEMY_PRICE_*`
- Tenderly: `TENDERLY_*`
- IPFS: `PINATA_GATEWAY_URI`, `ENVIO_IPFS_GATEWAY_URL`, `IPFS_PUBLIC_GATEWAYS`, `IPFS_FETCH_TIMEOUT_MS`

All env vars defined in one place: `src/config/index.ts`.