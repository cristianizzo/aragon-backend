---
name: aragon-proposals
description: >-
  Use when working on proposals, voting, action decoding, or proposal execution.
  Covers ProposalCreated → IPFS metadata + action decoding pipeline (5 stages),
  VoteCast/Approved, ProposalExecuted, vote clearing (LockToVote), SPP stage
  advancement, and proposal snapshot/settings capture.
---

# Proposals & Voting

## Proposal Creation (All Governance Plugins)

All proposal-capable plugins emit `ProposalCreated(proposalId, creator, startDate, endDate, metadata, actions[], allowFailureMap)` (custom event name per plugin to avoid collision).

### Handler Flow

1. Look up Plugin entity → get dao_id, daoAddress
2. Extract IPFS CID from metadata bytes → `context.effect(fetchProposalMetadata, cid)`
   Returns: `{ title, summary, description, resources[] }`
3. Extract rawActions: `actions.map(a => ({ to, value, data }))`
4. Decode actions: `context.effect(decodeProposalActions, { actions, chainId, daoAddress })`
5. Create Proposal entity (status="Active")
6. Increment `Dao.proposalCount`

### Action Decoding Pipeline (5 stages)

```
Stage 1: Known ABIs (instant) → knownAbis.ts
Stage 2: Proxy Detection (1 RPC) → EIP-1967 slot
Stage 3: Etherscan v2 API → ABI + NatSpec
Stage 4: 4bytes Directory → function signature
Stage 5: Unknown fallback
```

Output: `{ type, functionName, contractName, textSignature, notice, implementationAddress, parameters[] }`

Files: `src/effects/decodeActions.ts`, `src/helpers/actionDecoder.ts`, `src/helpers/knownAbis.ts`, `src/helpers/natspecParser.ts`

## Voting

### TokenVoting / LockToVote
```
VoteCast(proposalId, voter, voteOption, votingPower)
→ Create Vote entity, increment Proposal.voteCount + Dao.voteCount
```
voteOption: 1=Abstain, 2=Yes, 3=No

### Multisig
```
Approved(proposalId, approver)
→ Create Vote with voteOption=2, votingPower=undefined
```

### LockToVote — Vote Clearing
```
VoteCleared(proposalId, voter)
→ Envio: DELETES Vote entity, decrements counts
→ Legacy: Sets voteCleared.status=true, preserves audit trail
```

### Gauge (separate entity)
```
Voted(voter, gauge, epoch, votingPower, totals...)
→ Create GaugeVote entity (NOT Vote)
Reset(voter, gauge, epoch, ...) → GaugeVote with power removed
```
Epoch-scoped. Persistent votes carry to next epoch.

## Proposal Execution

```
ProposalExecuted(proposalId)
→ status="Executed", executed=true, executedAt, executedTxHash
→ Increment Dao.proposalsExecuted
```

## SPP-Specific Events

| Event | Action |
|---|---|
| `ProposalCanceled` | status → "Canceled" |
| `ProposalEdited` | Re-fetch metadata + re-decode actions |
| `ProposalAdvanced` | No entity update (stage progression implicit) |
| `ProposalResultReported` | No entity update |

## What Legacy Does That Envio Doesn't

### Proposal Snapshot (at creation)
- **TokenVoting**: `snapshot.totalSupply` = token total supply at block
- **Multisig**: `snapshot.membersCount` = member count at block

### Settings Copy (frozen at creation)
Static copy of plugin settings stored on proposal — used to evaluate results against the rules that were active when proposal was created.

### Proposal Metrics Aggregation
After every vote, legacy re-queries all votes and builds:
- `votesByOption[{ type, totalVotes, totalVotingPower }]`
- `missingVotes` = votes still needed

### Sub-Proposals (SPP)
Legacy stores `subProposals[]` on the SPP proposal — links to each sub-plugin's proposal with `stageIndex`, `pluginAddress`, `proposalIndex`.

Envio does not track sub-proposal linking yet.

## Proposal Schema

```graphql
type Proposal {
  id: ID!                    # ${chainId}-${pluginAddress}-${proposalIndex}
  dao: Dao!
  plugin: Plugin!
  proposalIndex: String!
  creatorAddress: String!
  metadataUri: String
  title: String
  summary: String
  description: String
  resources: Json
  rawActions: Json
  decodedActions: Json
  status: ProposalStatus!    # Active, Succeeded, Defeated, Executed, Canceled
  startDate: BigInt
  endDate: BigInt
  executed: Boolean!
  executedAt: Int
  executedTxHash: String
  voteCount: Int!
}

type Vote {
  id: ID!                    # ${chainId}-${pluginAddress}-${proposalIndex}-${voter}
  proposal: Proposal!
  plugin: Plugin!
  memberAddress: String!
  voteOption: Int
  votingPower: BigInt
}
```

## Handler Files

| File | Events |
|---|---|
| `src/handlers/TokenVoting.ts` | VotingSettingsUpdated, ProposalCreated, ProposalExecuted, VoteCast |
| `src/handlers/Multisig.ts` | MultisigSettingsUpdated, MembersAdded/Removed, ProposalCreated, ProposalExecuted, Approved |
| `src/handlers/StagedProposalProcessor.ts` | ProposalCreated/Executed/Canceled/Edited/Advanced, ResultReported, MetadataSet |
| `src/handlers/LockToVote.ts` | VotingSettingsUpdated, ProposalCreated, ProposalExecuted, VoteCast, VoteCleared |
| `src/handlers/GaugeVoter.ts` | GaugeCreated, Activated/Deactivated, MetadataUpdated, Voted, Reset |
