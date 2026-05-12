---
name: aragon-token
description: >-
  Use when working on the Token entity, ERC-20/721 detection, governance /
  escrow / spam classification, wrapper / proxy detection, mint authority
  resolution, IERC6372 clock mode, or the cross-handler `addToken` service.
  References: src/services/token.ts, src/effects/rpc.ts (fetchTokenMetadata),
  src/utils/tokenInterface.ts (bytecode detector), src/utils/spam.ts.
---

# Aragon Token

Token entity covers everything chain-derivable about an ERC-20/721 contract.
Pricing, logos, holder counts, and periodic refresh are deliberately
out-of-scope — see `enrichment-service` skill for the planned external worker.

## Schema (19 fields)

```graphql
enum TokenType { nativeToken, erc20, erc721 }
enum ClockMode { blocknumber, timestamp }

type Token {
  id: ID!                          # ${chainId}-${address}
  chainId: Int!
  address: String!
  blockNumber: Int!                # first-seen — when our indexer wrote this row
  blockTimestamp: Int!
  transactionHash: String!
  type: TokenType!                 # bytecode selector match (default erc20)
  isGovernance: Boolean!           # bytecode (ERC20Votes) OR plugin attachment
  isEscrowAdapter: Boolean!        # bytecode (escrow() + clock())
  isSpam: Boolean!                 # heuristic; exempts governance/escrow/native/testnet
  spamScore: Int!
  mintableByDao: Boolean!          # forward-flip from Granted + backward-lookup at addToken
  name: String                     # RPC name() — null if reverts
  symbol: String                   # RPC symbol()
  decimals: Int                    # RPC decimals()
  totalSupply: BigInt              # RPC totalSupply()
  underlying: String               # RPC underlying() OR token() — null for plain tokens
  implementationAddress: String    # EIP-1967 proxy slot — null for non-proxies
  clockMode: ClockMode             # parsed from CLOCK_MODE() — null for non-IERC6372
}
```

## `addToken` service (`src/services/token.ts`)

Sole entry point for creating Token rows. Idempotent — subsequent calls for
the same `(chainId, tokenAddress)` are no-ops, except the `isGovernance` flag
flips false→true when a plugin later attaches to a previously-discovered token.

```ts
addToken(context, {
  chainId,
  tokenAddress,
  blockNumber,
  blockTimestamp,
  transactionHash,
  isGovernance?: boolean,   // optional — caller can force-true (plugin attachment)
})
```

**Skips ZERO_ADDRESS** (native — no contract to read).

### Call sites

| Caller | When | `isGovernance` flag |
|---|---|---|
| `src/handlers/ERC20.ts` (wildcard Transfer) | every Transfer where to/from is a known DAO | not passed (defaults to bytecode detection) |
| `src/handlers/PluginSetupProcessor.ts` (InstallationPrepared) | a plugin holds a `tokenAddress` (token-voting / lock-to-vote) | **`true`** — plugin attachment overrides bytecode |

## Detection mechanisms

### Bytecode-based (`src/utils/tokenInterface.ts`)

Pure helper, no I/O. Caller resolves proxy → impl bytecode first. Selector lists
ported verbatim from legacy `app-backend/src/helpers/tokenDetector.ts`.

| Detector | Selectors needed | Result |
|---|---|---|
| `type = erc20` | 6 ERC20 standard selectors (`totalSupply`, `balanceOf`, `transfer`, `transferFrom`, `approve`, `allowance`) | `type` field |
| `type = erc721` | 7 ERC721 standard selectors (`ownerOf`, `balanceOf`, `approve`, ...) | `type` field |
| `isGovernance` (bytecode side) | 3 ERC20Votes selectors (`getVotes`, `getPastVotes`, `getPastTotalSupply`) | OR'd with plugin-attachment flag |
| `isEscrowAdapter` | `escrow()` + `clock()` selectors | `isEscrowAdapter` field |

### RPC-based (in `fetchTokenMetadata` effect)

All run in parallel via `tryAsync` — failures resolve to undefined, not throw:

| Call | Field |
|---|---|
| `name()`, `symbol()`, `decimals()` | `name`, `symbol`, `decimals` |
| `totalSupply()` | `totalSupply` |
| `underlying()` (Compound, ERC4626) → `token()` (Aave, escrow adapter) | `underlying` |
| `getStorageAt(EIP1967_IMPL_SLOT)` | `implementationAddress` |
| `getCode(address)` then `getCode(impl)` if proxy | bytecode for `tokenInterface` detector |
| `CLOCK_MODE()` | parsed via `parseClockMode()` → `ClockMode` enum |

Effect is cached (`createEffect({cache: true})`), so RPC happens once per
unique `(chainId, tokenAddress)`.

### Derived from indexer state

| Field | Source |
|---|---|
| `isGovernance` (plugin-attachment side) | `addToken` caller passes `isGovernance: true` from `PluginSetupProcessor.InstallationPrepared`. OR'd with bytecode detection. |
| `mintableByDao` (forward) | `DAO.Granted` handler — when `event.params.permissionId === MINT_PERMISSION_ID`, looks up Token at `event.params.where` and flips `mintableByDao=true` if exists |
| `mintableByDao` (backward) | `addToken` queries `context.DaoPermission.getWhere({permissionId: MINT_PERMISSION_ID, whereAddress: tokenAddress})` on creation |
| `isSpam`, `spamScore` | `src/utils/spam.ts` heuristic over name/symbol with chain/governance/escrow/native exemption |

## Cross-handler patterns

### Plugin attachment → governance flip + spam clear

When `PluginSetupProcessor.InstallationPrepared` runs for a plugin that holds
a token (token-voting / lock-to-vote), `addToken(..., isGovernance: true)` is
called. Inside the service:

```ts
if (existing) {
  if (params.isGovernance && !existing.isGovernance) {
    context.Token.set({ ...existing, isGovernance: true, isSpam: false });
    // Governance tokens are never spam (legacy rule).
  }
  return;
}
```

So a token first discovered as spammy via a Transfer event gets unspammed
when a plugin attaches to it.

### Mint-authority forward + backward lookup

The MINT_PERMISSION grant and the token discovery can happen in either order
(plugin-installed-then-tokens-transferred OR tokens-transferred-then-plugin-installed).
Both paths covered:

- **Forward** (Granted fires first, Token already exists, or Token comes later):
  `DAO.Granted` handler looks up Token at `event.params.where`. If exists, flips
  `mintableByDao=true`. If not, no-op — backward path catches it.
- **Backward** (Token created first, Granted fired earlier):
  `addToken` runs `DaoPermission.getWhere({permissionId: MINT_PERMISSION_ID, whereAddress})`
  on creation — any matching Granted row sets `mintableByDao=true`.

## Spam heuristic (`src/utils/spam.ts`)

Pure function, no I/O. Score from name/symbol patterns:
- `+3` URL or shortened-URL domain
- `+2` per high-risk keyword (airdrop, casino, free, ...)
- `+1` per low-risk keyword (claim, reward, ...)
- `+2` per red-flag pattern (emojis, fake URLs, big-dollar amounts, ...)

Decision:
- testnet (chainId in `TESTNET_CHAIN_IDS`) → not spam
- nativeToken / governance / escrowAdapter → not spam
- score ≥ 5 → spam
- score = 0 → not spam
- score ≥ 2 → spam

Differences from legacy: dropped the "no logo +1" rule (we never have logo)
and the "has CoinGecko price → not spam" rescue (we never have priceUsd).
Both belong in the future enrichment service.

## Constants used

- `MINT_PERMISSION_ID` (`src/constants.ts`) — `keccak256(toHex("MINT_PERMISSION"))`. Computed, not hardcoded.
- `EIP1967_IMPL_SLOT` (`src/constants.ts`) — `keccak256("eip1967.proxy.implementation") - 1`.
- `TESTNET_CHAIN_IDS` (`src/constants.ts`) — chains exempt from spam scoring.
- `ZERO_ADDRESS` — native token sentinel (Token rows skip ZERO_ADDRESS in `addToken`; native flows use `Asset.tokenAddress = ZERO_ADDRESS` instead).

## What's NOT in the indexer

| Field | Why | Where it goes |
|---|---|---|
| `priceUsd`, `logo` | needs CoinGecko on-chain API | enrichment service |
| `holders` | maintaining holder set per token = expensive cross-event aggregation | enrichment service |
| `lastUpdatedAt`, `nextFetchRateAt`, `skipFetchRate`, `fetchRateFailCount`, `totalSupplyUpdatedAt` | refresh-scheduling internals | enrichment service |
| `spamSource` (CMS/AUTO enum) | only AUTO heuristic exists today | add when CMS admin override lands |
| `ignoreTransfer` (admin override) | manual blocklist | static config when needed |
| `hasName / hasSymbol / hasDecimals / hasTotalSupply / hasBalanceOf* / hasDelegate / hasClockMode` | duplicates field-nullability info | skip permanently |

See `enrichment-service` skill for the design of the external worker.

## Related skills

- `enrichment-service` — design plan for the external worker (pricing, logos, holders, refresh)
- `aragon-dao` — wildcard ERC20.Transfer handler (the main `addToken` caller)
- `aragon-plugins` — PluginSetupProcessor calls `addToken` with isGovernance:true for plugin-attached tokens
- `chain-integrations` — per-chain provider matrix (referenced by enrichment service for CoinGecko / explorer routing)
