import { parseAbi } from "viem";

/**
 * Single source of truth for all on-chain ABI shapes used by the indexer.
 * Organized by domain. Read-only (view) functions and write functions live
 * together within each domain — callers select the slice they need.
 */

// --- Aragon DAO ---

export const dao = {
  protocolVersion: parseAbi(["function protocolVersion() view returns (uint8 major, uint8 minor, uint8 patch)"]),
  setMetadata: parseAbi(["function setMetadata(bytes metadata)"]),
  execute: parseAbi([
    "function execute(bytes32 callId, (address to, uint256 value, bytes data)[] actions, uint256 allowFailureMap)",
  ]),
  permissions: parseAbi([
    "function grant(address where, address who, bytes32 permissionId)",
    "function revoke(address where, address who, bytes32 permissionId)",
    "function grantWithCondition(address where, address who, bytes32 permissionId, address conditionOracle)",
  ]),
  upgrade: parseAbi(["function upgradeToAndCall(address newImplementation, bytes data)"]),
  configuration: parseAbi([
    "function setDaoURI(string newDaoURI)",
    "function setTrustedForwarder(address newTrustedForwarder)",
    "function registerStandardCallback(bytes4 interfaceId, bytes4 callbackSelector, bytes4 magicNumber)",
  ]),
} as const;

// --- ERC20 ---

export const erc20 = {
  metadata: parseAbi([
    "function name() view returns (string)",
    "function symbol() view returns (string)",
    "function decimals() view returns (uint8)",
  ]),
  standard: parseAbi([
    "function transfer(address to, uint256 amount) returns (bool)",
    "function transferFrom(address from, address to, uint256 amount) returns (bool)",
    "function approve(address spender, uint256 amount) returns (bool)",
  ]),
  mintable: parseAbi(["function mint(address to, uint256 amount)"]),
} as const;

// --- ERC721 / ERC1155 ---

export const erc721 = {
  standard: parseAbi([
    "function safeTransferFrom(address from, address to, uint256 tokenId)",
    "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
    "function transferFrom(address from, address to, uint256 tokenId)",
    "function approve(address to, uint256 tokenId)",
    "function setApprovalForAll(address operator, bool approved)",
  ]),
} as const;

export const erc1155 = {
  standard: parseAbi([
    "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
    "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
    "function setApprovalForAll(address operator, bool approved)",
  ]),
} as const;

// --- Governance ERC20 (delegated voting) ---

export const governanceErc20 = {
  delegation: parseAbi([
    "function delegate(address delegatee)",
    "function delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s)",
  ]),
  mintable: parseAbi(["function mint(address to, uint256 amount)"]),
} as const;

// --- Voting Escrow / Lock infrastructure ---

export const escrow = {
  // `escrow()` lives on the token-votes adapter and points to the
  // VotingEscrow contract. All other accessors below are called on the
  // VotingEscrow contract itself.
  escrow: parseAbi(["function escrow() view returns (address)"]),
  queue: parseAbi(["function queue() view returns (address)"]),
  curve: parseAbi(["function curve() view returns (address)"]),
  clock: parseAbi(["function clock() view returns (address)"]),
  lockNft: parseAbi(["function lockNFT() view returns (address)"]),
  token: parseAbi(["function token() view returns (address)"]),
  // Settings accessors used by `effects/escrowSettings.ts`.
  minDeposit: parseAbi(["function minDeposit() view returns (uint256)"]),
} as const;

export const exitQueueSettings = {
  minLock: parseAbi(["function minLock() view returns (uint256)"]),
  cooldown: parseAbi(["function cooldown() view returns (uint256)"]),
  feePercent: parseAbi(["function feePercent() view returns (uint256)"]),
  minFeePercent: parseAbi(["function minFeePercent() view returns (uint256)"]),
  minCooldown: parseAbi(["function minCooldown() view returns (uint256)"]),
} as const;

export const curveSettings = {
  maxTime: parseAbi(["function maxTime() view returns (uint256)"]),
  // `getCoefficients(amount)` returns `[bias, slope]` evaluated at `amount`.
  // Legacy probes the curve at `1e18` (one whole token) as a canonical sample.
  getCoefficients: parseAbi(["function getCoefficients(uint256 amount) view returns (uint256[2])"]),
} as const;

export const lockManager = {
  lockManager: parseAbi(["function lockManager() view returns (address)"]),
} as const;

export const votingEscrow = {
  actions: parseAbi([
    "function deposit(uint256 amount, uint256 duration)",
    "function withdraw(uint256 tokenId)",
    "function delegate(uint256 fromTokenId, uint256 toTokenId)",
    "function undelegate(uint256 fromTokenId, uint256 toTokenId)",
  ]),
} as const;

// --- Aragon Plugins ---

export const multisig = {
  members: parseAbi(["function addAddresses(address[] members)", "function removeAddresses(address[] members)"]),
  settings: parseAbi(["function updateMultisigSettings((bool onlyListed, uint16 minApprovals) multisigSettings)"]),
  // Event ABIs used by `services/pluginInstall.ts:backfillFromInstallTx`
  // to decode logs we couldn't stream live (Envio same-block bug — see
  // `effects/txReceipt.ts`). Same `MembersAdded` shape on AddresslistVoting.
  membersAddedEvent: parseAbi(["event MembersAdded(address[] members)"]),
  multisigSettingsUpdatedEvent: parseAbi([
    "event MultisigSettingsUpdated(bool onlyListed, uint16 indexed minApprovals)",
  ]),
} as const;

export const tokenVoting = {
  settings: parseAbi([
    "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
  ]),
  votingSettingsUpdatedEvent: parseAbi([
    "event VotingSettingsUpdated(uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower)",
  ]),
} as const;

export const addresslistVoting = {
  members: parseAbi(["function addAddresses(address[] members)", "function removeAddresses(address[] members)"]),
  settings: parseAbi([
    "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
  ]),
} as const;

export const spp = {
  settings: parseAbi([
    "function updateStages((uint64 maxAdvance, uint64 minAdvance, uint64 voteDuration, uint16 approvalThreshold, uint16 vetoThreshold, (address body, bool isManual)[] bodies)[] stages)",
  ]),
} as const;

export const gauge = {
  actions: parseAbi([
    "function createGauge(address gauge, string metadataURI)",
    "function registerGauge(address gauge, uint8 gaugeType, address creator, string metadataURI)",
    "function updateGaugeMetadata(address gauge, string metadataURI)",
    "function activateGauge(address gauge)",
    "function deactivateGauge(address gauge)",
  ]),
} as const;

export const capitalDistributor = {
  actions: parseAbi([
    "function createCampaign(address token, uint256 totalAmount, bytes32 merkleRoot, string metadataURI)",
    "function pauseCampaign(uint256 campaignId)",
    "function resumeCampaign(uint256 campaignId)",
    "function endCampaign(uint256 campaignId)",
  ]),
} as const;

export const executeSelectorCondition = {
  actions: parseAbi([
    "function allowSelector(address target, bytes4 selector)",
    "function disallowSelector(address target, bytes4 selector)",
    "function allowNativeTransfers(address target)",
    "function disallowNativeTransfers(address target)",
  ]),
} as const;

// --- Aragon Factories / Registries ---

export const daoFactory = {
  actions: parseAbi([
    "function createDao((bytes metadata, address daoURI, string subdomain, (bool isGranted)[] grantees) daoSettings, (uint8[2] pluginSetupRef, address pluginSetup, bytes data) pluginSettings)",
  ]),
} as const;

export const daoRegistry = {
  actions: parseAbi(["function register(address dao, address creator, string subdomain)"]),
} as const;

export const pluginRepo = {
  actions: parseAbi([
    "function createVersion(uint8 release, address pluginSetup, bytes buildMetadata, bytes releaseMetadata)",
  ]),
} as const;

export const pluginRepoFactory = {
  actions: parseAbi([
    "function createPluginRepo(string subdomain, address initialOwner)",
    "function createPluginRepoWithFirstVersion(string subdomain, address pluginSetup, address maintainer, bytes releaseMetadata, bytes buildMetadata)",
  ]),
} as const;

export const pluginRepoRegistry = {
  actions: parseAbi(["function registerPluginRepo(string subdomain, address pluginRepo)"]),
} as const;

export const multisigSetup = {
  actions: parseAbi([
    "function prepareInstallation(address dao, bytes data) returns (address plugin, (address[] helpers, (uint8 operation, address where, address who, address condition, bytes32 permissionId)[] permissions) preparedSetupData)",
  ]),
} as const;

export const majorityVotingBase = {
  settings: parseAbi([
    "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
  ]),
} as const;
