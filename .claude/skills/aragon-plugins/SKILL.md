---
name: aragon-plugins
description: >-
  Use when working on plugin installation, update, uninstallation, type detection,
  or plugin settings. Covers PluginSetupProcessor events, contractRegister
  factory pattern, plugin type detection (repo lookup + bytecode fallback),
  token/VE discovery, SPP sub-plugin pairing, plugin lifecycle
  (preInstall → installed → updated → uninstalled → abandoned), and
  settings per governance type.
---

# Plugin Lifecycle

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
| lockToVote | `addLockToVote` + `addLockManager` + `addGovernanceERC20` + VE | RPC: lockManager + VE discovery |
| gauge | `addGaugeVoter` | None |
| capitalDistributor | `addCapitalDistributor` | None |

Token from `helpers[]`: index 0 (v1.0) or last index (new plugin).
VE chain: `token.escrow()` → `escrow.queue()`. Legacy also gets curve, clock, nftLock, underlying.

### Handler

**Prepared**: Create PluginSetupLog + Plugin (status=preInstall) + Token (if tokenAddress).
**Applied**: Update Plugin.status → installed.

## Update (UpdatePrepared + UpdateApplied)

**Envio**: Updates Plugin in-place (status=updated).
**Legacy**: Creates NEW Plugin, marks old as deprecated, inherits tokenAddress/votingEscrow/flags.

## Uninstallation

**Envio**: Plugin.status → uninstalled.
**Legacy**: Also deletes slug, abandons orphaned sub-plugins, inactivates settings. Has fallback uninstall via EXECUTE_PERMISSION revoke.

## Settings Per Type

| Type | Event | Key Fields |
|---|---|---|
| Multisig | `MultisigSettingsUpdated` | onlyListed, minApprovals |
| TokenVoting | `VotingSettingsUpdated` | votingMode, supportThreshold, minParticipation, minDuration, minProposerVotingPower |
| LockToVote | `VotingSettingsUpdated` | Same + approvalThreshold |
| VE | `VotingSettingsUpdated` + VE params | Same + minDeposit, minLockTime, maxTime, cooldown, slope, bias, fee params |
| SPP | `StagesUpdated` | stages[]: minAdvance, maxAdvance, voteDuration, approvalThreshold, vetoThreshold, plugins |
| Gauge | Manual | enabledUpdatedVotingPowerHook, VE escrow address |
| Router/Claimer | `SourceSettingsUpdated`, `ModelSettingsUpdated` | strategyType, source, model, swap |
| Admin | None | No settings |
| CapitalDistributor | None | Campaign-level config |

Each settings event creates a NEW PluginSetting snapshot (not overwrite). Legacy marks old as inactive.

## SPP Sub-Plugin Pairing (Legacy — not in Envio)

`StagesUpdated` event on SPP → parse stage structure → link sub-plugins via parentPlugin/stageIndex/isSubPlugin → set totalStages on SPP.

## Files

| File | Purpose |
|---|---|
| `src/handlers/PluginSetupProcessor.ts` | contractRegister + handlers |
| `src/utils/pluginRepos.ts` | Repo → type mapping |
| `src/utils/bytecodeDetector.ts` | Bytecode fallback |
| `src/utils/veDiscovery.ts` | VE discovery (RPC) |
| `src/effects/rpc.ts` | Token metadata + VE effects |
