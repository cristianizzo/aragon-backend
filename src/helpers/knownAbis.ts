import { parseAbi } from "viem";

/** Known Aragon + standard contract ABIs (non-view, non-pure functions only) */

export const KNOWN_ABIS: { name: string; abi: readonly any[] }[] = [
  // --- Standard tokens ---
  {
    name: "ERC20",
    abi: parseAbi([
      "function transfer(address to, uint256 amount) returns (bool)",
      "function transferFrom(address from, address to, uint256 amount) returns (bool)",
      "function approve(address spender, uint256 amount) returns (bool)",
    ]),
  },
  {
    name: "ERC20Mintable",
    abi: parseAbi(["function mint(address to, uint256 amount)"]),
  },
  {
    name: "ERC721",
    abi: parseAbi([
      "function safeTransferFrom(address from, address to, uint256 tokenId)",
      "function safeTransferFrom(address from, address to, uint256 tokenId, bytes data)",
      "function transferFrom(address from, address to, uint256 tokenId)",
      "function approve(address to, uint256 tokenId)",
      "function setApprovalForAll(address operator, bool approved)",
    ]),
  },
  {
    name: "ERC1155",
    abi: parseAbi([
      "function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes data)",
      "function safeBatchTransferFrom(address from, address to, uint256[] ids, uint256[] amounts, bytes data)",
      "function setApprovalForAll(address operator, bool approved)",
    ]),
  },

  // --- Aragon DAO ---
  {
    name: "DAO",
    abi: parseAbi([
      "function setMetadata(bytes metadata)",
      "function execute(bytes32 callId, (address to, uint256 value, bytes data)[] actions, uint256 allowFailureMap)",
      "function grant(address where, address who, bytes32 permissionId)",
      "function revoke(address where, address who, bytes32 permissionId)",
      "function grantWithCondition(address where, address who, bytes32 permissionId, address conditionOracle)",
      "function setDaoURI(string newDaoURI)",
      "function setTrustedForwarder(address newTrustedForwarder)",
      "function registerStandardCallback(bytes4 interfaceId, bytes4 callbackSelector, bytes4 magicNumber)",
      "function upgradeToAndCall(address newImplementation, bytes data)",
    ]),
  },

  // --- Aragon Governance Plugins ---
  {
    name: "Multisig",
    abi: parseAbi([
      "function addAddresses(address[] members)",
      "function removeAddresses(address[] members)",
      "function updateMultisigSettings((bool onlyListed, uint16 minApprovals) multisigSettings)",
    ]),
  },
  {
    name: "TokenVoting",
    abi: parseAbi([
      "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
    ]),
  },
  {
    name: "AddresslistVoting",
    abi: parseAbi([
      "function addAddresses(address[] members)",
      "function removeAddresses(address[] members)",
      "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
    ]),
  },
  {
    name: "GovernanceERC20",
    abi: parseAbi([
      "function mint(address to, uint256 amount)",
      "function delegate(address delegatee)",
      "function delegateBySig(address delegatee, uint256 nonce, uint256 expiry, uint8 v, bytes32 r, bytes32 s)",
    ]),
  },

  // --- Aragon Plugin Infrastructure ---
  {
    name: "PluginRepo",
    abi: parseAbi([
      "function createVersion(uint8 release, address pluginSetup, bytes buildMetadata, bytes releaseMetadata)",
    ]),
  },
  {
    name: "DAORegistry",
    abi: parseAbi(["function register(address dao, address creator, string subdomain)"]),
  },
  {
    name: "PluginRepoRegistry",
    abi: parseAbi(["function registerPluginRepo(string subdomain, address pluginRepo)"]),
  },

  // --- Aragon Factories (from original decoder) ---
  {
    name: "DAOFactory",
    abi: parseAbi([
      "function createDao((bytes metadata, address daoURI, string subdomain, (bool isGranted)[] grantees) daoSettings, (uint8[2] pluginSetupRef, address pluginSetup, bytes data) pluginSettings)",
    ]),
  },
  {
    name: "PluginRepoFactory",
    abi: parseAbi([
      "function createPluginRepo(string subdomain, address initialOwner)",
      "function createPluginRepoWithFirstVersion(string subdomain, address pluginSetup, address maintainer, bytes releaseMetadata, bytes buildMetadata)",
    ]),
  },
  {
    name: "MultisigSetup",
    abi: parseAbi([
      "function prepareInstallation(address dao, bytes data) returns (address plugin, (address[] helpers, (uint8 operation, address where, address who, address condition, bytes32 permissionId)[] permissions) preparedSetupData)",
    ]),
  },
  {
    name: "MajorityVotingBase",
    abi: parseAbi([
      "function updateVotingSettings((uint8 votingMode, uint32 supportThreshold, uint32 minParticipation, uint64 minDuration, uint256 minProposerVotingPower) votingSettings)",
    ]),
  },

  // --- Aragon SPP ---
  {
    name: "StagedProposalProcessor",
    abi: parseAbi([
      "function updateStages((uint64 maxAdvance, uint64 minAdvance, uint64 voteDuration, uint16 approvalThreshold, uint16 vetoThreshold, (address body, bool isManual)[] bodies)[] stages)",
    ]),
  },

  // --- Aragon Gauge Voting ---
  {
    name: "GaugeVoter",
    abi: parseAbi([
      "function createGauge(address gauge, string metadataURI)",
      "function registerGauge(address gauge, uint8 gaugeType, address creator, string metadataURI)",
      "function updateGaugeMetadata(address gauge, string metadataURI)",
      "function activateGauge(address gauge)",
      "function deactivateGauge(address gauge)",
    ]),
  },

  // --- Aragon VE / Lock ---
  {
    name: "VotingEscrow",
    abi: parseAbi([
      "function deposit(uint256 amount, uint256 duration)",
      "function withdraw(uint256 tokenId)",
      "function delegate(uint256 fromTokenId, uint256 toTokenId)",
      "function undelegate(uint256 fromTokenId, uint256 toTokenId)",
    ]),
  },

  // --- Capital Distributor ---
  {
    name: "CapitalDistributor",
    abi: parseAbi([
      "function createCampaign(address token, uint256 totalAmount, bytes32 merkleRoot, string metadataURI)",
      "function pauseCampaign(uint256 campaignId)",
      "function resumeCampaign(uint256 campaignId)",
      "function endCampaign(uint256 campaignId)",
    ]),
  },

  // --- Execute Selector Condition ---
  {
    name: "ExecuteSelectorCondition",
    abi: parseAbi([
      "function allowSelector(address target, bytes4 selector)",
      "function disallowSelector(address target, bytes4 selector)",
      "function allowNativeTransfers(address target)",
      "function disallowNativeTransfers(address target)",
    ]),
  },
];

/** Action type classification based on function name */
export function classifyAction(functionName: string): string {
  const classifications: Record<string, string> = {
    // Token operations
    transfer: "transfer",
    transferFrom: "transfer",
    safeTransferFrom: "transfer",
    safeBatchTransferFrom: "batchTransfer",
    approve: "approve",
    setApprovalForAll: "approve",
    mint: "mint",
    delegate: "delegate",
    delegateBySig: "delegate",

    // DAO operations
    setMetadata: "updateMetadata",
    execute: "execute",
    grant: "grantPermission",
    revoke: "revokePermission",
    grantWithCondition: "grantPermission",
    setDaoURI: "updateMetadata",
    setTrustedForwarder: "configuration",
    registerStandardCallback: "configuration",
    upgradeToAndCall: "upgrade",

    // Membership
    addAddresses: "addMembers",
    removeAddresses: "removeMembers",

    // Settings
    updateMultisigSettings: "updateSettings",
    updateVotingSettings: "updateSettings",
    updateStages: "updateSettings",

    // Gauge
    createGauge: "createGauge",
    registerGauge: "createGauge",
    updateGaugeMetadata: "updateMetadata",
    activateGauge: "activateGauge",
    deactivateGauge: "deactivateGauge",

    // VE
    deposit: "deposit",
    withdraw: "withdraw",
    undelegate: "undelegate",

    // Campaign
    createCampaign: "createCampaign",
    pauseCampaign: "pauseCampaign",
    resumeCampaign: "resumeCampaign",
    endCampaign: "endCampaign",

    // Selector condition
    allowSelector: "allowSelector",
    disallowSelector: "disallowSelector",
    allowNativeTransfers: "allowNativeTransfers",
    disallowNativeTransfers: "disallowNativeTransfers",

    // Plugin
    createVersion: "createVersion",
    register: "register",
    registerPluginRepo: "registerPluginRepo",
  };

  return classifications[functionName] || "contractInteraction";
}
