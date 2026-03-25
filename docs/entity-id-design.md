# Entity ID Design

## Principles

1. **Idempotency** — same event processed twice produces same ID, no duplicates
2. **No data loss** — event-sourced entities are append-only, never overwrite history
3. **No conflicts** — different events always produce different IDs
4. **Type safety** — ID builders take typed objects, not loose params
5. **Address normalization** — all addresses lowercased in IDs

## Core Concepts

### Plugin Versioning

A plugin address stays the same across install/update/uninstall cycles. What changes is the implementation behind the proxy and the settings. Each lifecycle event (InstallationPrepared, UpdateApplied, etc.) creates a **new Plugin record** with txHash in the ID:

```
Plugin address 0x01 (same address throughout):

Plugin A (chainId-tx1-0x01): v1.0, installed, settings X
  → Proposal 1 created (plugin_id = Plugin A, settingSnapshot from settings X)
  → Proposal 2 created (plugin_id = Plugin A, settingSnapshot from settings X)

UpdateApplied:
  → Plugin B (chainId-tx2-0x01): v2.0, installed, settings Y  [NEW record]
  → Plugin A: status → deprecated                              [OLD record preserved]
  → Proposal 3 created (plugin_id = Plugin B, settingSnapshot from settings Y)
  → Proposal 4 created (plugin_id = Plugin B, settingSnapshot from settings Y)

All 4 proposals queryable by pluginAddress=0x01
But each references its specific Plugin version + settings snapshot
```

### Settings & Proposals

Settings change independently of plugin updates (e.g., multisig `minApprovals` changed). Each settings change creates a new `PluginSetting` record (append-only via eventId).

When a proposal is created, it should store:
- `plugin_id` → the specific Plugin version record that was active
- Settings snapshot (or `pluginSetting_id`) → the settings that governed this proposal

This way you can answer: "Proposal 1 was created under Plugin v1.0 with settings X where minApprovals=3, while Proposal 3 was created under Plugin v2.0 with settings Y where minApprovals=5."

### Vote History

Each vote event creates a new record. If a voter changes their vote, the old record is preserved and marked with `replacedBy` pointing to the new vote ID:

```
VoteCast(proposal=1, voter=Alice, option=Yes)  → Vote X (active)
VoteCast(proposal=1, voter=Alice, option=No)   → Vote Y (active), Vote X.replacedBy = Y
```

### Lock History

Each lock state change creates a new record tied to the event:

```
Deposit(tokenId=42, amount=100)  → Lock record A (deposit event)
ExitQueued(tokenId=42)           → Lock record B (exit event)
Withdraw(tokenId=42)             → Lock record C (withdraw event)
```

All queryable by tokenId to reconstruct the full lifecycle.

## Entity ID Formats

### State Entities (upsert — one record per identity)

| Entity | ID Format | Components |
|---|---|---|
| Dao | `chainId-daoAddress` | One DAO per address per chain |
| Token | `chainId-tokenAddress` | One token per address per chain |
| PluginMember | `chainId-pluginAddress-memberAddress` | One membership per member per plugin |
| TokenMember | `chainId-tokenAddress-memberAddress` | One VP record per delegatee per token |
| LockToVoteMember | `chainId-lockManagerAddress-memberAddress` | One locked balance per member |
| Gauge | `chainId-pluginAddress-gaugeAddress` | Same gauge can be used across multiple plugins |
| Campaign | `chainId-pluginAddress-campaignId` | One campaign per distributor |

### Versioned Entities (append-only, txHash in ID)

| Entity | ID Format | Components |
|---|---|---|
| Plugin | `chainId-txHash-pluginAddress` | New record per install/update. Old → deprecated |
| Proposal | `chainId-txHash-pluginAddress-proposalIndex` | Created once. Updated in place (Executed/Canceled) but txHash ensures uniqueness at creation |
| Lock | `chainId-txHash-txIndex-logIndex-escrowAddress-tokenId` | New record per state change (deposit, exit, withdraw) |

### Event-Sourced Entities (append-only, event-scoped)

| Entity | ID Format | Components |
|---|---|---|
| Vote | `chainId-txHash-txIndex-logIndex` | One per vote event. Old votes marked `replacedBy` |
| PluginSetupLog | `chainId-txHash-txIndex-logIndex` | One per PSP lifecycle event |
| DaoPermission | `chainId-txHash-txIndex-logIndex` | One per Granted/Revoked event |
| PluginSetting | `chainId-txHash-txIndex-logIndex` | One per settings change event |
| DelegateChangedEvent | `chainId-txHash-txIndex-logIndex` | Pure event log |
| DelegateVotesChangedEvent | `chainId-txHash-txIndex-logIndex` | Pure event log |
| GaugeVote | `chainId-txHash-txIndex-logIndex` | One per gauge vote/reset event |
| TokenDelegation | `chainId-txHash-txIndex-logIndex` | One per delegation change event |
| SelectorPermission | `chainId-txHash-txIndex-logIndex` | One per selector allowed/disallowed event |
| NativeTransferPermission | `chainId-txHash-txIndex-logIndex` | One per native transfer toggle event |

### Hybrid Entities (created once, updated by later events)

| Entity | ID Format | Lookup Pattern |
|---|---|---|
| Proposal | `chainId-txHash-pluginAddress-proposalIndex` | Created by ProposalCreated. Updated by Executed/Canceled via `getWhere({ pluginAddress, proposalIndex })` |

Note: Proposal uses txHash in ID for uniqueness at creation, but later events (Executed, Canceled) need to find it by `pluginAddress + proposalIndex` since they don't know the creation txHash. Use `getWhere` for lookups.

## Handler Patterns

### Finding current active Plugin for an address

When events fire on a plugin contract (VoteCast, ProposalCreated, etc.), the handler needs the active Plugin record:

```typescript
// Find the installed (non-deprecated) plugin at this address
const plugins = await context.Plugin.getWhere({ address: pluginAddress, status: "installed" });
const plugin = plugins[0]; // latest installed version
```

### Creating a new Plugin version on update

```typescript
// UpdateApplied handler
// 1. Find current installed plugin
const currentPlugins = await context.Plugin.getWhere({ address: pluginAddress, status: "installed" });
const currentPlugin = currentPlugins[0];

// 2. Mark current as deprecated
if (currentPlugin) {
  context.Plugin.set({ ...currentPlugin, status: "deprecated" });
}

// 3. Create new plugin version
const newId = pluginId({ chainId, txHash: event.transaction.hash, pluginAddress });
context.Plugin.set({
  id: newId,
  // ... inherit tokenAddress, votingEscrow, lockManagerAddress from old
  // ... update version, status: "installed"
});
```

### Vote replacement

```typescript
// VoteCast handler
const newVoteId = voteId({ chainId, txHash, txIndex, logIndex });

// Check if voter already voted on this proposal
const existingVotes = await context.Vote.getWhere({
  pluginAddress,
  proposalIndex,
  memberAddress: voter,
  replacedBy: undefined, // only active (non-replaced) votes
});

if (existingVotes.length > 0) {
  // Mark old vote as replaced
  const oldVote = existingVotes[0];
  context.Vote.set({ ...oldVote, replacedBy: newVoteId });
}

// Create new vote
context.Vote.set({ id: newVoteId, ... });
```

## ID Builder API (Typed Objects)

All ID builders take a single typed object parameter:

```typescript
// State entities
daoId({ chainId, daoAddress })
tokenId({ chainId, tokenAddress })
pluginMemberId({ chainId, pluginAddress, memberAddress })
gaugeId({ chainId, pluginAddress, gaugeAddress })
campaignId({ chainId, pluginAddress, campaignId })

// Versioned entities
pluginId({ chainId, txHash, pluginAddress })
proposalId({ chainId, txHash, pluginAddress, proposalIndex })
lockId({ chainId, txHash, txIndex, logIndex, escrowAddress, tokenId })

// Event-sourced entities (all use the same pattern)
eventId({ chainId, txHash, txIndex, logIndex })
```

## Migration Impact

This is a **full reindex** — all entity IDs change. No migration of existing data needed since Envio reindexes from scratch on handler changes.

Schema changes needed:
- `Plugin`: keep `address` field (for queries), ID now includes txHash
- `Proposal`: add `pluginSetting_id` or settings snapshot fields
- `Vote`: add `replacedBy: String` field
- `Lock`: keep `tokenId` field (for queries), ID now includes event context
- Various: add `txIndex` to field_selection in config.yaml if not already there
