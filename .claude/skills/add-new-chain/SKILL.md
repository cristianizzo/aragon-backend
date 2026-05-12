---
name: add-new-chain
description: >-
  Use when enabling a new chain in the indexer (or re-enabling one that's
  currently commented out in config.yaml). Step-by-step checklist of every
  file that needs editing — config.yaml chain block, src/config/index.ts
  RPC URL, src/helpers/rpcProvider.ts CHAIN_BY_ID map (with defineChain
  for non-viem-bundled chains), src/constants.ts NATIVE_AS_ERC20_CHAINS
  if applicable, .env vars, docs/CHAIN_INTEGRATIONS.md mapping, and the
  data you need to gather first (Aragon contract addresses, deploy block,
  RPC endpoint, native-token-as-ERC20 status).
---

# Add a New Chain

## Step 0 — gather the inputs

Before touching any code, collect:

| Need | How to find |
|---|---|
| **Chain ID** (`uint256`) | chainlist.org, RPC `eth_chainId`, or Envio's HyperSync supported networks page |
| **Aragon contracts deploy block** | the block where `DAORegistry` was deployed — earliest contract creation tx; or earliest `DAORegistered` event from the factory. Use this as `start_block` |
| **DAORegistry / PluginRepoRegistry / PluginSetupProcessor addresses** | `https://github.com/aragon/osx-commons` / Aragon docs / mongo prod (look at any DAO from this chain and follow `daoAddress` → `register()` caller) |
| **Trusted RPC** | DRPC and/or Alchemy URL (chain-specific). Public RPCs work for low-volume dev |
| **Is native a wrapped ERC-20?** | true for zkSync (ETH wrapped) and Peaq (PEAQ at `0x...0809`). Affects `NATIVE_AS_ERC20_CHAINS` |
| **Block explorer** | Etherscan v2 multichain support? Routescan? Blockscout? Subscan? See `docs/CHAIN_INTEGRATIONS.md` |
| **CoinGecko on-chain network ID + native coin ID** | for prices later — not blocking |

## Step 1 — `config.yaml` chain block

Add (or uncomment) under `chains:`:

```yaml
- id: <chainId>
  start_block: <deployBlock>
  rpc:
    - url: https://lb.drpc.org/ogrpc?network=<network>&dkey=${NODES_DRPC_API_KEY}
    - url: https://<chain>-mainnet.g.alchemy.com/v2/${NODES_ALCHEMY_API_KEY}
  contracts:
    # Phase 1 — addresses required (top-level registries)
    - name: DAORegistry
      address: ["0x..."]
    - name: PluginRepoRegistry
      address: ["0x..."]
    - name: PluginSetupProcessor
      address: ["0x..."]
    # Phase 2+ — no address (registered dynamically via contractRegister)
    - name: DAO
    - name: Multisig
    - name: TokenVoting
    - name: StagedProposalProcessor
    - name: GovernanceERC20
    - name: VotingEscrow
    - name: ExitQueue
    - name: LockManager
    - name: LockToVote
    - name: GaugeVoter
    - name: CapitalDistributor
    - name: ExecuteSelectorCondition
    - name: ERC20  # wildcard treasury indexing
```

**Address checksums must be EIP-55** — verify with `viem.getAddress("0x...")`. Never lowercase.

**For chains without unique env-var-based RPC URLs** (peaq, citrea, etc.), use a literal placeholder URL like `https://<chain>-rpc-url` rather than `${SOME_VAR}` — Envio interpolates env vars at codegen time, missing vars block startup even on commented chain blocks.

## Step 2 — `.env` (if RPC needs API keys)

Most chains share `NODES_DRPC_API_KEY` + `NODES_ALCHEMY_API_KEY` (already in `.env`). Add new vars only if the chain uses a unique provider:

```bash
NODES_<CHAIN>_RPC_URL=https://...
```

## Step 3 — `src/config/index.ts` RPC URL

Add an entry under `RPC.URLS`:

```ts
RPC: {
  URLS: {
    1: str("RPC_URL_1", "https://ethereum-rpc.publicnode.com"),
    // ...
    <chainId>: str("RPC_URL_<chainId>", "https://<public-rpc-default>"),
  },
}
```

Used by `getClient(chainId)` for ad-hoc viem reads (effects). Defaults to a public RPC; override with `RPC_URL_<chainId>` env var in prod.

## Step 4 — `src/helpers/rpcProvider.ts` chain definition

If the chain is bundled with viem (`viem/chains`), just import + add to `CHAIN_BY_ID`:

```ts
import { mantle } from "viem/chains";
const CHAIN_BY_ID: Record<ChainId, Chain> = {
  // ...
  5000: mantle,
};
```

For non-bundled chains, use `defineChain` (already done for katana, peaq, citrea):

```ts
const myChain = defineChain({
  id: <chainId>,
  name: "ChainName",
  nativeCurrency: { name: "Token", symbol: "TKN", decimals: 18 },
  rpcUrls: { default: { http: ["https://..."] } },
});
```

## Step 5 — `src/constants.ts` `NATIVE_AS_ERC20_CHAINS` (conditional)

If the chain wraps native as ERC-20 (zkSync, Peaq pattern), add to the set:

```ts
export const NATIVE_AS_ERC20_CHAINS: ReadonlySet<number> = new Set([
  324,   // zksync
  3338,  // peaq
  <chainId>,  // new chain — only if applicable
]);
```

Otherwise leave alone. Native handlers in `src/handlers/DAO.ts` skip these chains to avoid double-counting (the wildcard ERC-20 handler catches the wrapped-native transfers).

## Step 6 — `docs/CHAIN_INTEGRATIONS.md`

Add a row to the per-chain tables for:
- block-explorer source/ABI cascade
- token balance source
- native token (and ZERO_ADDRESS vs ERC-20 wrapper)
- token + native price API mapping
- historical price provider
- recommended RPC providers

This is the source of truth for "which external service does what per chain" — keep in sync.

## Step 7 — codegen + tsc + verify

```bash
pnpm codegen
pnpm tsc --noEmit
```

If codegen fails on env-var interpolation for a commented chain block, see Step 1 note about literal placeholder URLs.

Then run `pnpm dev` and watch:
- the new chain appears in the indexer's chain list
- `[handlers:DAORegistry] Dao created` debug logs fire (with `LOG_LEVEL=debug`)
- after some blocks, GraphQL `Dao_aggregate(where: {chainId: <new>})` returns rows

## Files touched (summary)

| File | Always | Conditional |
|---|---|---|
| `config.yaml` | ✅ chain block + contracts | |
| `src/config/index.ts` | ✅ RPC.URLS entry | |
| `src/helpers/rpcProvider.ts` | ✅ CHAIN_BY_ID + maybe defineChain | |
| `src/constants.ts` | | only if native-as-ERC-20 |
| `.env` | | only if chain needs unique API keys |
| `docs/CHAIN_INTEGRATIONS.md` | ✅ per-chain table rows | |

## Related skills

- `chain-integrations` — full per-chain table of explorer / price / RPC mappings
- `aragon-dao` — what the indexer does once the chain is producing events
- `indexing-config` — config.yaml structure rules
- `indexing-multichain` — Envio's general multi-chain patterns (entity ID namespacing, context.chain)