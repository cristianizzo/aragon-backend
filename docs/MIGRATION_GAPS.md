# Migration Gaps — Legacy App-Backend vs Envio Indexer

## Flow 1: DAO Deployment — Gap Analysis

| Feature | Legacy Backend | Envio Indexer | Status |
|---|---|---|---|
| **DAO Registration** | Create DAO doc | Create Dao entity | Done |
| **Metadata from IPFS** | Fetch name/desc/avatar/links | Same | Done |
| **Extra metadata fields** | `processKey`, `stageNames`, `blockedCountries`, `termsConditionsUrl`, `enableOfacCheck` | Not stored | **Missing** |
| **Implementation address** | RPC: `getImplementationAddress()` | Not fetched | **Missing** |
| **DAO version** | RPC: `getDaoOsVersion()` | Not fetched | **Missing** |
| **ENS resolution** | `EnsHelper.getDaoEns()` | Not fetched | **Missing** |
| **isActive/isHidden/isSupported** | Stored on DAO | Not tracked | **Missing** |
| **Permissions (Granted/Revoked)** | Store DaoPermission + member creation + DAO linking | Store DaoPermission only | **Partial** |
| **DAO Linking (parent/child)** | Bidirectional linking via acknowledgement permissions | Not implemented | **Missing** |
| **NativeTokenDeposited** | Creates Transaction entity | Empty handler | **Missing** |
| **Executed event** | Checks for DAO upgrades, queues asset/tx discovery | Empty handler | **Missing** |
| **Treasury/Asset tracking** | Native + ERC20 balances, USD values, TVL | Not implemented | **Missing** |
| **Transaction tracking** | Incoming/outgoing ERC20 + native transfers | Not implemented | **Missing** |
| **Member creation** | Creates base Member for creator on registration | Not done | **Missing** |
| **DAO Metrics** | tvlUSD, proposalsCreated, proposalsExecuted, uniqueVoters, votes, members | proposalCount, proposalsExecuted, uniqueVoters, voteCount, memberCount (no tvlUSD) | **Partial** |
| **Action decoding** | Async queue-based | Effect-based (at ProposalCreated time) | Done (different approach) |
| **Selector permissions** | Decoded with function signature/NatSpec | Stored but not decoded | **Partial** |

---

## Missing Items — Detail

### 1. Implementation Address (RPC call at registration)

Legacy fetches the EIP-1967 proxy implementation address via `getImplementationAddress()` at DAO registration time. Stored on the DAO document.

- **Schema**: `implementationAddress` field exists but is always `undefined`
- **Fix**: RPC call `storage_at(0x360894a13db93b02...)` during DAORegistered handler
- **Effort**: Small — single RPC call via Effect

### 2. DAO Version (RPC call at registration)

Legacy calls `getDaoOsVersion()` to query the DAO's protocol version (e.g., "1.0.0", "1.3.0", "1.4.0").

- **Schema**: `version` field exists but is always `undefined`
- **Fix**: RPC call to DAO contract `protocolVersion()` or `daoURI()` during DAORegistered handler
- **Effort**: Small — single RPC call via Effect

### 3. ENS Resolution

Legacy resolves ENS name for the DAO via `EnsHelper.getDaoEns(daoAddress, subdomain)`. Constructs the full `.dao.eth` name.

- **Schema**: `ens` field exists but is always `undefined`
- **Fix**: Construct ENS from subdomain pattern (`${subdomain}.dao.eth`) or resolve via RPC
- **Effort**: Small — may not need RPC if ENS follows deterministic pattern

### 4. Extra IPFS Metadata Fields

Legacy parses additional fields from the IPFS metadata JSON that we currently ignore:

| Field | Type | Purpose |
|---|---|---|
| `processKey` | string | SPP process key identifier |
| `stageNames` | string[] | SPP stage names |
| `blockedCountries` | string[] | OFAC compliance — blocked country codes |
| `termsConditionsUrl` | string | Legal terms URL |
| `enableOfacCheck` | boolean | Whether OFAC screening is enabled |

- **Schema**: These fields don't exist on Dao entity
- **Fix**: Add fields to schema.graphql, parse from IPFS JSON in MetadataSet handler
- **Effort**: Small — schema + handler changes

### 5. isActive / isHidden / isSupported Flags

Legacy stores state flags on DAO:

| Flag | Purpose |
|---|---|
| `isActive` | Whether DAO is active (default true) |
| `isHidden` | Whether DAO is hidden from UI (admin flag) |
| `isSupported` | Whether DAO uses supported plugin types |

- **Schema**: These fields don't exist
- **Fix**: Add to schema. `isActive` and `isHidden` are admin-managed (may not be indexer concern). `isSupported` is derived from plugin types during installation
- **Effort**: Small for schema; `isSupported` logic exists in plugin detection

### 6. DAO Linking (Parent/Child DAOs)

Legacy implements bidirectional DAO linking via acknowledgement permissions:

- `PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID`
- `SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID`

When both permissions are granted bidirectionally, DAOs are linked. Constraints:
- Parent cannot become a child
- A child cannot become a parent
- A child can only have one parent

Stores `parentAccount` and `linkedAccounts[]` on Dao document. Parent TVL includes child TVL.

- **Schema**: `parentAccount` and `linkedAccounts` fields don't exist
- **Fix**: Add fields + logic in Granted/Revoked handlers to check bidirectional permissions and link/unlink
- **Effort**: Medium — needs bidirectional permission checking logic

### 7. NativeTokenDeposited — Transaction Tracking

Legacy creates a `Transaction` entity for every native deposit:
- `type: native`, `side: deposit`
- `sender`, `amount`, `daoAddress`
- Triggers asset/metric recalculation

Current Envio handler is empty (no entity created).

- **Schema**: No Transaction entity exists
- **Fix**: Add Transaction entity + populate in handler
- **Effort**: Medium — new entity + handler logic

### 8. Executed Event — DAO Upgrade Detection + Transaction Discovery

Legacy does two things on Executed:

**a) DAO Upgrade Detection**: Checks if any action in the execution calls `upgradeToAndCall()` targeting the DAO itself → updates DAO version.

**b) Transaction Discovery**: Scans `actions[]` for native transfers (entries with `value > 0`) and creates `Transaction` entities for outgoing native transfers.

Current Envio handler is empty.

- **Fix**: Add version upgrade detection + native transfer extraction
- **Effort**: Medium — parse actions array, detect upgrades via selector matching

### 9. Treasury / Asset Tracking

Legacy tracks full treasury state per DAO:

- **Native balance**: Queries on-chain ETH/native balance
- **ERC20 balances**: Queries all ERC20 token balances held by DAO
- **USD values**: Converts balances to USD via price feeds (CoinGecko)
- **TVL**: Sum of all asset USD values
- **Asset entity**: Per-token balance record with amount + USD value

This is the largest missing feature. It requires:
- Periodic on-chain balance queries (or tracking Transfer events to/from DAO)
- External price feed integration
- Asset entity in schema

- **Schema**: No Asset entity, no tvlUSD metric
- **Fix**: Track Transfer events to/from DAO + price feed Effect
- **Effort**: Large — new entity, Transfer event tracking, price feed integration

### 10. Full Transaction History

Legacy crawls blockchain logs to build complete transaction history:

- Incoming ERC20 transfers (`Transfer(from, to, amount)` where `to = DAO`)
- Outgoing ERC20 transfers (`Transfer(from, to, amount)` where `from = DAO`)
- Incoming native deposits (`NativeTokenDeposited`)
- Outgoing native transfers (extracted from `Executed` event actions)

Each creates a `Transaction` entity with type, side, token details, amount.

- **Schema**: No Transaction entity
- **Fix**: Could track via wildcard ERC20 Transfer events filtered to DAO addresses, or via Executed actions
- **Effort**: Large — wildcard Transfer tracking has performance implications

### 11. Member Creation on DAO Registration

Legacy creates a base `Member` entity for the DAO creator address at registration time, with ENS and avatar lookup.

- **Schema**: No base Member entity (only PluginMember, TokenMember, etc.)
- **Fix**: Add Member entity + create in DAORegistered handler
- **Effort**: Small-Medium — new entity, optional ENS/avatar resolution

### 12. Selector Permission Decoding

Legacy decodes function selectors in SelectorAllowed events:
- Parses function signature via contract ABI
- Stores `functionName`, `contractName`, `inputs`, `notice`

Current Envio handler stores raw selector bytes only.

- **Schema**: SelectorPermission exists but lacks decoded fields
- **Fix**: Add decoded fields + use action decoder pipeline or known ABI matching
- **Effort**: Small — reuse existing knownAbis.ts or 4bytes lookup

---

## Flow 2: Plugin Installation, Update & Uninstallation — Gap Analysis

| Feature | Legacy Backend | Envio Indexer | Status |
|---|---|---|---|
| **InstallationPrepared → Plugin preInstall** | Create Plugin with status=preInstall, detect type, extract permissions | Create Plugin with status=preInstall, detect type | **Partial** |
| **InstallationApplied → Plugin installed** | Update status=installed, generate slug, create settings, queue async jobs | Update status=installed | **Partial** |
| **Plugin type detection — repo lookup** | Bytecode-based detection only | Repo address lookup (226 repos) + bytecode fallback | Done (better) |
| **Plugin type detection — bytecode fallback** | Checks function selectors in bytecode | Same approach | Done |
| **Token discovery (tokenVoting/lockToVote)** | RPC: `getVotingToken()` on plugin contract | Token from `helpers[]` in PreparedSetupData | Done (different approach) |
| **Token entity creation** | Full token: name, symbol, decimals, type, logo, totalSupply, holders, isGovernance | Basic: name, symbol, decimals | **Partial** |
| **VE discovery** | RPC: escrow, curve, exitQueue, clock, nftLock, underlying (6 addresses) | RPC: escrow, exitQueue (2 addresses) | **Partial** |
| **VE votingEscrow field on Plugin** | Object with escrow, curve, exitQueue, clock, nftLock, underlying | JSON with escrow, exitQueue only | **Partial** |
| **Plugin permissions extraction** | Parsed from PreparedSetupData, stored on Plugin | Not extracted from event | **Missing** |
| **proposalCreationConditionAddress** | Extracted from PROPOSAL_CREATION_PERMISSION in permissions | Not extracted | **Missing** |
| **Plugin flags: isProcess/isBody/isSubPlugin/isPolicy** | Set based on plugin type and SPP context | Not tracked | **Missing** |
| **Plugin slug generation** | `PluginSlug.generateSlug()` — human-readable URL slug | Not implemented | **Missing** |
| **Plugin metadata (name/desc/links)** | Fetched from IPFS if MetadataSet fires on SPP | Not stored on Plugin (SPP subdomain only) | **Partial** |
| **Plugin implementation address** | Fetched via proxy helper | Not fetched | **Missing** |
| **SPP sub-plugin discovery** | `pairSppPlugins()` — links sub-plugins to stages, sets parentPlugin/stageIndex/isSubPlugin | Not implemented | **Missing** |
| **SPP totalStages** | Stored on Plugin from StagesUpdated event | Not tracked | **Missing** |
| **SPP stages in Settings** | Full stage structure: minAdvance, maxAdvance, voteDuration, thresholds, plugins per stage | Not stored (stages field exists but not populated from StagesUpdated) | **Missing** |
| **UpdatePrepared** | Creates LogPluginSetupProcessor | Creates PluginSetupLog | Done |
| **UpdateApplied** | Creates NEW Plugin (installed), marks old as deprecated, inherits config | Updates existing Plugin.status=updated | **Different** |
| **Update — version inheritance** | New plugin inherits tokenAddress, votingEscrow, lockManager, flags from old | No inheritance (same plugin entity updated) | **Different** |
| **Update — DAO version upgrade** | Checks for `upgradeToAndCall` in execution, updates DAO version | Not checked | **Missing** |
| **UninstallationPrepared** | Creates LogPluginSetupProcessor | Creates PluginSetupLog | Done |
| **UninstallationApplied** | status=uninstalled, delete slug, abandon orphaned sub-plugins | status=uninstalled only | **Partial** |
| **Uninstall via permission revoke** | Fallback: EXECUTE_PERMISSION revoke triggers uninstall | Not implemented | **Missing** |
| **Sub-plugin abandonment on uninstall** | Orphaned sub-plugins marked status=abandoned | Not implemented | **Missing** |
| **Settings status on uninstall** | Settings marked inactive with inactiveAtBlockNumber | Not tracked | **Missing** |
| **Plugin reinstallation** | EXECUTE_PERMISSION grant on uninstalled plugin → status=installed | Not implemented | **Missing** |
| **Gauge settings** | enabledUpdatedVotingPowerHook, VE escrow settings | Not tracked | **Missing** |
| **LockToVote settings** | approvalThreshold (additional field) | Not stored | **Missing** |
| **VE escrow settings** | minDeposit, minLockTime, cooldown, maxTime, slope, bias, feePercent, etc. | Not tracked | **Missing** |
| **Policy/Router settings** | policyId, strategyType, source, model, swap, subRouters/subClaimers | policy field exists but not populated | **Missing** |
| **PluginMetrics (per member)** | proposalsCreated, votes, firstActivity, lastActivity per member per plugin | PluginActivityMetric exists but simpler | **Partial** |
| **Member creation on install** | Creates base Member + PluginMember for admin plugin on EXECUTE_PROPOSAL_PERMISSION | Not done at install time | **Missing** |
| **Async post-install processing** | Queue job to `plugins` queue for further processing | Not applicable (Envio is synchronous) | N/A |

### Missing Items — Detail

#### 13. Plugin Permissions Extraction

Legacy parses permissions from `preparedSetupData.permissions` array and stores them on the Plugin entity. Each permission has: `operation` (Grant/Revoke), `where`, `who`, `condition`, `permissionId`.

Also extracts `proposalCreationConditionAddress` from the `PROPOSAL_CREATION_PERMISSION` in the permissions array — used to track who can create proposals.

- **Schema**: `permissions` field exists as Json but is always `undefined`
- **Fix**: Parse permissions from `event.params.preparedSetupData[1]` in InstallationPrepared handler
- **Effort**: Small — data is in the event, just needs parsing

#### 14. Plugin Flags (isProcess/isBody/isSubPlugin/isPolicy)

Legacy tracks these flags to categorize plugins within the SPP architecture:
- `isProcess`: Plugin manages proposal flow (SPP, governance plugins)
- `isBody`: Plugin provides voting/approval (TokenVoting, Multisig, LockToVote)
- `isSubPlugin`: Plugin is a stage body in an SPP
- `isPolicy`: Plugin is a Router/Claimer policy

- **Schema**: These fields don't exist on Plugin
- **Fix**: Add fields + set based on interfaceType and SPP context
- **Effort**: Small for basic flags, Medium if SPP pairing is needed

#### 15. SPP Sub-Plugin Discovery & Stage Pairing

Legacy's `pairSppPlugins()` method:
1. Reads `StagesUpdated` event on SPP plugin
2. Parses full stage structure (voteDuration, thresholds, plugins per stage)
3. Links sub-plugin addresses to their parent SPP
4. Sets `parentPlugin`, `stageIndex`, `isSubPlugin=true` on each sub-plugin
5. Sets `totalStages` and `subPlugins[]` on the SPP plugin

- **Schema**: `subPlugins` field exists as Json but isn't populated. No `parentPlugin`/`stageIndex` fields
- **Fix**: Add StagesUpdated event to SPP contract config, implement pairing logic
- **Effort**: Medium-Large — needs new event in config.yaml + complex pairing logic

#### 16. Full VE Discovery (6 addresses)

Legacy discovers 6 VE contract addresses, Envio discovers only 2:

| Address | Legacy | Envio |
|---|---|---|
| `escrowAddress` | Yes | Yes |
| `exitQueueAddress` | Yes | Yes |
| `curveAddress` | Yes | **Missing** |
| `clockAddress` | Yes | **Missing** |
| `nftLockAddress` | Yes (also saved as Token) | **Missing** |
| `underlying` (ERC20) | Yes | **Missing** |

- **Fix**: Add RPC calls for curve(), lockNFT(), token() on escrow contract during VE discovery
- **Effort**: Small — additional RPC calls in existing discovery flow

#### 17. Update Flow — Deprecation Model

Legacy creates a **new** Plugin entity on update and marks the old one as `deprecated`. The new plugin inherits key config from the old one (tokenAddress, votingEscrow, lockManager, flags).

Envio currently updates the existing Plugin entity in-place (status=updated).

- **Impact**: Different data model — legacy keeps full version history, Envio overwrites
- **Fix**: Either adopt legacy model (new entity per version) or accept the simpler approach
- **Effort**: Medium if adopting legacy model, None if current approach is acceptable

#### 18. Uninstall via Permission Revoke

Legacy has a fallback uninstall mechanism: when `EXECUTE_PERMISSION` is revoked on a plugin, it checks if the plugin should be uninstalled (no UninstallationApplied in same tx).

- **Fix**: Add logic in DAO.Revoked handler to check for plugin uninstall condition
- **Effort**: Medium — needs cross-entity query and tx receipt checking

#### 19. Plugin Reinstallation

Legacy supports re-installing a previously uninstalled plugin: when `EXECUTE_PERMISSION` is granted on an uninstalled plugin, it reactivates it.

- **Fix**: Add logic in DAO.Granted handler to check for plugin reinstall condition
- **Effort**: Small — check if plugin exists with status=uninstalled, update to installed

#### 20. VE Escrow Settings (on PluginSetting)

Legacy stores detailed VE escrow configuration on the Setting entity:
- `minDeposit`, `minLockTime`, `cooldown`, `maxTime` — lock parameters
- `slope`, `bias` — voting power curve parameters
- `feePercent`, `minFeePercent`, `minCooldown`, `feeType` — exit fee parameters

- **Schema**: Not on PluginSetting
- **Fix**: Add fields + fetch from escrow/exitQueue contracts during settings creation
- **Effort**: Medium — multiple RPC calls for escrow parameters

---

## Priority Tiers

### P0 — Required for feature parity (basic DAO view)
- [ ] Implementation address (RPC call)
- [ ] DAO version (RPC call)
- [ ] ENS resolution
- [ ] Extra IPFS metadata fields
- [ ] NativeTokenDeposited → Transaction entity
- [ ] Executed → DAO upgrade detection

### P0.5 — Required for feature parity (plugin view)
- [ ] Plugin permissions extraction from PreparedSetupData
- [ ] proposalCreationConditionAddress extraction
- [ ] Plugin implementation address (RPC call)
- [ ] Full VE discovery (curve, clock, nftLock, underlying — 4 additional addresses)
- [ ] Token entity: type, isGovernance, logo, totalSupply fields

### P1 — Required for full governance view
- [ ] DAO linking (parent/child)
- [ ] Member creation on registration
- [ ] isSupported flag (derived from plugin type)
- [ ] Selector permission decoding
- [ ] Plugin flags (isProcess/isBody/isSubPlugin/isPolicy)
- [ ] SPP sub-plugin discovery & stage pairing
- [ ] SPP totalStages
- [ ] Plugin reinstallation via permission grant
- [ ] Uninstall via permission revoke (fallback)
- [ ] Sub-plugin abandonment on uninstall
- [ ] Settings inactivation on uninstall

### P2 — Required for treasury/financial view
- [ ] Treasury / Asset tracking (native + ERC20 balances)
- [ ] Full transaction history
- [ ] TVL metric (requires price feeds)

### P3 — Nice to have / Architecture decisions
- [ ] isActive / isHidden flags (may be API-layer concern)
- [ ] Update flow: deprecation model vs in-place update (architecture decision)
- [ ] Plugin slug generation
- [ ] VE escrow settings (minDeposit, cooldown, fee params)
- [ ] Policy/Router settings population
- [ ] Gauge settings (enabledUpdatedVotingPowerHook)
- [ ] LockToVote approvalThreshold setting

### P0 — Required for feature parity (basic DAO view)
- [ ] Implementation address (RPC call)
- [ ] DAO version (RPC call)
- [ ] ENS resolution
- [ ] Extra IPFS metadata fields
- [ ] NativeTokenDeposited → Transaction entity
- [ ] Executed → DAO upgrade detection

### P1 — Required for full governance view
- [ ] DAO linking (parent/child)
- [ ] Member creation on registration
- [ ] isSupported flag (derived from plugin type)
- [ ] Selector permission decoding

### P2 — Required for treasury/financial view
- [ ] Treasury / Asset tracking (native + ERC20 balances)
- [ ] Full transaction history
- [ ] TVL metric (requires price feeds)

### P3 — Admin / operational
- [ ] isActive / isHidden flags (may be API-layer concern, not indexer)
