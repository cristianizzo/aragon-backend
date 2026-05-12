# Chain Integrations Reference

Per-chain mapping of which external services we use for each capability:
**block-explorer source/ABI**, **token balances**, **token prices**,
**historical prices**, and **RPC providers**. Mirrors the legacy
`app-backend` routing in `src/modules/proxyProvider/` and `src/helpers/`.

> Right now this indexer only consumes block-explorer data (Etherscan v2
> multichain) for action decoding. The other integrations are documented
> here for the upcoming MIGRATION_GAPS.md tiers (P2 treasury / TVL / prices).

---

## 1. Block-explorer (contract source + ABI + creation tx)

Primary explorer is tried first; if it returns nothing, the cascade falls
through to the next entry.

| Chain | Chain ID | Primary | Fallback(s) |
|---|---|---|---|
| ethereum | 1 | Etherscan v2 | Routescan |
| sepolia | 11155111 | Etherscan v2 | Routescan |
| polygon | 137 | Etherscan v2 | Routescan |
| arbitrum | 42161 | Etherscan v2 | Routescan |
| base | 8453 | Etherscan v2 | Routescan |
| optimism | 10 | Etherscan v2 | Routescan |
| zksync | 324 | **zkSync explorer** | Etherscan v2, Routescan |
| avalanche | 43114 | Etherscan v2 | Routescan |
| katana | 747474 | Etherscan v2 (multichain supports it) | — |
| peaq | 3338 | **Subscan** (no other support) | — |
| chiliz | 88888 | **Routescan** (no Etherscan support) | — |
| citrea | 4114 | **Blockscout** (Etherscan/Routescan don't index it) | — |

**Endpoints used:**
- Etherscan v2 multichain: `https://api.etherscan.io/v2/api?chainid=<id>&...`
- Routescan: `https://api.routescan.io/v2/network/mainnet/evm/<chainid>/etherscan/api?...`
- zkSync mainnet: `https://block-explorer-api.mainnet.zksync.io/api?...`
- Blockscout (citrea): `https://explorer.mainnet.citrea.xyz/api?...`
- Subscan (peaq): `https://peaq.api.subscan.io/api/...` (POST API, different shape)

---

## 2. Token balances (ERC-20 holdings of an address)

| Chain | Source |
|---|---|
| ethereum, sepolia, polygon, arbitrum, base, optimism, zksync, avalanche | Alchemy enhanced RPC `alchemy_getTokenBalances` |
| chiliz | Routescan |
| katana | Etherscan v2 multichain |
| peaq | Subscan |
| citrea | Blockscout v2 (Alchemy enhanced API not enabled there — returns `EAPIs not enabled on specified network`) |

---

## 3. Native token balance

Generic JSON-RPC `eth_getBalance` everywhere except:

| Chain | Special handling |
|---|---|
| peaq | Native token tracked as ERC-20 `0x0000000000000000000000000000000000000809` (native is fungible-token-mapped on substrate) |

---

## 4. Token prices (current)

CoinGecko **on-chain API**: `GET /onchain/networks/{networkId}/tokens/{tokenAddress}`

| Chain | CoinGecko `networkId` |
|---|---|
| ethereum | `eth` |
| polygon | `polygon_pos` |
| base | `base` |
| arbitrum | `arbitrum` |
| zksync | `zksync` |
| optimism | `optimism` |
| avalanche | `avax` |
| peaq | `peaq` |
| chiliz | `chiliz-chain` |
| katana | `katana` |
| citrea | **not supported** (no entry in CoinGecko on-chain index) |
| sepolia | testnet — no prices |

---

## 5. Native token prices

CoinGecko **coins API**: `GET /coins/{nativeTokenId}`

| Chain | CoinGecko `nativeTokenId` | Symbol |
|---|---|---|
| ethereum | `ethereum` | ETH |
| polygon | `polygon-ecosystem-token` | POL |
| base | `ethereum` | ETH |
| arbitrum | `ethereum` | ETH |
| zksync | `ethereum` | ETH |
| optimism | `ethereum` | ETH |
| avalanche | `avalanche-2` | AVAX |
| peaq | `peaq-2` | PEAQ |
| chiliz | `chiliz` | CHZ |
| katana | `ethereum` | ETH |
| citrea | `bitcoin` | cBTC |
| sepolia | `ethereum` (testnet — only used for native faucet ETH display) | ETH |

---

## 6. Historical token prices

Alchemy **Price API**: `POST /{apiKey}/tokens/historical` with `{ address, network }`

| Chain | Alchemy `network` identifier |
|---|---|
| ethereum | `ETH_MAINNET` |
| sepolia | `ETH_SEPOLIA` |
| polygon | `MATIC_MAINNET` |
| base | `BASE_MAINNET` |
| arbitrum | `ARB_MAINNET` |
| zksync | `ZKSYNC_MAINNET` |
| optimism | `OPT_MAINNET` |
| avalanche | `AVAX_MAINNET` |
| chiliz | `CHILIZ_MAINNET` |
| citrea | `CITREA_MAINNET` |
| peaq | **not supported** |
| katana | **not supported** |

For unsupported chains, historical prices fall through to CoinGecko historical
(`/coins/{id}/market_chart/range`) where available, or return `0`.

---

## 7. RPC providers

Each chain's RPC URL is read from `RPC_URL_<chainId>` (with a public-RPC
default in `src/config/index.ts`). The recommended priority for setting these
in production:

| Chain | Recommended primary | Fallback(s) |
|---|---|---|
| ethereum, sepolia, polygon, arbitrum, base, optimism, zksync, avalanche, chiliz, citrea | Alchemy | DRPC, public RPC |
| katana | DRPC or custom | public Katana RPC |
| peaq | OnFinality / public | — |

Alchemy network slugs (for setting Alchemy URLs):
`ETH_MAINNET, ETH_SEPOLIA, MATIC_MAINNET, BASE_MAINNET, ARB_MAINNET,
OPT_MAINNET, ZKSYNC_MAINNET, AVAX_MAINNET, CHILIZ_MAINNET, CITREA_MAINNET`.

DRPC network slugs:
`ETH_MAINNET, ETH_SEPOLIA, POLYGON_MAINNET, BASE_MAINNET, ARB_MAINNET,
OPT_MAINNET, ZKSYNC_MAINNET, AVAX_MAINNET, KATANA_MAINNET`.

---

## 8. Tenderly (transaction simulation)

Used for action simulation in proposal previews / dry-runs. Single account,
not per-chain; chain id is passed as a parameter to each simulation call.

Required env vars (no defaults):
- `TENDERLY_USER`
- `TENDERLY_PROJECT`
- `TENDERLY_ACCESS_KEY`

Optional with defaults:
- `TENDERLY_API_URL` = `https://api.tenderly.co/api/v1`
- `TENDERLY_SHARING_BASE_URL` = `https://www.tdly.co`
- `TENDERLY_MAX_CONCURRENT` = `1`
- `TENDERLY_MIN_TIME` = `3000` (ms between calls — Tenderly rate-limits hard)
- `TENDERLY_RE_SIMULATION_TIME` = `600000` (ms — re-simulate after 10 min)

---

## 9. Sources

- `app-backend/src/modules/proxyProvider/{web3,routescan,peaq,katana}Provider.ts` — explorer routing
- `app-backend/src/helpers/coinGecko.ts` — CoinGecko networksMap + nativeTokenIdMap
- `app-backend/src/helpers/alchemy.ts` — Alchemy enhanced API
- `app-backend/src/modules/rates.ts` — Alchemy historical price API
- `app-backend/src/modules/provider.ts` — alchemyNetworksMap + drpcNetworksMap
- `app-backend/src/helpers/evmExplorerClient.ts` — EvmExplorerEnum + per-explorer URL builders
- `app-backend/config/common.ts` — env var definitions for all of the above
