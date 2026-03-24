---
name: aragon-migration-gaps
description: >-
  Use when planning migration work, prioritizing features, or checking what's
  missing vs the legacy app-backend. Full gap analysis for DAO flow, plugin
  lifecycle, governance, membership, and metrics. Priority tiers P0 through P3.
  Reference: docs/MIGRATION_GAPS.md for detailed tables.
---

# Migration Gaps — Legacy vs Envio

Full detailed tables in `docs/MIGRATION_GAPS.md`. This skill provides quick reference.

## P0 — Basic DAO & Plugin View

- [ ] DAO implementation address (RPC: EIP-1967 proxy slot)
- [ ] DAO version (RPC: `protocolVersion()`)
- [ ] ENS resolution (`${subdomain}.dao.eth`)
- [ ] Extra IPFS metadata fields (processKey, stageNames, blockedCountries, termsConditionsUrl, enableOfacCheck)
- [ ] NativeTokenDeposited → Transaction entity
- [ ] Executed → DAO upgrade detection + native transfer extraction
- [ ] Plugin permissions extraction from PreparedSetupData
- [ ] proposalCreationConditionAddress extraction
- [ ] Plugin implementation address (RPC)
- [ ] Full VE discovery (curve, clock, nftLock, underlying — 4 missing addresses)
- [ ] Token entity enrichment (type, isGovernance, logo, totalSupply)

## P1 — Full Governance View

- [ ] DAO linking (parent/child via bidirectional permissions)
- [ ] Base Member entity (cross-DAO identity with ENS/avatar)
- [ ] PluginMetrics (per member per plugin: voteCount, proposalCount, activity)
- [ ] DAO memberCount aggregation across ALL membership types (not just multisig)
- [ ] isSupported flag (derived from plugin type)
- [ ] Plugin flags (isProcess, isBody, isSubPlugin, isPolicy)
- [ ] SPP sub-plugin discovery & stage pairing (needs StagesUpdated event)
- [ ] SPP totalStages
- [ ] Proposal snapshot (totalSupply for TokenVoting, membersCount for Multisig)
- [ ] Proposal settings copy (frozen at creation)
- [ ] Proposal votesByOption aggregation
- [ ] Vote replacement tracking (replacedTransactionHash)
- [ ] Vote cleared audit trail (preserve entity instead of deleting)
- [ ] Selector permission decoding (functionName, contractName from selector)
- [ ] Plugin reinstallation via permission grant
- [ ] Uninstall via permission revoke (fallback)
- [ ] Sub-plugin abandonment on uninstall
- [ ] Settings inactivation on uninstall

## P2 — Treasury & Financial

- [ ] Treasury / Asset tracking (native + ERC20 balances per DAO)
- [ ] Full transaction history (incoming/outgoing ERC20 + native)
- [ ] tvlUSD metric (requires price feeds — CoinGecko)
- [ ] GaugeMetrics aggregation entity (per gauge per epoch)

## P3 — Nice to Have

- [ ] isActive / isHidden flags (may be API-layer)
- [ ] Update flow: deprecation model vs in-place (architecture decision)
- [ ] Plugin slug generation
- [ ] VE escrow settings (minDeposit, cooldown, fee params on PluginSetting)
- [ ] Policy/Router settings population
- [ ] Gauge settings (enabledUpdatedVotingPowerHook)
- [ ] LockToVote approvalThreshold setting
- [ ] Lock split/merge operations (VE)
- [ ] CampaignReward entity for capital distributor

## Architecture Decisions Needed

1. **Update flow**: Keep simple in-place update or adopt legacy deprecation model (new entity + mark old deprecated)?
2. **Metrics pattern**: Incremental counters (Envio) or re-count from source (legacy)? Incremental is faster but may drift on reindex.
3. **Vote clearing**: Delete entity (current) or mark cleared and preserve audit trail?
4. **Member count**: Only multisig (current) or aggregate all membership types?
5. **Treasury**: Is this indexer responsibility or separate service?
