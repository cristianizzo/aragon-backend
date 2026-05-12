import * as abis from "../abis";

/**
 * Action-decoder registry: pairs each ABI slice with the contract name shown
 * to the user when an action matches it. The action decoder iterates this list
 * trying each ABI to decode incoming function data.
 *
 * All ABI shapes come from `src/abis/` — never inline a parseAbi here.
 */
export const KNOWN_ABIS: { name: string; abi: readonly unknown[] }[] = [
  // Standard tokens
  { name: "ERC20", abi: abis.erc20.standard },
  { name: "ERC20Mintable", abi: abis.erc20.mintable },
  { name: "ERC721", abi: abis.erc721.standard },
  { name: "ERC1155", abi: abis.erc1155.standard },

  // Aragon DAO
  { name: "DAO", abi: abis.dao.setMetadata },
  { name: "DAO", abi: abis.dao.execute },
  { name: "DAO", abi: abis.dao.permissions },
  { name: "DAO", abi: abis.dao.upgrade },
  { name: "DAO", abi: abis.dao.configuration },

  // Aragon Governance Plugins
  { name: "Multisig", abi: abis.multisig.members },
  { name: "Multisig", abi: abis.multisig.settings },
  { name: "TokenVoting", abi: abis.tokenVoting.settings },
  { name: "AddresslistVoting", abi: abis.addresslistVoting.members },
  { name: "AddresslistVoting", abi: abis.addresslistVoting.settings },
  { name: "GovernanceERC20", abi: abis.governanceErc20.delegation },
  { name: "GovernanceERC20", abi: abis.governanceErc20.mintable },
  { name: "MajorityVotingBase", abi: abis.majorityVotingBase.settings },

  // Plugin infrastructure
  { name: "PluginRepo", abi: abis.pluginRepo.actions },
  { name: "DAORegistry", abi: abis.daoRegistry.actions },
  { name: "PluginRepoRegistry", abi: abis.pluginRepoRegistry.actions },

  // Factories
  { name: "DAOFactory", abi: abis.daoFactory.actions },
  { name: "PluginRepoFactory", abi: abis.pluginRepoFactory.actions },
  { name: "MultisigSetup", abi: abis.multisigSetup.actions },

  // SPP / Gauge / VE / Capital / Selector
  { name: "StagedProposalProcessor", abi: abis.spp.settings },
  { name: "GaugeVoter", abi: abis.gauge.actions },
  { name: "VotingEscrow", abi: abis.votingEscrow.actions },
  { name: "CapitalDistributor", abi: abis.capitalDistributor.actions },
  { name: "ExecuteSelectorCondition", abi: abis.executeSelectorCondition.actions },
];

/** Action type classification based on function name */
export function classifyAction(functionName: string): string {
  const classifications: Record<string, string> = {
    transfer: "transfer",
    transferFrom: "transfer",
    safeTransferFrom: "transfer",
    safeBatchTransferFrom: "batchTransfer",
    approve: "approve",
    setApprovalForAll: "approve",
    mint: "mint",
    delegate: "delegate",
    delegateBySig: "delegate",

    setMetadata: "updateMetadata",
    execute: "execute",
    grant: "grantPermission",
    revoke: "revokePermission",
    grantWithCondition: "grantPermission",
    setDaoURI: "updateMetadata",
    setTrustedForwarder: "configuration",
    registerStandardCallback: "configuration",
    upgradeToAndCall: "upgrade",

    addAddresses: "addMembers",
    removeAddresses: "removeMembers",

    updateMultisigSettings: "updateSettings",
    updateVotingSettings: "updateSettings",
    updateStages: "updateSettings",

    createGauge: "createGauge",
    registerGauge: "createGauge",
    updateGaugeMetadata: "updateMetadata",
    activateGauge: "activateGauge",
    deactivateGauge: "deactivateGauge",

    deposit: "deposit",
    withdraw: "withdraw",
    undelegate: "undelegate",

    createCampaign: "createCampaign",
    pauseCampaign: "pauseCampaign",
    resumeCampaign: "resumeCampaign",
    endCampaign: "endCampaign",

    allowSelector: "allowSelector",
    disallowSelector: "disallowSelector",
    allowNativeTransfers: "allowNativeTransfers",
    disallowNativeTransfers: "disallowNativeTransfers",

    createVersion: "createVersion",
    register: "register",
    registerPluginRepo: "registerPluginRepo",
  };

  return classifications[functionName] || "contractInteraction";
}
