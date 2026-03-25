# Migration Gaps — Legacy App-Backend vs Envio Indexer

## Flow 1: DAO Deployment — Detailed Per-Event Comparison

### DAORegistered Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| address, creatorAddress, subdomain | Yes | Yes | ✅ |
| transactionHash, blockNumber, blockTimestamp | Yes | Yes | ✅ |
| implementationAddress | RPC: proxy resolution | RPC: EIP-1967 slot | ✅ |
| version | RPC: `protocolVersion()` | RPC: `protocolVersion()` | ✅ |
| ens | RPC: ENS registry + ownership check | Derived: `${subdomain}.dao.eth` | ⚠️ No ownership verification |
| isActive | `true` (default) | Not stored | ❌ |
| isHidden | `false` (default) | Not stored | ❌ |
| isSupported | `false` (set later by plugin) | Not stored on Dao | ❌ |
| Base Member for creator | Creates Member entity | Not done | ❌ |

### MetadataSet Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| name, description | Yes | Yes | ✅ |
| avatar | Yes (handles `avatar.path` objects) | Yes (raw value) | ⚠️ No `avatar.path` normalization |
| links | Yes | Yes | ✅ |
| processKey | Yes | Yes | ✅ |
| stageNames | Yes | Yes | ✅ |
| blockedCountries | Yes | Yes | ✅ |
| termsConditionsUrl | Yes | Yes | ✅ |
| enableOfacCheck | Yes | Yes | ✅ |
| LogMetadata audit entity | Creates LogMetadata doc | Not created | ❌ |

### Granted Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| DaoPermission entity | Yes | Yes | ✅ |
| permissionId, who, where, condition | Yes | Yes | ✅ |
| Condition contract registration | Yes | Yes | ✅ |
| Admin member creation | Creates PluginMember on EXECUTE_PROPOSAL_PERMISSION | Not done | ❌ |
| DAO linking check | Checks acknowledgement permission IDs | Not done | ❌ |
| Plugin reinstall on EXECUTE_PERMISSION grant | Reinstalls uninstalled plugins | Not done | ❌ |

### Revoked Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| DaoPermission entity | Yes | Yes | ✅ |
| DAO unlinking check | Checks acknowledgement permission IDs | Not done | ❌ |
| Plugin uninstall on EXECUTE_PERMISSION revoke | Fallback uninstall mechanism | Not done | ❌ |
| Admin member removal | Removes PluginMember | Not done | ❌ |

### NativeTokenDeposited Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| Transaction entity (deposit) | Creates with type=native, side=deposit, sender, amount | Empty handler | ❌ |

### Executed Event

| Data Point | Legacy | Envio | Match |
|---|---|---|---|
| DAO version upgrade detection | Checks `upgradeToAndCall` selector in actions | Empty handler | ❌ |
| Native transfer extraction | Scans actions for value > 0, creates Transaction entities | Empty handler | ❌ |

### Metrics

| Metric | Legacy | Envio | Match |
|---|---|---|---|
| proposalCount | Re-counted from source | Incremental counter | ✅ (different pattern) |
| proposalsExecuted | Re-counted | Incremental counter | ✅ |
| voteCount | Re-counted | Incremental counter | ✅ |
| uniqueVoters | Distinct member×plugin pairs | Incremental counter | ✅ (different pattern) |
| memberCount | Aggregated across ALL membership types | Only Multisig MembersAdded/Removed | ⚠️ Incomplete |
| tvlUSD | Sum of Asset USD values | Not tracked | ❌ |

### Summary — DAO Registration Flow

**Fully done**: DAO entity creation, implementation address, version, ENS, full IPFS metadata (including all extra fields), permissions (Granted/Revoked), condition contract discovery, basic metrics.

**Still missing** (to reach full parity):

1. **`avatar.path` normalization** — legacy handles IPFS metadata where avatar is an object `{path: "..."}` instead of a string. Small fix in the IPFS effect.
2. **DAO linking** (Granted/Revoked) — bidirectional permission check. Medium effort. See `docs/subdao-linking.md`.
3. **Admin member creation** (Granted) — create PluginMember on `EXECUTE_PROPOSAL_PERMISSION`. Small.
4. **Plugin reinstall/uninstall** via permission events. Medium.
5. **NativeTokenDeposited** → Transaction entity. Small (needs new entity).
6. **Executed** → DAO upgrade detection + native transfer extraction. Medium.
7. **Base Member entity** for creator. Small (needs new entity).
8. **memberCount** aggregation across all membership types. Medium (query-time or cross-handler).
9. **tvlUSD** — requires treasury/asset tracking + price feeds. Large.
10. **isActive/isHidden** flags — may be API-layer concern. Trivial if needed.
11. **ENS ownership verification** — current approach derives from subdomain, legacy verifies on-chain. Low priority.

---

## Flow 2: Plugin Installation, Update & Uninstallation — Gap Analysis

| Feature | Legacy Backend | Envio Indexer | Status |
|---|---|---|---|
| **Plugin type detection — repo lookup** | Bytecode-based detection only | Repo address lookup (226 repos) + bytecode fallback | **Done** (better) |
| **Plugin type detection — bytecode fallback** | Checks function selectors in bytecode | Same approach | **Done** |
| **InstallationPrepared → Plugin preInstall** | Create Plugin, detect type, extract permissions | Create Plugin, detect type, extract permissions, discover VE, set flags | **Done** |
| **InstallationApplied → Plugin installed** | Update status=installed, generate slug, create settings | Update status=installed | **Done** (no slug) |
| **Token discovery (tokenVoting/lockToVote)** | RPC: `getVotingToken()` on plugin contract | Token from `helpers[]` in PreparedSetupData | **Done** |
| **Token entity creation** | Full: name, symbol, decimals, type, logo, totalSupply, holders, isGovernance | Basic: name, symbol, decimals | **Partial** |
| **VE discovery** | 6 addresses: escrow, curve, exitQueue, clock, nftLock, underlying | 4 addresses: escrow, exitQueue, nftLock, underlying | **Done** (missing curve, clock) |
| **VE votingEscrow field on Plugin** | Object with all 6 addresses | JSON with 4 addresses | **Done** (missing curve, clock) |
| **Plugin permissions extraction** | Parsed from PreparedSetupData | Parsed from PreparedSetupData | **Done** |
| **proposalCreationConditionAddress** | Extracted from PROPOSAL_CREATION_PERMISSION | Extracted from PROPOSAL_CREATION_PERMISSION | **Done** |
| **Plugin implementation address** | Fetched via proxy helper | Fetched via EIP-1967 slot | **Done** |
| **Plugin flags: isProcess/isBody/isSubPlugin** | Set based on type and SPP context | Set based on type and StagesUpdated | **Done** |
| **isSupported flag** | Derived from plugin type | Set for known governance types | **Done** |
| **lockManagerAddress on Plugin** | Discovered via RPC | Discovered via RPC | **Done** |
| **SPP sub-plugin discovery** | `pairSppPlugins()` on StagesUpdated | StagesUpdated handler with sub-plugin pairing | **Done** |
| **SPP totalStages** | Stored on Plugin | Stored on Plugin | **Done** |
| **SPP stages in Settings** | Full stage structure stored on PluginSetting | Full stage structure stored on PluginSetting | **Done** |
| **UpdatePrepared** | Creates LogPluginSetupProcessor with permissions | Creates PluginSetupLog with permissions | **Done** |
| **UpdateApplied** | Creates NEW Plugin, marks old as deprecated, inherits config | Updates Plugin in-place (status=updated) | **Different** |
| **UninstallationPrepared** | Creates LogPluginSetupProcessor | Creates PluginSetupLog | **Done** |
| **UninstallationApplied** | status=uninstalled, delete slug, abandon sub-plugins, inactivate settings | status=uninstalled, isSupported=false | **Partial** |
| **Plugin slug generation** | `PluginSlug.generateSlug()` | Not implemented | Missing |
| **Plugin metadata (name/desc/links)** | Fetched from IPFS on SPP MetadataSet | SPP MetadataSet stores name as subdomain | **Partial** |
| **Uninstall via permission revoke** | Fallback: EXECUTE_PERMISSION revoke triggers uninstall | Not implemented | Missing |
| **Sub-plugin abandonment on uninstall** | Orphaned sub-plugins marked status=abandoned | Not implemented | Missing |
| **Settings inactivation on uninstall** | Settings marked inactive with inactiveAtBlockNumber | Not tracked | Missing |
| **Plugin reinstallation** | EXECUTE_PERMISSION grant on uninstalled plugin → status=installed | Not implemented | Missing |
| **Update — DAO version upgrade** | Checks for `upgradeToAndCall` in execution, updates DAO version | Not checked | Missing |
| **Gauge settings** | enabledUpdatedVotingPowerHook, VE escrow settings | Not tracked | Missing |
| **LockToVote settings** | approvalThreshold (additional field) | Not stored | Missing |
| **VE escrow settings** | minDeposit, minLockTime, cooldown, maxTime, slope, bias, feePercent | Not tracked | Missing |
| **Policy/Router settings** | policyId, strategyType, source, model, swap | policy field exists but not populated | Missing |
| **PluginMetrics (per member)** | proposalsCreated, votes, firstActivity, lastActivity | PluginActivityMetric exists but simpler | **Partial** |
| **Member creation on install** | Creates base Member + PluginMember for admin on permission grant | Not done at install time | Missing |

---

## Priority Tiers (Updated)

### P0 — Done
- [x] DAO implementation address (RPC: EIP-1967 proxy slot)
- [x] DAO version (RPC: `protocolVersion()`)
- [x] ENS resolution (`${subdomain}.dao.eth`)
- [x] Extra IPFS metadata fields (processKey, stageNames, blockedCountries, termsConditionsUrl, enableOfacCheck)
- [x] Plugin permissions extraction from PreparedSetupData
- [x] proposalCreationConditionAddress extraction
- [x] Plugin implementation address (RPC)
- [x] isSupported flag (derived from plugin type)
- [x] Plugin flags (isProcess/isBody/isSubPlugin)
- [x] SPP sub-plugin discovery & stage pairing (StagesUpdated event)
- [x] SPP totalStages
- [x] VE discovery (escrow, exitQueue, nftLock, underlying — 4 of 6 addresses)
- [x] lockManagerAddress stored on Plugin

### P0 — Remaining
- [ ] NativeTokenDeposited → Transaction entity
- [ ] Executed → DAO upgrade detection + native transfer extraction
- [ ] VE discovery: curve + clock addresses (2 remaining)
- [ ] Token entity enrichment (type, isGovernance, logo, totalSupply)

### P1 — Full Governance View
- [ ] DAO linking (parent/child via bidirectional permissions)
- [ ] Base Member entity (cross-DAO identity with ENS/avatar)
- [ ] PluginMetrics (per member per plugin: voteCount, proposalCount, activity)
- [ ] DAO memberCount aggregation across ALL membership types (not just multisig)
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
- [ ] Member creation on install (admin plugin)

### P2 — Treasury & Financial
- [ ] Treasury / Asset tracking (native + ERC20 balances per DAO)
- [ ] Full transaction history (incoming/outgoing ERC20 + native)
- [ ] tvlUSD metric (requires price feeds — CoinGecko)
- [ ] GaugeMetrics aggregation entity (per gauge per epoch)

### P3 — Nice to Have
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
2. **Metrics pattern**: Incremental counters (Envio) or re-count from source (legacy)?
3. **Vote clearing**: Delete entity (current) or mark cleared and preserve audit trail?
4. **Member count**: Only multisig (current) or aggregate all membership types?
5. **Treasury**: Is this indexer responsibility or separate service?
