---
name: aragon-membership
description: >-
  Use when working on member entities, voting power, delegation, locks, or
  member queries. Covers all membership models: PluginMember (Multisig/Admin),
  TokenMember (ERC20 delegation + voting power), Lock (VE NFT locks with
  deposit/withdraw/exit/split/merge), LockToVoteMember (lock-based VP),
  base Member (cross-DAO identity), and CampaignReward. Includes voting power
  formulas, delegation tracking, and batch VP updates.
---

# Membership Models

## Base Member (Cross-DAO Identity)

Created on first interaction with any DAO. One per address globally.

| Field | Description |
|---|---|
| `address` | Ethereum address (also the ID) |
| `ens` | Resolved ENS name |
| `avatar` | Avatar URL |
| `firstActivity` | Block of first action (set once) |
| `lastActivity` | Block of most recent action (always updated) |

**Legacy creates base Member on**: DAO creation (creator), proposal creation, vote, delegation, lock deposit. **Envio does not have base Member entity yet.**

## PluginMember (Multisig / Admin)

Simplest membership — just tracks who is a member. No voting power.

| Field | Description |
|---|---|
| `memberAddress` | Member address |
| `pluginAddress` | Plugin owning membership |
| `daoAddress` | DAO address |

**ID**: `${chainId}-${pluginAddress}-${memberAddress}`

**Created by**: `MembersAdded` event (Multisig), `EXECUTE_PROPOSAL_PERMISSION` grant (Admin)
**Deleted by**: `MembersRemoved` event (Multisig), permission revoke (Admin)

Files: `src/handlers/Multisig.ts`

## TokenMember (ERC20 Governance)

Tracks delegated voting power for token holders who self-delegate or receive delegation.

| Field | Description |
|---|---|
| `memberAddress` | Delegate address (who holds VP) |
| `tokenAddress` | Governance ERC20 token |
| `votingPower` | Current delegated VP (BigInt string) |
| `delegateReceivedCount` | How many addresses delegated to this member |
| `tokenIds` | NFT token IDs (for VE-backed tokens) |
| `lastVPBlockNumber` | Block of last VP update |

**ID**: `${chainId}-${tokenAddress}-${memberAddress}` (legacy) or `${chainId}-${tokenAddress}-${memberAddress}` (Envio uses DelegateVotesChangedEvent)

**Updated by**: `DelegateVotesChanged(delegate, previousBalance, newBalance)` — sets `votingPower = newBalance`

**Batch VP updates** (legacy): Groups multiple DelegateVotesChanged events by member, dedupes by latest block, batch-upserts to avoid lock contention.

**A member with votingPower = 0 is NOT counted** in DAO unique members.

Files: `src/handlers/GovernanceERC20.ts`

## Lock (VE Governance — Katana)

One Lock per NFT tokenId. Represents a locked position in VotingEscrow.

| Field | Description |
|---|---|
| `memberAddress` | Original locker |
| `delegateReceiverAddress` | Who receives VP from this lock |
| `tokenAddress` | Underlying ERC20 token |
| `nftAddress` | Lock NFT contract |
| `tokenId` | NFT token ID |
| `escrowAddress` | VotingEscrow contract |
| `exitQueueAddress` | ExitQueue contract |
| `amount` | Locked amount |
| `totalLocked` | System-wide total locked |
| `epochStartAt` | Lock start timestamp |
| `lockExit` | `{ status, txHash, blockNumber, exitDateAt }` |
| `lockWithdraw` | `{ status, txHash, blockNumber, amount }` |
| `splitFromTokenId` | Parent tokenId if split |

**ID**: `${chainId}-${escrowAddress}-${tokenId}`

**Voting power formula** (computed at query time, NOT stored):
```
processedTime = min(currentTime - epochStartAt, maxTime)
votingPower = (amount × slope × processedTime + amount × bias) / 10^18
```

**Lock operations**:
- `Deposit` → create Lock
- `Withdraw` → lockWithdraw.status = true
- `ExitQueued` / `ExitQueuedV2` → lockExit.status = true
- `ExitCancelled` → lockExit cleared
- `Split` (legacy) → create new Lock, update source (splitFromTokenId)
- `Merge` (legacy) → mark source withdrawn, update destination amount
- `TokensDelegated` → set delegateReceiverAddress
- `TokensUndelegated` → clear delegation

**VE member aggregation**: Group by delegateReceiverAddress, sum computed VP across all active locks (not withdrawn, not in exit queue).

Files: `src/handlers/VotingEscrow.ts`, `src/handlers/ExitQueue.ts`

## LockToVoteMember

Simpler lock-based membership (no NFTs, no time decay).

| Field | Description |
|---|---|
| `memberAddress` | Member address |
| `lockManagerAddress` | LockManager contract |
| `votingPower` | Cumulative locked balance |
| `lastVPBlockNumber` | Block of last update |

**ID**: `${chainId}-${lockManagerAddress}-${memberAddress}`

**Updated by**: `BalanceLocked` (+amount), `BalanceUnlocked` (-amount)
**Active**: votingPower != '0'

Files: `src/handlers/LockManager.ts`

## CampaignReward (Capital Distributor — legacy only)

| Field | Description |
|---|---|
| `memberAddress` | Reward recipient |
| `campaignId` | Campaign identifier |
| `amount` | Reward amount |
| `proof` | Merkle proof for claiming |
| `claimed` | Whether claimed |

Not in Envio — legacy tracks reward recipients for merkle campaign distribution.

## Unique Members Calculation (DAO-level)

Legacy aggregates unique members across ALL installed plugins with `isSupported = true`:

1. **TokenVoting plugins**: TokenMember where `votingPower != '0'` + Lock where `delegateReceiverAddress != null`
2. **LockToVote plugins**: LockToVoteMember where `votingPower != '0'`
3. **Multisig/Admin plugins**: All PluginMember records
4. Combine into Set for uniqueness → return count

Envio tracks `memberCount` on Dao but only from Multisig MembersAdded/Removed — does not aggregate across token/VE/lockToVote members.
