# Aragon Legacy Indexer → HyperIndex Migration Status

## Overview

Migration from the legacy multi-service monolith (RabbitMQ + MongoDB + custom block crawler, 8+ microservices) to Envio HyperIndex (single indexer, PostgreSQL, GraphQL API, HyperSync).

**Status: ~95% complete — all on-chain events that exist are indexed.**

The 18 "missing" events from the legacy config have **zero occurrences across all 6 chains** (verified via HyperSync topic search). These features (VE Split/Merge, Capital Router policy settings, factory deployments, StagesUpdated, PayoutClaimed) haven't been used on-chain yet. Handlers and config can be added when they start appearing.

---

## Event Coverage: 55/73 legacy events indexed

### All 55 events with on-chain activity are indexed

| Phase | Contract | Events | Status |
|-------|----------|--------|--------|
| 1 | DAORegistry | DAORegistered | Done |
| 1 | PluginRepoRegistry | PluginRepoRegistered | Done |
| 1 | PluginSetupProcessor | InstallationPrepared, InstallationApplied, UpdatePrepared, UpdateApplied, UninstallationPrepared, UninstallationApplied | Done |
| 1 | DAO | MetadataSet, NativeTokenDeposited, Granted, Revoked, Executed | Done |
| 2 | Multisig | MultisigSettingsUpdated, MembersAdded, MembersRemoved, ProposalCreated, ProposalExecuted, Approved | Done |
| 2 | TokenVoting | VotingSettingsUpdated, ProposalCreated, ProposalExecuted, VoteCast | Done |
| 2 | StagedProposalProcessor | ProposalResultReported, ProposalCanceled, ProposalEdited, ProposalAdvanced, ProposalCreated, ProposalExecuted, MetadataSet | Done |
| 2 | GovernanceERC20 | DelegateChanged, DelegateVotesChanged | Done |
| 3 | VotingEscrow | Deposit, Withdraw, MinDepositSet, TokensDelegated, TokensUndelegated | Done |
| 3 | ExitQueue | ExitQueued, ExitQueuedV2, ExitCancelled, MinLockSet, ExitFeePercentAdjusted | Done |
| 3 | LockManager | BalanceLocked, BalanceUnlocked | Done |
| 3 | LockToVote | VoteCast, VoteCleared, ProposalCreated, ProposalExecuted, VotingSettingsUpdated | Done |
| 4 | GaugeVoter | GaugeCreated, GaugeActivated, GaugeDeactivated, GaugeMetadataUpdated, Voted, Reset | Done |
| 4 | CapitalDistributor | CampaignCreated, CampaignPaused, CampaignResumed, CampaignEnded, MerkleCampaignSet, MerkleCampaignUpdated | Done |
| 4 | ExecuteSelectorCondition | SelectorAllowed, SelectorDisallowed, NativeTransfersAllowed, NativeTransfersDisallowed | Done |

### 18 legacy events with zero on-chain occurrences (verified via HyperSync)

These events are defined in the legacy `configIndexer.ts` but have **never been emitted** on any of the 6 indexed chains. They can be added to config.yaml when they start appearing on-chain.

| Event | Category | Notes |
|-------|----------|-------|
| `Split` | VE Governance | VE token split — feature not used yet |
| `Merged` | VE Governance | VE token merge — feature not used yet |
| `StagesUpdated` | SPP | Complex tuple signature — no on-chain occurrences |
| `PayoutClaimed` | Capital Distributor | Individual claim tracking — no claims yet |
| `SourceSettingsUpdated` | Capital Router Policy | Policy contract settings — not deployed |
| `PluginDefined` | Capital Router Policy | |
| `ModelSettingsUpdated` | Capital Router Policy | |
| `RouterSettingsUpdated` | Capital Router Policy | |
| `ClaimerSettingsUpdated` | Capital Router Policy | |
| `DrainBalanceSourceDeployed` | Factory | Factory not deployed on any chain |
| `RequiredBalanceSourceDeployed` | Factory | |
| `StreamBalanceSourceDeployed` | Factory | |
| `FixedBalanceSourceDeployed` | Factory | |
| `RatioModelDeployed` | Factory | |
| `EqualRatioModelDeployed` | Factory | |
| `BracketsModelDeployed` | Factory | |
| `AddressGaugeRatioModelDeployed` | Factory | |
| `TokenGaugeRatioModelDeployed` | Factory | |

---

## Entity Coverage

### Migrated (22 entities)

| HyperIndex Entity | Legacy Model | Notes |
|---|---|---|
| Dao | dao | IPFS metadata + inline metrics (proposalCount, proposalsExecuted, voteCount, uniqueVoters, memberCount) |
| Plugin | plugin | interfaceType via repo mapping + bytecode fallback |
| PluginRepo | pluginRepo | |
| Proposal | proposal | IPFS metadata (title, summary, description, resources) |
| Vote | vote | votingPower for TokenVoting/LockToVote |
| DaoPermission | daoPermission | Granted/Revoked with permissionId, who, where, condition |
| PluginSetting | setting | Multisig, TokenVoting, LockToVote, SPP settings |
| PluginMember | pluginMember | MembersAdded/Removed for Multisig |
| PluginActivityMetric | pluginMetrics | Per-member per-plugin: voteCount, proposalCount, firstActivityBlock, lastActivityBlock |
| Token | token | RPC metadata: name, symbol, decimals (97% coverage) |
| TokenMember | tokenMember | Current voting power per delegate |
| Lock | lock | VE deposits with withdraw/exit queue tracking |
| TokenDelegation | tokenDelegation | VE token delegation |
| LockToVoteMember | lockToVoteMember | Locked balances per voter |
| Gauge | gauge | Status and IPFS metadata URI |
| GaugeVote | voteGauge | Per-gauge per-epoch voting power |
| Campaign | campaign | Merkle root, pause/end state |
| SelectorPermission | selectorPermission | Function selector allow/disallow |
| NativeTransferPermission | (part of selectorPermission) | Native transfer allow/disallow |
| PluginSetupLog | logPluginSetupProcessor | Full install/update/uninstall lifecycle |
| DelegateChangedEvent | logDelegateChanged | Delegation change log |
| DelegateVotesChangedEvent | logDelegateChanged | Voting power change log + TokenMember current state |

### Not Migrated (by design)

| Legacy Model | Reason |
|---|---|
| **asset** | DAO treasury balances — requires periodic balance checks + pricing API. Should be a separate service or periodic job. |
| **transaction** | DAO transaction history — partially covered by `Executed` event. Full tx decoding is a separate concern. |
| **metrics (TVL)** | TVL requires token pricing from external APIs (CoinGecko, etc.). Not suitable for inline handler computation. Should be a materialized view or separate service. |
| **gaugeMetrics** | Epoch-level gauge aggregates — can be computed from GaugeVote data via GraphQL aggregation queries. |
| **member** | Global cross-chain member entity with ENS/avatar. ENS resolution is Ethereum-only and expensive. Could be added as an effect if needed. |
| **contract** | Contract metadata (verified source, ABI) — operational concern, not core indexing. |
| **campaignReward / campaignMerkleRoot** | `PayoutClaimed` has zero on-chain occurrences. Will add when claims start happening. |
| **logPolicy** | Policy events have zero on-chain occurrences. Will add when Capital Router is deployed. |
| **pluginSlug** | Human-readable plugin URLs — application-layer concern. |
| configIndexer, migration, jwt, taskRun, taskService, metadataRefetch, logMetadata | Infrastructure/operational — not applicable to HyperIndex. |

---

## Computed Metrics

### Inline (updated in handlers)

| Metric | Entity | Updated by |
|--------|--------|-----------|
| proposalCount | Dao | ProposalCreated (all plugin types) |
| proposalsExecuted | Dao | ProposalExecuted (all plugin types) |
| voteCount | Dao | VoteCast, Approved (all plugin types) |
| memberCount | Dao | MembersAdded, MembersRemoved |
| voteCount (per proposal) | Proposal | VoteCast, Approved, VoteCleared |
| voteCount (per member) | PluginActivityMetric | VoteCast, Approved |
| proposalCount (per member) | PluginActivityMetric | ProposalCreated |

### Not computed (needs external data)

| Metric | Reason |
|--------|--------|
| TVL (tvlUSD) | Requires token pricing API (CoinGecko etc.) — not suitable for indexer |
| uniqueVoters | Field exists but accurate count requires deduplication across proposals. Currently approximated by voteCount. Can be computed via SQL `COUNT(DISTINCT memberAddress)` on Vote table. |

---

## Chain Support

| Chain | ID | Status |
|-------|-----|--------|
| Ethereum Mainnet | 1 | Active |
| Ethereum Sepolia | 11155111 | Active |
| Polygon Mainnet | 137 | Active |
| Arbitrum Mainnet | 42161 | Active |
| Base Mainnet | 8453 | Active |
| zkSync Era | 324 | Active |
| zkSync Sepolia | 300 | **Disabled** — no HyperSync support |

---

## Plugin Detection

Two-tier detection system:

1. **Repo address mapping** (`pluginRepos.ts`) — instant, no RPC. ~200 addresses mapped across all chains including Sepolia dev repos.
2. **Bytecode fallback** (`bytecodeDetector.ts`) — fetches contract bytecode via `eth_getCode` and checks function selector hashes. Same approach as legacy `PluginDetector`. Covers any plugin regardless of repo.

Current classification: ~16,945 classified / ~1,028 unknown (genuinely 3rd party plugins like Vocdoni, dao-reputation, custom plugins).

---

## Known Limitations

1. **Pre-existing ERC20Votes tokens** — For DAOs using a pre-existing governance token (not deployed during DAO creation), delegation events before `InstallationPrepared` block are missed. HyperIndex only indexes dynamic contracts from registration block forward. Affects a small minority of DAOs — most deploy fresh tokens.

2. **DAO metadata coverage at ~5%** — Many DAOs don't set IPFS metadata. This matches the legacy system. Not a bug.

3. **No REST API** — HyperIndex provides GraphQL only. Legacy had a custom REST API. A thin wrapper over GraphQL can be added if needed.

4. **TVL not computed** — Requires token pricing from external APIs. Should be a separate service or materialized view.

5. **uniqueVoters is approximate** — Accurate unique voter count requires `COUNT(DISTINCT)` on the Vote table. Can be done via SQL view or computed at query time.

6. **One dynamic contract type per address** — HyperIndex limitation. Only the last `context.add*()` call per address is kept. Mitigated by correct plugin type detection before registration.

---

## Data Quality (latest full sync)

| Metric | Value |
|--------|-------|
| DAOs | 13,323 |
| Plugins | 17,973 (94% classified) |
| Proposals | ~16,500 |
| Votes | ~19,100 |
| DelegateVotesChanged events | ~984,500 |
| Token members | ~71,900 |
| Tokens | 6,565 (97% with name/symbol/decimals) |
| Permissions | 229,194 |
| Gauges | 73 |
| Gauge votes | 144 |
| Campaigns | 17 |
| VE Locks | 164 |
| LockToVote members | 53 |
| Selector permissions | 18 |

---

## Architecture

```
aragon-indexer/
  config.yaml                    # 18 contracts, ~55 events, 6 chains
  schema.graphql                 # 22 entity types, 5 enums
  src/
    handlers/                    # 15 handler files
      DAORegistry.ts             # + contractRegister (DAO)
      PluginSetupProcessor.ts    # + contractRegister (all plugin types + VE + LockManager)
                                 # + bytecode fallback for unknown repos
                                 # + token metadata RPC effect
      DAO.ts                     # + contractRegister (ExecuteSelectorCondition)
      PluginRepoRegistry.ts
      Multisig.ts                # + DAO metrics + plugin activity tracking
      TokenVoting.ts             # + DAO metrics + plugin activity tracking
      StagedProposalProcessor.ts # + DAO metrics + plugin activity tracking
      GovernanceERC20.ts
      VotingEscrow.ts
      ExitQueue.ts
      LockManager.ts
      LockToVote.ts              # + DAO metrics + plugin activity tracking
      GaugeVoter.ts
      CapitalDistributor.ts
      ExecuteSelectorCondition.ts
    effects/
      ipfs.ts                    # IPFS metadata with dedicated gateway support
      rpc.ts                     # Token metadata, VE discovery, lock manager discovery
    utils/
      metadata.ts                # IPFS CID extraction from hex bytes
      pluginRepos.ts             # ~200 repo → type mappings
      bytecodeDetector.ts        # Fallback bytecode-based plugin detection
      veDiscovery.ts             # VE contract discovery via RPC
      metrics.ts                 # DAO + plugin activity metric helpers
```

### Dynamic Contract Registration Flow

```
DAORegistered → register DAO address
InstallationPrepared → detect plugin type (repo mapping → bytecode fallback)
  → multisig: register Multisig
  → tokenVoting: register TokenVoting + GovernanceERC20 (from helpers)
                  + VotingEscrow + ExitQueue (via RPC discovery)
  → spp: register StagedProposalProcessor
  → lockToVote: register LockToVote + LockManager (via RPC)
                 + GovernanceERC20 + VotingEscrow + ExitQueue
  → gauge: register GaugeVoter
  → capitalDistributor: register CapitalDistributor
  → unknown: bytecode detection → register correct type
Granted (with condition) → register ExecuteSelectorCondition
```
