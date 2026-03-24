---
name: aragon-metrics
description: >-
  Use when working on DAO metrics, plugin metrics, proposal metrics, gauge
  metrics, or any aggregation/counting logic. Covers DAO-level metrics
  (proposalCount, voteCount, uniqueVoters, memberCount, tvlUSD), per-member
  plugin activity (PluginMetrics), proposal voting aggregation, gauge epoch
  metrics, and the legacy re-count-from-source pattern.
---

# Metrics Tracking

## DAO Metrics (Dao entity)

| Metric | Envio Field | Updated By | Legacy Also Has |
|---|---|---|---|
| Total proposals | `proposalCount` | ProposalCreated (all governance handlers) | Same |
| Executed proposals | `proposalsExecuted` | ProposalExecuted | Same |
| Total votes | `voteCount` | VoteCast / Approved | Same |
| Unique voters | `uniqueVoters` | New voter address seen | uniqueVoters = distinct member×plugin pairs |
| Member count | `memberCount` | Multisig MembersAdded/Removed only | **members** = unique across ALL membership types |
| TVL | N/A | N/A | `tvlUSD` = sum of Asset USD values |

**Key gap**: Envio's `memberCount` only counts Multisig members. Legacy aggregates across TokenMember (VP != 0) + Lock (delegateReceiver != null) + LockToVoteMember (VP != 0) + PluginMember.

**Envio pattern** (incremental):
```typescript
context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
```

**Legacy pattern** (re-count from source):
```typescript
proposalsCreated = await Proposal.countDocuments({ daoAddress, isSubProposal: false });
```
Legacy always re-counts to ensure correctness on reindex. Envio uses incremental counters which are correct within a single run but may drift if events are replayed.

## Plugin Metrics (Per Member Per Plugin) — Legacy Only

Not yet in Envio. Envio has `PluginActivityMetric` but simpler.

| Field | Type | Description |
|---|---|---|
| `memberAddress` | string | Member |
| `pluginAddress` | string | Plugin |
| `daoAddress` | string | DAO |
| `voteCount` | number | Votes cast on this plugin |
| `proposalCount` | number | Proposals created on this plugin |
| `firstActivity` | number | Block of first action |
| `lastActivity` | number | Block of most recent action |

**ID**: `${network}-${memberAddress}-${pluginAddress}`

**Updated on**: proposal creation, vote cast, delegation change.
**Always fresh-queried** from Vote/Proposal collections (not incremented).

## Proposal Metrics

Each proposal tracks voting aggregation:

| Field | Description |
|---|---|
| `metrics.totalVotes` | Total votes received |
| `metrics.missingVotes` | Votes still needed (multisig: minApprovals - approvals) |
| `metrics.votesByOption` | Per option: `{ type, totalVotes, totalVotingPower }` |
| `snapshot.totalSupply` | Token supply at creation (TokenVoting) |
| `snapshot.membersCount` | Member count at creation (Multisig) |
| `settings` | Static copy of plugin settings at proposal creation |

**Envio**: Stores `voteCount` on Proposal (incremental). Does not store votesByOption, snapshot, or settings copy.

**Legacy**: Recalculates after every vote by querying all votes for that proposal.

## Gauge Metrics (Epoch-Based) — Legacy Only

Per gauge per epoch:

| Field | Description |
|---|---|
| `gaugeAddress` | Gauge |
| `epochId` | Epoch identifier |
| `totalMemberVoteCount` | Unique voters this epoch on this gauge |
| `currentEpochVotingPower` | Total VP on this gauge this epoch |
| `totalGaugeVotingPower` | Total VP across all gauges this epoch |

**GaugeVote aggregations**:
- Active voters per gauge per epoch (latest vote per member, excluding resets)
- VP per gauge (sum non-zero latest votes)
- Active voter list with latest tx info

**Envio**: Stores `GaugeVote` entities with epoch/voter/gauge/VP but no aggregated `GaugeMetrics` entity.

## Vote Entity Differences

| Field | Envio | Legacy |
|---|---|---|
| `voteOption` | number | number |
| `votingPower` | string | string |
| `voteCleared` | N/A (entity deleted on LockToVote VoteCleared) | Object `{ status, txHash, blockNumber }` — preserves history |
| `replacedTransactionHash` | N/A | Tracks if vote was replaced |

**Key difference**: Envio deletes Vote entity on VoteCleared. Legacy marks `voteCleared.status = true` and excludes from queries — preserves audit trail.

## What's Missing in Envio

- [ ] Base Member entity (cross-DAO identity with ENS/avatar)
- [ ] PluginMetrics (per member per plugin activity tracking)
- [ ] DAO memberCount aggregation across all membership types (not just multisig)
- [ ] tvlUSD metric (requires treasury/asset tracking + price feeds)
- [ ] Proposal snapshot data (totalSupply, membersCount at creation)
- [ ] Proposal settings copy (frozen at creation time)
- [ ] Proposal votesByOption aggregation
- [ ] GaugeMetrics aggregation entity
- [ ] Vote replacement tracking (replacedTransactionHash)
- [ ] Vote cleared audit trail (currently deletes entity)
