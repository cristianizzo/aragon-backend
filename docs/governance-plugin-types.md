# Governance Plugin Types — Summary

## 1. Admin

The simplest governance. No proposals, no voting, no settings. A single address (or set of addresses) has `EXECUTE_PROPOSAL_PERMISSION` on the DAO and can execute actions directly. Members are just the addresses that hold that permission. Tracked via `PluginMember`.

## 2. Multisig

Approval-based governance. A fixed list of members (addresses) is stored on-chain. To execute actions, a proposal is created and N-of-M members must approve. Settings: `onlyListed` (only members can create proposals) and `minApprovals` (threshold). Members tracked via `PluginMember`, added/removed via `MembersAdded`/`MembersRemoved` events. Each approval is stored as a Vote with voteOption=2 (approve). No voting power — every member has equal weight.

## 3. TokenVoting (ERC20 Governance)

Token-weighted voting. Membership is defined by holding a governance ERC20 token AND self-delegating (or receiving delegation). Voting power = delegated token balance, not raw balance. A `TokenMember` entity tracks each delegate's voting power and delegation count. Settings: `votingMode`, `supportThreshold`, `minParticipation`, `minDuration`, `minProposerVotingPower`. Proposals have a snapshot of `totalSupply` at creation. Votes carry `votingPower`. Results checked against threshold/participation ratios from settings.

## 4. VE Governance (Vote Escrow — used by Katana)

NFT lock-based voting. Users lock an underlying ERC20 token into the VotingEscrow contract and receive a lock NFT (ERC721). Voting power is derived from: locked amount × remaining lock time, calculated via curve parameters (slope, bias). The longer and larger the lock, the more voting power.

Contract chain: `token.escrow()` → VotingEscrow → `escrow.queue()` → ExitQueue, `escrow.curve()` → Curve, `escrow.lockNFT()` → NFT contract.

Members tracked via `Lock` entities (one per NFT tokenId). Supports: deposit, withdraw, exit queue, exit cancel, split (one lock → two), merge (two → one), delegation (delegate voting power to another address).

VE settings stored on PluginSetting: `minDeposit`, `minLockTime`, `maxTime`, `cooldown`, `slope`, `bias`, fee parameters.

## 5. LockToVote

Simpler lock-based voting (no NFTs). Users lock tokens into a LockManager contract to get voting power. Voting power = locked amount (no time decay like VE). Members tracked via `LockToVoteMember` with cumulative locked balance. The LockManager is discovered via RPC: `plugin.lockManager()`.

Special behavior: votes can be **cleared** (`VoteCleared` event) if a voter unlocks during an active proposal. Settings same structure as TokenVoting plus `approvalThreshold`.

## 6. Gauge Voting

Fundamentally different — **no proposals**. Operates on an infinite timeline of epochs. Each epoch has a voting period where users allocate voting power across gauges (resource allocation targets).

A Gauge is created with metadata (name, description) and can be activated/deactivated. Users vote on gauges with their voting power (typically from VE locks or ERC20 tokens). Votes are epoch-scoped. No approval thresholds, no pass/fail — it's proportional allocation.

Tracked via `Gauge` entities (the targets) and `GaugeVote` entities (per voter per gauge per epoch). Reset events allow voters to remove their vote within an epoch.

## 7. SPP (Staged Proposal Processor)

A container/orchestrator — not a voting plugin itself. Wraps multiple governance plugins into a multi-stage pipeline. Example: Stage 1 has 2 sub-plugins (both must approve), Stage 2 has 1 sub-plugin. A proposal advances through stages sequentially. Each stage's sub-plugins vote independently.

Settings define: stages array with `minAdvance`, `maxAdvance`, `voteDuration`, `approvalThreshold`, `vetoThreshold` per stage, plus the sub-plugin addresses per stage.

Events: `ProposalAdvanced` (stage passed), `ProposalCanceled` (stage rejected), `ProposalResultReported` (sub-plugin reports result), `ProposalEdited` (metadata changed mid-process).

Sub-plugins are linked to the SPP via `parentPlugin`/`stageIndex`/`isSubPlugin` fields.

## 8. Capital Distributor

Campaign-based reward distribution. No proposals, no voting. An admin creates campaigns with: token, allocation strategy, start/end time. A merkle tree is computed off-chain with per-address reward amounts, and the merkle root is published on-chain (`MerkleCampaignSet`/`MerkleCampaignUpdated`). Users claim rewards by providing merkle proofs.

Campaigns can be paused/resumed/ended. Tracked via `Campaign` entities. Members are campaign reward recipients tracked via `CampaignReward`.

## 9. Router/Claimer (Policy-Based)

Automated fund distribution — no proposals, no voting. Policies define how funds flow from a source (vault) through a distribution model to recipients.

**Source types**: StreamBalance (continuous drip at amountPerEpoch) or Drain (empty entire vault).

**Model types**: Ratio (custom weights), EqualRatio (equal split), Tiered (threshold-based), Gauge (based on gauge voting results).

**Swap**: Optional token swap step (via CowSwap/Uniswap).

Can be composed: MultiRouter/MultiClaimer nest multiple sub-policies. Settings stored as policy JSON on PluginSetting.

---

## Membership Model Per Governance Type

| Governance | Member Entity | How Membership Is Defined | Voting Power |
|---|---|---|---|
| **Admin** | `PluginMember` | Has `EXECUTE_PROPOSAL_PERMISSION` | N/A (no voting) |
| **Multisig** | `PluginMember` | On-chain member list (`MembersAdded`/`MembersRemoved`) | Equal (1 member = 1 approval) |
| **TokenVoting** | `TokenMember` | Holds governance ERC20 + self-delegates or receives delegation | Delegated token balance |
| **VE Governance** | `Lock` | Locks ERC20 into VotingEscrow, receives lock NFT | f(locked amount, time remaining, slope, bias) |
| **LockToVote** | `LockToVoteMember` | Locks tokens into LockManager | Locked amount (no time decay) |
| **Gauge** | None | Any address with voting power (from VE/ERC20) | From underlying governance token |
| **SPP** | Derived from sub-plugins | Depends on wrapped plugins | Depends on wrapped plugins |
| **Capital Distributor** | `CampaignReward` | Off-chain merkle tree computation | N/A (no voting) |
| **Router/Claimer** | None | Recipients defined in policy model | N/A (no voting) |

## Proposal Support Per Governance Type

| Governance | Has Proposals | Voting Mechanism | Pass Condition |
|---|---|---|---|
| **Admin** | No | N/A | Direct execution |
| **Multisig** | Yes | N-of-M approval | `minApprovals` reached |
| **TokenVoting** | Yes | Token-weighted vote (Yes/No/Abstain) | `supportThreshold` + `minParticipation` met |
| **VE Governance** | Yes | Lock-weighted vote | Same as TokenVoting (with time-decayed power) |
| **LockToVote** | Yes | Lock-weighted vote + clearable | `supportThreshold` + `minParticipation` + `approvalThreshold` |
| **Gauge** | No | Epoch-based gauge allocation | N/A (proportional, no pass/fail) |
| **SPP** | Yes (multi-stage) | Delegates to sub-plugins per stage | All stages pass sequentially |
| **Capital Distributor** | No | N/A | Merkle root published by admin |
| **Router/Claimer** | No | N/A | Automatic policy execution |

## Settings Per Governance Type

| Governance | Settings Event | Key Fields |
|---|---|---|
| **Admin** | None | No settings |
| **Multisig** | `MultisigSettingsUpdated` | `onlyListed`, `minApprovals` |
| **TokenVoting** | `VotingSettingsUpdated` | `votingMode`, `supportThreshold`, `minParticipation`, `minDuration`, `minProposerVotingPower` |
| **VE Governance** | `VotingSettingsUpdated` + VE params | Same as TokenVoting + `minDeposit`, `minLockTime`, `maxTime`, `cooldown`, `slope`, `bias`, fee params |
| **LockToVote** | `VotingSettingsUpdated` | Same as TokenVoting + `approvalThreshold` |
| **Gauge** | Manual creation | `enabledUpdatedVotingPowerHook`, VE escrow address |
| **SPP** | `StagesUpdated` | `stages[]`: `minAdvance`, `maxAdvance`, `voteDuration`, `approvalThreshold`, `vetoThreshold`, sub-plugins per stage |
| **Capital Distributor** | None | Campaign-level config (not plugin settings) |
| **Router/Claimer** | `SourceSettingsUpdated`, `ModelSettingsUpdated` | `strategyType`, `source` (vault, token, amounts), `model` (recipients, ratios), `swap` config |

---

## User & Plugin Metrics

### Base Member Entity

Every address that interacts with any DAO is tracked as a `Member` — a cross-DAO identity record:

| Field | Type | Description |
|---|---|---|
| `address` | string | Ethereum address (also the entity ID) |
| `ens` | string | Resolved ENS name |
| `avatar` | string | Avatar URL |
| `firstActivity` | number | Block number of first action across all DAOs |
| `lastActivity` | number | Block number of most recent action across all DAOs |

A base Member is created on first encounter in any flow: DAO creation (creator), proposal creation, vote, delegation, lock deposit, etc.

### Plugin Metrics (Per Member Per Plugin)

Every member's activity on each plugin is tracked individually via `PluginMetrics`:

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Member address |
| `pluginAddress` | string | Plugin address |
| `daoAddress` | string | DAO address |
| `network` | string | Chain identifier |
| `voteCount` | number | Total votes cast by this member on this plugin |
| `proposalCount` | number | Total proposals created by this member on this plugin |
| `firstActivity` | number | Block number of first action on this plugin |
| `lastActivity` | number | Block number of most recent action on this plugin |

**ID pattern**: `${network}-${memberAddress}-${pluginAddress}`

**Updated when:**
- Member creates a proposal → `proposalCount` incremented, `lastActivity` updated
- Member casts a vote → `voteCount` incremented, `lastActivity` updated
- Member's voting power changes (DelegateVotesChanged) → `lastActivity` updated

**Important**: Legacy backend always re-counts from source (Vote/Proposal collections) rather than incrementing — ensures correctness even if events are replayed.

### DAO Metrics (Aggregate)

Each DAO carries aggregate metrics computed from all its plugins:

| Metric | How Computed |
|---|---|
| `tvlUSD` | Sum of all Asset USD values (native + ERC20 balances × price) |
| `proposalsCreated` | Count of all non-sub-proposals across all plugins |
| `proposalsExecuted` | Count of proposals where `executed.status = true` |
| `members` | Unique addresses across all membership types (see below) |
| `votes` | Total vote count across all proposals |
| `uniqueVoters` | Distinct `memberAddress × pluginAddress` pairs that have voted |

**Unique Members calculation** — aggregates from all installed plugins with `isSupported = true`:
- **TokenVoting plugins**: `TokenMember` where `votingPower != '0'` + `Lock` where `delegateReceiverAddress != null` (VE members voting through this token)
- **LockToVote plugins**: `LockToVoteMember` where `votingPower != '0'`
- **Multisig/Admin plugins**: All `PluginMember` records (no voting power filter)
- Results combined into a Set for uniqueness across plugins

### Proposal Metrics

Each proposal tracks its own voting metrics:

| Field | Type | Description |
|---|---|---|
| `metrics.totalVotes` | number | Total votes received |
| `metrics.missingVotes` | number | Votes still needed (for multisig: `minApprovals - approvals`) |
| `metrics.votesByOption` | array | Per vote option: `{ type, totalVotes, totalVotingPower }` |
| `snapshot.totalSupply` | string | Token total supply at proposal creation (TokenVoting) |
| `snapshot.membersCount` | number | Member count at proposal creation (Multisig) |
| `settings` | object | Static copy of plugin settings at proposal creation time |

**Proposal metrics are recalculated** after every vote by querying all votes for that proposal and re-aggregating.

---

## Vote Tracking Per Governance Type

### Common Vote Entity

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Voter address |
| `pluginAddress` | string | Plugin where vote was cast |
| `daoAddress` | string | DAO address |
| `proposalIndex` | string | Which proposal |
| `voteOption` | number | Vote choice (0=None, 1=Abstain, 2=Yes, 3=No) |
| `votingPower` | string | Power used (BigInt as string) |
| `replacedTransactionHash` | string | If vote was replaced by a new vote |
| `voteCleared` | object | `{ status, transactionHash, blockNumber }` — if vote was withdrawn |

### Per-Type Differences

| Governance | Vote Entity | `voteOption` Values | `votingPower` | Special Behavior |
|---|---|---|---|---|
| **Multisig** | `Vote` | 2 (approve only) | `null` (equal weight) | No power tracking |
| **TokenVoting** | `Vote` | 1=Abstain, 2=Yes, 3=No | Delegated token balance | Snapshot at vote time |
| **VE Governance** | `Vote` | Same as TokenVoting | f(lock amount, time) | Power decays over time |
| **LockToVote** | `Vote` | Same as TokenVoting | Locked amount | Votes can be **cleared** via `VoteCleared` event |
| **Gauge** | `GaugeVote` (separate entity) | N/A (allocation, not yes/no) | VP allocated to gauge | Epoch-scoped; `Reset` removes vote; persistent votes carry to next epoch |

### Vote Cleared (LockToVote specific)

When a LockToVote voter unlocks tokens during an active proposal, a `VoteCleared` event fires:
- Sets `voteCleared.status = true` on the Vote entity
- Queries exclude cleared votes: only count votes where `voteCleared.status = false`
- Proposal metrics are recalculated after clearing

---

## Gauge Metrics (Epoch-Based)

Gauges track per-epoch metrics separately from proposal metrics:

### GaugeMetrics Entity

| Field | Type | Description |
|---|---|---|
| `gaugeAddress` | string | Gauge being tracked |
| `pluginAddress` | string | GaugeVoter plugin |
| `epochId` | string | Epoch identifier |
| `totalMemberVoteCount` | number | Number of unique voters this epoch on this gauge |
| `currentEpochVotingPower` | string | Total VP allocated to this gauge this epoch |
| `totalGaugeVotingPower` | string | Total VP across all gauges this epoch |

**ID pattern**: `${network}-${pluginAddress}-${gaugeAddress}-${epochId}`

### GaugeVote Entity

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Voter |
| `gaugeAddress` | string | Gauge voted on |
| `pluginAddress` | string | GaugeVoter plugin |
| `epochId` | string | Epoch |
| `votingPower` | string | VP allocated |
| `type` | string | `'vote'` or `'reset'` |
| `persistentVote` | boolean | If true, vote carries to subsequent epochs |

**Aggregation queries:**
- **Active voters per gauge per epoch**: Group by member, take latest vote, exclude resets/zero-VP
- **VP per gauge**: Sum all non-zero latest votes per gauge
- **Active voter list**: All members with non-zero VP, with their latest tx info

---

## Member Tracking Per Governance Type — Full Detail

### TokenMember (TokenVoting / VE backing)

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Delegate address |
| `tokenAddress` | string | Governance ERC20 token |
| `votingPower` | string | Current delegated voting power (BigInt string) |
| `delegateReceivedCount` | number | How many addresses delegated to this member |
| `tokenIds` | string[] | NFT token IDs (for VE-backed tokens) |
| `lastVPBlockNumber` | number | Block of last voting power update |

**ID**: `${network}-${tokenAddress}-${memberAddress}`

**Updated on**: `DelegateVotesChanged` event — sets `votingPower = newBalance`

**Batch updates**: High-performance path groups multiple `DelegateVotesChanged` events by member, deduplicates by latest block, and batch-upserts to avoid lock contention.

### Lock (VE Governance)

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Original locker |
| `delegateReceiverAddress` | string | Who receives voting power from this lock |
| `tokenAddress` | string | Underlying ERC20 |
| `nftAddress` | string | Lock NFT contract |
| `tokenId` | string | NFT token ID |
| `escrowAddress` | string | VotingEscrow contract |
| `exitQueueAddress` | string | ExitQueue contract |
| `amount` | string | Locked amount |
| `totalLocked` | string | System-wide total locked |
| `epochStartAt` | number | Lock start timestamp |
| `lockExit` | object | `{ status, txHash, blockNumber, exitDateAt }` — exit queue state |
| `lockWithdraw` | object | `{ status, txHash, blockNumber, amount }` — withdrawal state |
| `splitFromTokenId` | string | Parent tokenId if lock was split |

**Voting power formula** (computed at query time, not stored):
```
processedTime = min(currentTime - epochStartAt, maxTime)
votingPower = (amount × slope × processedTime + amount × bias) / 10^18
```

**VE Member aggregation**: Group by `delegateReceiverAddress`, sum computed VP across all active locks (not withdrawn, not in exit queue).

### LockToVoteMember

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Member address |
| `lockManagerAddress` | string | LockManager contract |
| `votingPower` | string | Current cumulative locked balance |
| `lastVPBlockNumber` | number | Block of last update |

**ID**: `${network}-${lockManagerAddress}-${memberAddress}`

**Active members**: Where `votingPower != '0'`

### PluginMember (Multisig / Admin)

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Member address |
| `pluginAddress` | string | Plugin address |
| `daoAddress` | string | DAO address |

**ID**: `${network}-${memberAddress}-${pluginAddress}`

Simplest model — just tracks membership, no voting power or activity metrics on the entity itself (those live in PluginMetrics).
