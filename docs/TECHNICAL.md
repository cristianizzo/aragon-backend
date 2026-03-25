# Aragon Indexer — Technical Architecture

## Overview

The Aragon Indexer is built on [Envio HyperIndex](https://docs.envio.dev), an event-driven EVM indexer that uses HyperSync for high-throughput historical sync and RPC fallback for real-time blocks. It indexes the full Aragon OSx protocol across 11 chains.

The indexer follows a **factory pattern**: only three contracts have known addresses per chain (DAORegistry, PluginRepoRegistry, PluginSetupProcessor). All other contracts (DAOs, plugins, tokens, VE contracts) are discovered dynamically at runtime as events fire.

---

## Flow 1: DAO Deployment

A single `DAOFactory.createDAO()` transaction emits events across multiple contracts. The indexer processes them all within the same block.

### Step 1: DAO Registration (DAORegistered)

**contractRegister**: `context.addDAO(dao)` — starts tracking DAO contract events.

**handler**: Creates `Dao` entity (ID: `${chainId}-${daoAddress}`) with:
- **RPC calls via `fetchDaoInfo` effect**: implementation address (EIP-1967 proxy slot), protocol version (`protocolVersion()` → `"major.minor.patch"`, defaults to `"1.0.0"`)
- **ENS**: derived from subdomain → `${subdomain}.dao.eth`
- Zeroed metrics, no metadata yet

Files: `src/handlers/DAORegistry.ts`, `src/effects/rpc.ts`

### Step 2: Metadata from IPFS (MetadataSet)

Extracts IPFS CID from `bytes metadata`, fetches JSON via gateway chain (Pinata → ipfs.io → dweb.link → cloudflare).

**Stores**: name, description, avatar, links, processKey, stageNames, blockedCountries, termsConditionsUrl, enableOfacCheck.

Can fire multiple times. New values overwrite; missing fields preserve previous values.

Files: `src/handlers/DAO.ts`, `src/effects/ipfs.ts`

### Step 3: Permissions (Granted / Revoked)

Each event creates a `DaoPermission` entity (audit trail). On Granted with non-zero condition: `context.addExecuteSelectorCondition(condition)`.

### Step 4: Other DAO Events

| Event | Status |
|---|---|
| `NativeTokenDeposited` | Empty handler — TODO: Transaction entity |
| `Executed` | Empty handler — TODO: DAO upgrade detection, native transfer extraction |

### Step 5: Metrics

Incremented by governance handlers: `proposalCount`, `proposalsExecuted`, `voteCount`, `uniqueVoters`, `memberCount`.

### Remaining Gaps (DAO Flow)

| Gap | Priority |
|---|---|
| NativeTokenDeposited → Transaction entity | P0 |
| Executed → DAO upgrade detection + native transfers | P0 |
| DAO linking (parent/child via bidirectional permissions) | P1 |
| Base Member entity for creator | P1 |
| Treasury/Asset tracking + tvlUSD | P2 |
| isActive/isHidden flags | P3 |

---

## Flow 2: SubDAO Linking

See [subdao-linking.md](subdao-linking.md). **Not yet implemented.** Two DAOs link via bidirectional acknowledgement permissions. Max 2-level hierarchy.

---

## Flow 3: Plugin Installation, Update & Uninstallation

### Plugin Type Detection (Two-Tier)

1. **Repo Lookup** (`src/utils/pluginRepos.ts`): 226 known `pluginSetupRepo` addresses → type. Instant.
2. **Bytecode Fallback** (`src/utils/bytecodeDetector.ts`): RPC `eth_getCode` + function selector matching.

Types: multisig, tokenVoting, admin, addresslistVoting, spp, lockToVote, gauge, capitalDistributor, router, claimer, unknown.

### Installation (InstallationPrepared + InstallationApplied)

#### contractRegister (before handler)

Registers plugin contract for event tracking based on detected type:

| Type | Registers | RPC Calls |
|---|---|---|
| multisig | `addMultisig(plugin)` | None |
| tokenVoting | `addTokenVoting` + `addGovernanceERC20(token)` + VE contracts | `token.escrow()` → `escrow.queue()` |
| spp | `addStagedProposalProcessor` | None |
| lockToVote | `addLockToVote` + `addLockManager` + `addGovernanceERC20` + VE | `plugin.lockManager()` + VE discovery |
| gauge | `addGaugeVoter` | None |
| capitalDistributor | `addCapitalDistributor` | None |
| admin/router/claimer | None | None |
| unknown | Bytecode detection → register based on result | `eth_getCode` |

**Token extraction** from `preparedSetupData.helpers[]`:
- OSx v1.0/v1.3: `helpers = [token]` → index 0
- New token-voting-plugin: `helpers = [VotingPowerCondition, token]` → last index
- Applied for: tokenVoting, addresslistVoting, lockToVote

**VE discovery** (best-effort RPC): `token.escrow()` → escrowAddress → `escrow.queue()` → exitQueueAddress, `escrow.lockNFT()` → nftLockAddress, `escrow.token()` → underlyingToken

#### InstallationPrepared Handler

1. **Parse permissions** from `preparedSetupData[1]`: `{ operation, where, who, condition, permissionId }[]`
2. **Extract proposalCreationConditionAddress** from permissions (match `PROPOSAL_CREATION_PERMISSION` + `GrantWithCondition`)
3. **Detect interface type** (repo lookup + bytecode fallback)
4. **Discover VE contracts** via `discoverVotingEscrow` effect → stored as `Plugin.votingEscrow` JSON
5. **Discover LockManager** for lockToVote → stored as `Plugin.lockManagerAddress`
6. **Fetch implementation address** via `fetchDaoInfo` effect (EIP-1967 slot)
7. **Set plugin flags**: `isSupported`, `isProcess`, `isBody`, `isSubPlugin`
8. **Create Plugin entity** (status=preInstall)
9. **Create Token entity** if tokenAddress found (name, symbol, decimals via RPC)
10. **Create PluginSetupLog** (audit trail with permissions)

#### InstallationApplied Handler

1. Create PluginSetupLog
2. Update Plugin.status → "installed"

### Update (UpdatePrepared + UpdateApplied)

- **UpdatePrepared**: Creates PluginSetupLog with parsed permissions
- **UpdateApplied**: Creates PluginSetupLog + updates Plugin status → "updated", blockNumber, blockTimestamp, transactionHash

### Uninstallation (UninstallationPrepared + UninstallationApplied)

- **UninstallationPrepared**: Creates PluginSetupLog
- **UninstallationApplied**: Creates PluginSetupLog + updates Plugin status → "uninstalled", isSupported → false

### SPP Sub-Plugin Discovery (StagesUpdated)

When the `StagesUpdated` event fires on an SPP plugin:

1. **Parse stages**: Each stage contains `bodies[]` (address, isManual, tryAdvance, resultType), maxAdvance, minAdvance, voteDuration, approvalThreshold, vetoThreshold, cancelable, editable
2. **Update SPP Plugin**: Set `totalStages`, `subPlugins` (array of `{stageIndex, addresses[]}`)
3. **Create PluginSetting**: Full stage configuration stored as JSON
4. **Pair sub-plugins**: For each body address → look up Plugin entity → set `parentPlugin`, `stageIndex`, `isSubPlugin=true`, `isBody`, `isProcess`

### Plugin Schema

```graphql
type Plugin {
  id: ID!                              # ${chainId}-${pluginAddress}
  address: String!
  dao: Dao!
  interfaceType: PluginInterfaceType!   # tokenVoting, multisig, spp, etc.
  status: PluginStatus!                 # preInstall → installed → updated → uninstalled
  isSupported: Boolean!                 # true for known governance types
  implementationAddress: String         # EIP-1967 proxy implementation
  pluginSetupRepo: String
  release: Int
  build: Int
  tokenAddress: String                  # governance token (tokenVoting/lockToVote)
  votingEscrow: Json                    # { escrowAddress, exitQueueAddress, nftLockAddress, underlyingToken }
  proposalCreationConditionAddress: String
  lockManagerAddress: String
  permissions: Json                     # parsed from PreparedSetupData
  subPlugins: Json                      # SPP: [{ stageIndex, addresses[] }]
  totalStages: Int                      # SPP: number of stages
  parentPlugin: String                  # sub-plugin: parent SPP address
  stageIndex: Int                       # sub-plugin: which stage
  isSubPlugin: Boolean!                 # true if body of an SPP
  isBody: Boolean!                      # true if voting/approval plugin
  isProcess: Boolean!                   # true if manages proposal flow
}
```

### Remaining Gaps (Plugin Flow)

| Gap | Priority |
|---|---|
| Plugin reinstallation via EXECUTE_PERMISSION grant | P1 |
| Uninstall via EXECUTE_PERMISSION revoke (fallback) | P1 |
| Sub-plugin abandonment on uninstall | P1 |
| Settings inactivation on uninstall | P1 |
| Update deprecation model (new entity vs in-place) | P3 (architecture decision) |
| Plugin slug generation | P3 |
| VE escrow settings (minDeposit, cooldown, fee params) | P3 |
| Policy/Router settings population | P3 |
| Gauge settings (enabledUpdatedVotingPowerHook) | P3 |

### Files

| File | Purpose |
|---|---|
| `src/handlers/PluginSetupProcessor.ts` | contractRegister + all 6 PSP event handlers |
| `src/handlers/StagedProposalProcessor.ts` | StagesUpdated + SPP proposal events |
| `src/utils/pluginRepos.ts` | 226 known repo → type mappings |
| `src/utils/bytecodeDetector.ts` | Bytecode fallback detection |
| `src/utils/veDiscovery.ts` | VE discovery (used in contractRegister) |
| `src/effects/rpc.ts` | fetchDaoInfo, fetchTokenMetadata, discoverVotingEscrow, discoverLockManager |
| `src/constants.ts` | EIP1967_IMPLEMENTATION_SLOT, PROTOCOL_VERSION_ABI, ABIs |

---

## Appendix: Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `ENVIO_API_TOKEN` | Yes | Envio platform auth |
| `NODES_DRPC_API_KEY` | Yes | dRPC key (config.yaml — 8 chains) |
| `NODES_ALCHEMY_API_KEY` | Yes | Alchemy fallback (config.yaml — 7 chains) |
| `ENVIO_RPC_URL_{chainId}` | Yes (×11) | Handler RPC calls |
| `NODES_KATANA_RPC_URL` | Yes | Katana (no dRPC) |
| `NODES_PEAQ_RPC_URL` | Yes | Peaq (QuikNode) |
| `NODES_CHILIZ_RPC_URL` | Yes | Chiliz (Ankr) |
| `PINATA_GATEWAY_URI` | No | Pinata IPFS gateway |
| `ETHERSCAN_API_KEY` | No | Etherscan v2 for action decoding |
| `ETHERSCAN_API_BASE_URL` | No | Etherscan v2 endpoint |

## Appendix: Entity ID Conventions

| Entity | ID Pattern |
|---|---|
| `Dao` | `${chainId}-${daoAddress}` |
| `Plugin` | `${chainId}-${pluginAddress}` |
| `Token` | `${chainId}-${tokenAddress}` |
| `Proposal` | `${chainId}-${pluginAddress}-${proposalIndex}` |
| `Vote` | `${chainId}-${pluginAddress}-${proposalIndex}-${voterAddress}` |
| `PluginSetting` | `${chainId}-${txHash}-${logIndex}` |
| `PluginMember` | `${chainId}-${pluginAddress}-${memberAddress}` |
| `DaoPermission` | `${chainId}-${txHash}-${logIndex}` |
| `PluginSetupLog` | `${chainId}-${txHash}-${logIndex}` |
| `Lock` | `${chainId}-${escrowAddress}-${tokenId}` |
| `Gauge` | `${chainId}-${pluginAddress}-${gaugeAddress}` |
| `GaugeVote` | `${chainId}-${pluginAddress}-${epoch}-${voterAddress}-${gaugeAddress}` |
| `Campaign` | `${chainId}-${pluginAddress}-${campaignId}` |
