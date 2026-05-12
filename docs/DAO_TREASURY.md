# DAO Treasury — Architecture

How the indexer covers DAO transfers + asset balances. Single process,
event-driven, mirrors the legacy app-backend approach.

## Source-of-truth split

| Entity row | Source event | Handler |
|---|---|---|
| `Transaction` where `type='nativeToken'` & `side='deposit'` | `DAO.NativeTokenDeposited(sender, amount)` | `src/handlers/DAO.ts` |
| `Transaction` where `type='nativeToken'` & `side='withdraw'` | `DAO.Executed.actions[]` (V1 + V2), `value > 0` | `src/handlers/DAO.ts` |
| `Transaction` where `type='erc20'` | wildcard `ERC20.Transfer(from, to, value)`, handler-time `Dao.get` filter | `src/handlers/ERC20.ts` |
| `Asset` where `tokenAddress = ZERO_ADDRESS` | derived from native `Transaction` rows (deposit adds, withdraw subtracts) | `src/services/asset.ts` |
| `Asset` where `tokenAddress != ZERO_ADDRESS` | derived from erc20 `Transaction` rows | same |

## Native — two events, three signatures

Native flows hit two events on the DAO contract itself (we already register
each DAO via `addDAO()` in `DAORegistry.contractRegister`, so both events
auto-route to our handlers):

- **Deposit:** `NativeTokenDeposited(address indexed sender, uint256 amount)` —
  same signature in OSx v1 and v2, single subscription catches both.
- **Withdraw:** `Executed(...)` — V1 and V2 have different signatures:
  - V1: `Executed(actor, callId, actions[], allowFailureMap, failureMap, execResults)`
  - V2: `Executed(actor, callId, actions[], failureMap, execResults)` (no `allowFailureMap`)

  Different topic hashes, separate subscriptions in `config.yaml` (V2 aliased
  as `ExecutedV2`). Both handlers funnel into the same `recordNativeWithdraws`
  helper since `actions[]` sits at the same position.

## ERC-20 — wildcard

Per Envio's recommended pattern for indexing across thousands of contracts:

```ts
ERC20.Transfer.handler(async ({ event, context }) => {
  const fromDao = await context.Dao.get(daoId(chainId, from));
  const toDao = await context.Dao.get(daoId(chainId, to));
  if (!fromDao && !toDao) return;
  // record + update Asset
}, { wildcard: true });
```

Subscribes to every `Transfer` event on every contract on the chain. Filter
runs at handler time via `context.Dao.get` (in-memory cached after first hit).
99.99% of events return early.

## Skip native indexing on zkSync (324) + Peaq (3338)

`NATIVE_AS_ERC20_CHAINS` in `src/constants.ts` lists chains where the native
token is wrapped as an ERC-20 contract. On those chains every "native"
transfer also fires the standard ERC-20 `Transfer` event — our wildcard
handler catches it. Running `NativeTokenDeposited` / `Executed`-action
handlers on those chains would double-count.

Both native handlers in `src/handlers/DAO.ts` short-circuit if
`event.chainId ∈ NATIVE_AS_ERC20_CHAINS`. Mirrors legacy
`DaoTransactions.start` skipping the native crawlers on those networks.

## What's NOT covered (deferred)

| Flow | Plan |
|---|---|
| ERC-721 transfers in/out | extend wildcard handler — same pattern, different event sig (`Transfer(address indexed from, address indexed to, uint256 indexed tokenId)`) |
| ERC-1155 transfers | low priority |
| Selfdestruct sends to a DAO | only catchable via traces; HyperIndex has no `onTrace` API today. Same gap legacy has. |
| Coinbase rewards / pre-deployment balances | edge cases — both legacy and us miss them |
| USD pricing / spam scoring / token catalog enrichment | future enrichment service, outside this indexer |
| Authoritative balance reconciliation against on-chain `balanceOf` | future enrichment service |

## Why we don't run a trace sidecar

We briefly built a sidecar process using `@envio-dev/hypersync-client` to
catch native flows that don't emit events. Verified empirically (via the
legacy production MongoDB) that **all OSx versions emit `NativeTokenDeposited`**,
including v1.0 — sample DAO `0x9c25a6b1bf3F6Fd2F68a62169c043045C2460482` (v1.0)
has 14 native deposits in legacy data. So the gap we worried about doesn't
exist; the event-based approach matches legacy's coverage.

The sidecar still has theoretical advantages (catches selfdestruct, coinbase
rewards) but adds operational complexity (separate process, no reorg handling
inside HyperIndex's machinery, trace endpoint only on a subset of chains).
Not worth it for marginal coverage.

## Status

| Flow | Status |
|---|---|
| Native deposit (modern + v1.0 DAOs) | ✅ via `DAO.NativeTokenDeposited` |
| Native withdraw (V1 + V2 DAOs) | ✅ via `DAO.Executed` + `DAO.ExecutedV2` action parsing |
| ERC-20 in/out (every token contract) | ✅ via `ERC20.Transfer` wildcard |
| Asset balance derivation | ✅ — running balance from event history |
| ERC-721 / ERC-1155 | ❌ deferred |
| USD pricing / spam / decimals catalog | ❌ enrichment service later |
