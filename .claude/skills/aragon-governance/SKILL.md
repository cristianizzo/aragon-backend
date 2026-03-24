---
name: aragon-governance
description: >-
  Use when working on any governance plugin type. Covers all 9 types: Admin,
  Multisig, TokenVoting, VE Governance (Katana), LockToVote, Gauge, SPP
  (Staged Proposal Processor), Capital Distributor, Router/Claimer. Includes
  how each type works, voting mechanisms, pass conditions, settings, and
  contract discovery chains.
---

# Governance Plugin Types

## 1. Admin
Simplest. No proposals, no voting, no settings. Addresses with `EXECUTE_PROPOSAL_PERMISSION` execute actions directly. Members: `PluginMember`.

## 2. Multisig
N-of-M approval. Fixed member list on-chain. Proposals need `minApprovals`. No voting power — equal weight. Members: `PluginMember` via `MembersAdded`/`MembersRemoved`. Settings: `onlyListed`, `minApprovals`.

## 3. TokenVoting (ERC20 Governance)
Token-weighted voting. Membership = holding governance ERC20 + self-delegating or receiving delegation. Voting power = delegated balance (not raw). Members: `TokenMember`. Proposals snapshot `totalSupply`. Settings: `votingMode`, `supportThreshold`, `minParticipation`, `minDuration`, `minProposerVotingPower`.

## 4. VE Governance (Vote Escrow — Katana)
NFT lock-based. Users lock ERC20 into VotingEscrow → receive lock NFT (ERC721). Voting power = `(amount × slope × processedTime + amount × bias) / 10^18`. Decays over time.

**Contract chain**: `token.escrow()` → VotingEscrow → `escrow.queue()` → ExitQueue, `escrow.curve()` → Curve, `escrow.lockNFT()` → NFT.

Members: `Lock` entities (one per NFT tokenId). Operations: deposit, withdraw, exit queue/cancel, split (1→2), merge (2→1), delegation.

VE settings: `minDeposit`, `minLockTime`, `maxTime`, `cooldown`, `slope`, `bias`, fee params.

## 5. LockToVote
Simpler lock-based (no NFTs). Lock tokens into LockManager → voting power = locked amount (no time decay). Members: `LockToVoteMember`. Special: votes can be **cleared** if voter unlocks during active proposal. Settings: TokenVoting + `approvalThreshold`.

## 6. Gauge Voting
**No proposals**. Infinite epoch timeline. Users allocate voting power across gauges (resource targets). Epoch-scoped votes. No pass/fail — proportional allocation. Members: none (any address with VP). Entities: `Gauge` (targets) + `GaugeVote` (per voter/gauge/epoch). Reset removes vote. Persistent votes carry to next epoch.

## 7. SPP (Staged Proposal Processor)
Container/orchestrator wrapping multiple governance plugins into multi-stage pipeline. Stage 1 might have 2 sub-plugins (both must approve), Stage 2 has 1. Proposals advance sequentially. Settings: `stages[]` with `minAdvance`, `maxAdvance`, `voteDuration`, `approvalThreshold`, `vetoThreshold`, sub-plugin addresses. Events: `ProposalAdvanced`, `ProposalCanceled`, `ProposalResultReported`, `ProposalEdited`. Sub-plugins linked via `parentPlugin`/`stageIndex`/`isSubPlugin`.

## 8. Capital Distributor
**No proposals, no voting**. Campaign-based rewards. Admin creates campaign (token, strategy, start/end). Merkle tree computed off-chain → root published on-chain. Users claim with proofs. Entities: `Campaign`, `CampaignReward`. Events: `CampaignCreated`, `MerkleCampaignSet`/`Updated`, `CampaignPaused`/`Resumed`/`Ended`.

## 9. Router/Claimer (Policy-Based)
**No proposals, no voting**. Automated fund distribution via policies. Sources: StreamBalance (drip) or Drain (empty vault). Models: Ratio, EqualRatio, Tiered, Gauge-based. Optional swap step (CowSwap/Uniswap). Composable: MultiRouter/MultiClaimer. Settings as policy JSON.

## Quick Reference Tables

### Voting & Proposals

| Type | Proposals | Voting | Pass Condition |
|---|---|---|---|
| Admin | No | N/A | Direct execution |
| Multisig | Yes | N-of-M approval | `minApprovals` reached |
| TokenVoting | Yes | Token-weighted (Yes/No/Abstain) | `supportThreshold` + `minParticipation` |
| VE | Yes | Lock-weighted (time-decayed) | Same as TokenVoting |
| LockToVote | Yes | Lock-weighted + clearable | `supportThreshold` + `minParticipation` + `approvalThreshold` |
| Gauge | No | Epoch allocation | Proportional (no pass/fail) |
| SPP | Yes (multi-stage) | Sub-plugins per stage | All stages pass |
| CapitalDistributor | No | N/A | Merkle root by admin |
| Router/Claimer | No | N/A | Automatic policy |

### Member Entity Per Type

| Type | Entity | Voting Power Source |
|---|---|---|
| Admin | `PluginMember` | N/A |
| Multisig | `PluginMember` | Equal (1 = 1) |
| TokenVoting | `TokenMember` | Delegated ERC20 balance |
| VE | `Lock` | f(amount, time, slope, bias) |
| LockToVote | `LockToVoteMember` | Locked amount |
| Gauge | None | From underlying token/VE |
| SPP | From sub-plugins | From sub-plugins |
| CapitalDistributor | `CampaignReward` | N/A |
| Router/Claimer | None | N/A |

## Handler Files

| Handler | Governance Types |
|---|---|
| `src/handlers/TokenVoting.ts` | TokenVoting, AddresslistVoting |
| `src/handlers/Multisig.ts` | Multisig |
| `src/handlers/StagedProposalProcessor.ts` | SPP |
| `src/handlers/LockToVote.ts` | LockToVote |
| `src/handlers/GaugeVoter.ts` | Gauge |
| `src/handlers/CapitalDistributor.ts` | CapitalDistributor |
| `src/handlers/GovernanceERC20.ts` | TokenMember delegation tracking |
| `src/handlers/VotingEscrow.ts` | VE locks |
| `src/handlers/ExitQueue.ts` | VE exit queue |
| `src/handlers/LockManager.ts` | LockToVote balances |
| `src/handlers/ExecuteSelectorCondition.ts` | Permission conditions |
