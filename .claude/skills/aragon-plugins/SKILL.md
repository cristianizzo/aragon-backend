---
name: aragon-plugins
description: >-
  Use when working on plugin installation, update, uninstallation, type detection,
  plugin settings, or plugin versioning. Covers PluginSetupProcessor events,
  contractRegister factory pattern, plugin type detection (repo lookup + bytecode
  fallback), token/VE discovery, SPP sub-plugin pairing, plugin lifecycle
  (preInstall → installed → deprecated → uninstalled → abandoned), versioned
  Plugin IDs (chainId-txHash-pluginAddress), and settings per governance type.
---

# Plugin Lifecycle

## Plugin Versioning Model

Plugin address stays the same across install/update/uninstall. Each lifecycle event creates a **new Plugin record** with txHash in the ID:

```
Plugin address 0x01:

Plugin A (chainId-tx1-0x01): v1.0, installed, settings X
  → Proposal 1, 2 created under settings X

UpdateApplied:
  → Plugin B (chainId-tx2-0x01): v2.0, installed, settings Y [NEW record]
  → Plugin A: status → deprecated [OLD preserved]
  → Proposal 3, 4 created under settings Y

All proposals queryable by pluginAddress=0x01
Each references its specific Plugin version + settings
```

**Plugin ID**: `chainId-txHash-pluginAddress` (matches legacy `network-txHash-address`)

Handlers that receive events on a plugin address use `getWhere({ address, status: "installed" })` to find the active version.

## Type Detection

**Tier 1 — Repo Lookup** (`src/utils/pluginRepos.ts`): 226 known `pluginSetupRepo` addresses → type. Instant.
**Tier 2 — Bytecode** (`src/utils/bytecodeDetector.ts`): RPC `eth_getCode` + function selector matching. Fallback.

Types: multisig, tokenVoting, admin, addresslistVoting, spp, lockToVote, gauge, capitalDistributor, router, claimer, unknown.

## Installation (InstallationPrepared + InstallationApplied)

### contractRegister (before handler)

| Type | Registers | External Calls |
|---|---|---|
| multisig | `addMultisig(plugin)` | None |
| tokenVoting | `addTokenVoting` + `addGovernanceERC20(token)` + VE | RPC: escrow/exitQueue discovery |
| spp | `addStagedProposalProcessor` | None |
| lockToVote | `addLockToVote` + `addLockManager` + `addGovernanceERC20` + VE | RPC: lockManager + VE |
| gauge | `addGaugeVoter` | None |
| capitalDistributor | `addCapitalDistributor` | None |

Token from `helpers[]`: index 0 (v1.0) or last index (new plugin).
VE chain: `token.escrow()` → `escrow.queue()`, `escrow.lockNFT()`, `escrow.token()`.

### InstallationPrepared Handler

1. Parse permissions from `preparedSetupData[1]`
2. Extract proposalCreationConditionAddress from permissions
3. Detect interface type (repo + bytecode fallback)
4. Discover VE contracts → `Plugin.votingEscrow` JSON
5. Discover LockManager → `Plugin.lockManagerAddress`
6. Fetch implementation address (EIP-1967)
7. Set flags: isSupported, isProcess, isBody, isSubPlugin
8. Create Plugin entity (status=preInstall, ID includes txHash)
9. Create Token entity if tokenAddress found

### InstallationApplied Handler

Update Plugin.status → installed.

## Update (UpdatePrepared + UpdateApplied)

**UpdateApplied**:
1. Find current installed plugin via `getWhere({ address, status: "installed" })`
2. Mark current as `deprecated`
3. Create NEW Plugin record (new txHash = new ID)
4. Inherit: tokenAddress, votingEscrow, lockManagerAddress, flags from old version

## Uninstallation

**UninstallationApplied**: Mark Plugin status → uninstalled, isSupported → false.

**Legacy also supports**:
- Uninstall via EXECUTE_PERMISSION revoke (fallback)
- Plugin reinstallation via EXECUTE_PERMISSION grant → creates new Plugin record

## SPP Sub-Plugin Discovery (StagesUpdated)

`StagesUpdated` event on SPP → parse stages → pair sub-plugins:
- SPP Plugin: set totalStages, subPlugins
- Each body Plugin: set parentPlugin, stageIndex, isSubPlugin=true
- Create PluginSetting with full stage configuration

## Settings Per Type

| Type | Event | Key Fields |
|---|---|---|
| Multisig | `MultisigSettingsUpdated` | onlyListed, minApprovals |
| TokenVoting | `VotingSettingsUpdated` | votingMode, supportThreshold, minParticipation, minDuration, minProposerVotingPower |
| LockToVote | `VotingSettingsUpdated` | Same + approvalThreshold |
| SPP | `StagesUpdated` | stages[]: bodies, minAdvance, maxAdvance, voteDuration, thresholds |
| Admin/CapitalDistributor | None | No settings |

Each settings event creates a NEW PluginSetting (append-only, ID: `chainId-txHash-txIndex-logIndex`).

## Entity ID Design

See `docs/entity-id-design.md` for full rationale.

| Entity | ID Format | Strategy |
|---|---|---|
| Plugin | `chainId-txHash-pluginAddress` | Versioned (new record per lifecycle event) |
| PluginSetupLog | `chainId-txHash-txIndex-logIndex` | Event-sourced (append-only) |
| PluginSetting | `chainId-txHash-txIndex-logIndex` | Event-sourced (append-only) |
| PluginMember | `chainId-pluginAddress-memberAddress` | State (upsert) |
| Token | `chainId-tokenAddress` | State (upsert) |

## Files

| File | Purpose |
|---|---|
| `src/handlers/PluginSetupProcessor.ts` | contractRegister + all 6 PSP event handlers |
| `src/handlers/StagedProposalProcessor.ts` | StagesUpdated + SPP proposal events |
| `src/utils/pluginRepos.ts` | 226 known repo → type mappings |
| `src/utils/bytecodeDetector.ts` | Bytecode fallback detection |
| `src/utils/veDiscovery.ts` | VE discovery (used in contractRegister) |
| `src/utils/ids.ts` | All entity ID builders |
| `src/utils/metadata.ts` | Parsing helpers (actions, stages, IPFS) |
| `src/effects/rpc.ts` | fetchDaoInfo, fetchTokenMetadata, discoverVotingEscrow |
| `docs/entity-id-design.md` | Full entity ID design rationale |
