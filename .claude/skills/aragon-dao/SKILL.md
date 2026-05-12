---
name: aragon-dao
description: >-
  Use when working on DAO registration, metadata, permissions, native +
  ERC-20 transfers, asset balances, or any other Dao-entity flow. Covers
  DAORegistered → Dao + Member, MetadataSet → IPFS enrichment (with
  stub-then-merge for same-tx ordering), Granted/Revoked → DaoPermission,
  NativeTokenDeposited + Executed.actions → native Transactions + Assets,
  wildcard ERC20.Transfer → erc20 Transactions + Assets, and the
  cross-handler `addMember` activity tracker. References:
  docs/DAO_TREASURY.md, src/handlers/DAORegistry.ts, src/handlers/DAO.ts,
  src/handlers/ERC20.ts.
---

# Aragon DAO

## 1. Registration — `DAORegistry.DAORegistered(dao, creator, subdomain)`

**Two phases per event** (`src/handlers/DAORegistry.ts`):

- `contractRegister`: `context.addDAO(event.params.dao)` — Envio starts routing DAO events from this address forward.
- `handler`: validates subdomain via `validateString` (trim-check), runs three effects in parallel via `Promise.all`:
  - `fetchImplementationAddress` — viem `getStorageAt` on EIP-1967 slot (`src/effects/dao.ts`)
  - `fetchDaoVersion` — `protocolVersion()` returns `"major.minor.patch"`, defaults `"1.0.0"`
  - `resolveDaoEns` — deterministic `<subdomain>.dao.eth`. Aragon's `dao.eth` manager isn't on the public ENS registry so we don't validate ownership (legacy effective behaviour)

  **Plus** reads existing Dao (might be a stub from MetadataSet — see §2). Writes Dao with registration fields filled fresh and metadata fields preserved from the stub if present. Then calls `addMember(creator)`.

**Member service** (`src/services/member.ts`): global `Member` keyed by checksummed address (no chainId — same wallet across chains is one Member). On first sight resolves mainnet ENS via `fetchEnsForAddress` effect, sets first/last activity blocks. `addMember` skips `ZERO_ADDRESS` internally. Called from any handler that sees an address acting in a DAO context (see §6).

## 2. Metadata — `DAO.MetadataSet(metadata)` & the stub-then-merge pattern

In `src/handlers/DAO.ts`. Extract IPFS CID, fetch JSON via gateway race (Pinata → ipfs.io → dweb.link → cloudflare via `src/effects/ipfs.ts`), spread `name/description/avatar/links` into the `Dao` row.

**Critical: same-tx ordering with DAORegistered.** During `DAOFactory.createDao()`, the DAO emits `MetadataSet` BEFORE the factory calls `DAORegistry.register()` (lower logIndex). Envio dispatches in `(block, logIndex)` order, so this handler runs first — the `Dao` row doesn't exist yet. **97% of DAOs hit this path** in our production data.

**Solution — stub-then-merge:**

- MetadataSet handler: if `Dao.get(id)` returns nothing → write a **stub** Dao with metadata fields populated and registration fields as placeholders (`creatorAddress: ZERO_ADDRESS`, `version: undefined`, etc.). Logged as `"Dao stub created from MetadataSet"`.
- DAORegistered handler: reads existing Dao first; preserves metadata fields, fills registration fields fresh.
- Logged with `hadMetadataStub: true|false` so we can audit.

**Same pattern applies elsewhere if more events fire before DAORegistered in the factory tx.** Don't add `if (!dao) return; logger.warn(...)` for any event that fires from the DAO contract itself — those will hit the same race.

Legacy also stores: `processKey`, `stageNames`, `blockedCountries`, `termsConditionsUrl`, `enableOfacCheck` — currently NOT in our schema. Migration gap.

## 3. Permissions — `DAO.Granted` / `DAO.Revoked` (no Dao guard)

Each event writes a `DaoPermission` row (audit trail) tagged with `PermissionEvent.Granted` / `PermissionEvent.Revoked` enum from `src/enums.ts`. On `Granted` with non-zero `condition`, also runs `context.addExecuteSelectorCondition(condition)` so the condition contract's events get indexed.

**No `Dao.get` guard** — same factory-tx ordering race: DAO emits initial permission events before being registered. Just write the row; the parent Dao will exist by end-of-block. Independent log records (DaoPermission, Transaction) are written unconditionally.

Legacy ALSO does: bidirectional DAO linking via acknowledgement permissions, admin member creation, plugin reinstall/uninstall via permission changes. NOT yet ported.

## 4. Upgrade detection — `DAO.Upgraded(implementation)`

OZ proxy upgrade event. Fires whenever a DAO's implementation contract changes (typically via governance `upgradeToAndCall`). Handler in `src/handlers/DAO.ts`:

- Reads existing Dao (silent return if missing — Upgraded only fires after registration)
- Skips no-op upgrades (`newImpl === dao.implementationAddress`)
- Calls `fetchDaoVersion` effect on the proxy to get the new `protocolVersion()`
- Updates Dao with new `implementationAddress` + `version`

Legacy detected upgrades by parsing `Upgraded` logs from tx receipts (called from `proposalHandler`/`pluginHandler` after relevant events). Direct event subscription is cleaner.

## 5. Native treasury — `DAO.NativeTokenDeposited` + `DAO.Executed.actions[]`

| Direction | Event | Notes |
|---|---|---|
| Deposit | `NativeTokenDeposited(sender, amount)` | OSx v1 + v2 emit identical signature, single subscription |
| Withdraw | `Executed.actions[].value > 0` | OSx v1 (`Executed`) and v2 (`ExecutedV2`) have different signatures, two subscriptions in `config.yaml` (V2 aliased) |

Both withdraws funnel into `recordNativeWithdraws` helper — iterates `actions`, skips `value === 0n`, writes a withdraw `Transaction` per non-zero action with `actionIndex` set.

**Skip on `NATIVE_AS_ERC20_CHAINS`** (`src/constants.ts` — zkSync 324, Peaq 3338). On those chains native is wrapped as ERC-20, so the wildcard ERC-20 handler already catches the transfers. Both native handlers short-circuit at the top.

## 6. ERC-20 treasury — wildcard `ERC20.Transfer`

`src/handlers/ERC20.ts`:

```ts
ERC20.Transfer.handler(async ({ event, context }) => {
  const [fromDao, toDao] = await Promise.all([
    context.Dao.get(daoId(chainId, from)),
    context.Dao.get(daoId(chainId, to)),
  ]);
  if (!fromDao && !toDao) return;
  // record + updateDaoAssets per perspective
  await addToken(context, { chainId, tokenAddress, ... });
}, { wildcard: true });
```

Per Envio's pattern for "indexing across thousands of contracts" (https://docs.envio.dev/docs/HyperIndex/wildcard-indexing). Subscribes to every `Transfer` on every contract on the chain. Filter at handler time via `context.Dao.get` (in-memory cached). 99.99% of events return early.

DAO_A → DAO_B yields two rows (one per perspective) — `transactionId` includes `daoAddress` so no collision.

**Token discovery**: every transfer involving a DAO also calls `addToken` to populate the `Token` entity (name/symbol/decimals/type/governance/spam/wrapper/proxy/etc.). See `aragon-token` skill for the full Token model + detection pipeline.

## 7. `addMember` call sites (cross-handler)

`addMember(context, { address, blockNumber })` is called wherever an address acts in a DAO context — fixes `Member.lastActivityBlock` so we know who's actually active. Skips `ZERO_ADDRESS` internally.

| Handler | Event | Address(es) added |
|---|---|---|
| `DAORegistry` | `DAORegistered` | creator |
| `Multisig` | `MembersAdded` | each new member (per-loop) |
| `Multisig` | `MultisigProposalCreated` / `Approved` | creator / approver |
| `TokenVoting` | `TokenVotingProposalCreated` / `VoteCast` | creator / voter |
| `LockToVote` | `LockToVoteProposalCreated` / `LockToVoteVoteCast` | creator / voter |
| `StagedProposalProcessor` | `SPPProposalCreated` | creator |
| `VotingEscrow` | `Deposit` / `Withdraw` | depositor / lock.memberAddress |
| `VotingEscrow` | `TokensDelegated` / `TokensUndelegated` | sender + delegatee |
| `GovernanceERC20` | `DelegateChanged` | delegator + fromDelegate + toDelegate |
| `GovernanceERC20` | `DelegateVotesChanged` | delegate |
| `LockManager` | `BalanceLocked` / `BalanceUnlocked` | voter |
| `ExitQueue` | `ExitQueued` / `ExitQueuedV2` / `ExitCancelled` | holder |
| `GaugeVoter` | `GaugeCreated` / `Voted` / `Reset` | creator / voter / voter |

Mirrors legacy `MemberGovernanceFactory.createBaseMember` call sites — full coverage.

## 8. Services + ID factories

- `recordTransaction(context, input)` (`src/services/transaction.ts`) — single Transaction.set + log
- `updateDaoAssets(context, input)` (`src/services/asset.ts`) — find-or-create + delta-apply running balance
- `addMember(context, input)` (`src/services/member.ts`) — find-or-create global Member with first/last activity tracking, ZERO_ADDRESS-skip
- `addToken(context, input)` (`src/services/token.ts`) — find-or-create Token row from `(chainId, tokenAddress)`. On first sight fetches `name/symbol/decimals` via cached `fetchTokenMetadata` effect. Skips ZERO_ADDRESS (native). Called from `ERC20.Transfer` handler (every transfer involving a DAO discovers the token) and from `PluginSetupProcessor.InstallationPrepared` (token-voting / lock-to-vote plugins reference a token in helpers[]).
- `transactionId(chainId, daoAddress, txHash, logIndex, actionIndex?)` (`src/ids/index.ts`)
- `assetId(chainId, daoAddress, tokenAddress)` — native uses `ZERO_ADDRESS`
- `memberId(address)` — global, no chainId
- `tokenId(chainId, tokenAddress)` — per-chain

## 9. Asset balance derivation

Running balance from event history alone — no on-chain reconciliation. Matches `balanceOf` exactly for plain ERC-20s and native. Edge cases that drift: rebase tokens, ERC-4626 wrappers, ERC-777 hooks, selfdestruct sends, coinbase rewards, pre-deployment balances. Future enrichment service will reconcile.

## Conventions

- Every entity create / update / delete logs at `debug` (info reserved for lifecycle events).
- Every address from `event.params.*` and `event.srcAddress` wraps with viem `getAddress()`. Never `.toLowerCase()`.
- **Independent log records (DaoPermission, Transaction)** → write unconditionally, no `Dao.get` guard. Same-tx factory-creation ordering means the parent Dao may not exist yet at the time the handler runs.
- **Updates that depend on existing Dao state (MetadataSet → spread into Dao)** → use stub-then-merge.
- Closed string spaces (status, side, event type) → typed enum from `src/enums.ts`, never raw string literals.

## Schema

```graphql
type Dao {
  id: ID!  # ${chainId}-${daoAddress}
  chainId: Int!
  address: String!
  creatorAddress: String!     # ZERO_ADDRESS in stub, real after DAORegistered
  subdomain: String
  implementationAddress: String   # set via fetchImplementationAddress
  ens: String                     # set via resolveDaoEns
  version: String                 # set via fetchDaoVersion
  metadataUri / name / description / avatar / links   # set via MetadataSet (stub or merge)
  proposalCount, proposalsExecuted, uniqueVoters, voteCount, memberCount   # zeroed at create, bumped by other handlers
}

type Transaction {
  id: ID!  # ${chainId}-${daoAddress}-${txHash}-${logIndex}[-action${N}]
  ... side, type, fromAddress, toAddress, tokenAddress, value, actionIndex
}

type Asset {
  id: ID!  # ${chainId}-${daoAddress}-${tokenAddress}
  ... amount (BigInt running balance), blockNumber, blockTimestamp
}

type Member {
  id: ID!  # ${address}  (global, no chainId)
  ... ens, avatar, firstActivityBlock, lastActivityBlock
}

type DaoPermission {
  id: ID!  # ${chainId}-${txHash}-${logIndex}
  ... event (Granted | Revoked), permissionId, whoAddress, whereAddress, conditionAddress
}
```

## Related skills

- `aragon-token` — Token entity model + detection pipeline (called via `addToken` from ERC20.Transfer + PluginSetupProcessor)
- `enrichment-service` — planned external worker for prices/logos/holders (not built yet)
- `chain-integrations` — per-chain explorer / RPC / native-token quirks
- `add-new-chain` — checklist when enabling a new chain
- `aragon-plugins` — what runs once a DAO has plugins installed
- `aragon-proposals` — proposals + votes downstream
- `aragon-membership` — member entity variants per plugin type