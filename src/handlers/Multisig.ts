import { indexer } from "envio";
import { getAddress } from "viem";
import { VoteOption } from "../constants";
import { PluginInterfaceType } from "../enums";
import { addMember } from "../services/member";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { createProposal, executeProposal } from "../services/proposal";
import { recordVote } from "../services/vote";
import { pluginId, pluginMemberId, settingId } from "../utils/ids";

indexer.onEvent(
  { contract: "Multisig", event: "MultisigSettingsUpdated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    if (plugin.interfaceType === PluginInterfaceType.Unknown) {
      context.Plugin.set({ ...plugin, interfaceType: PluginInterfaceType.Multisig, isSupported: true });
    }

    context.PluginSetting.set({
      id: settingId(chainId, pluginAddress, event.transaction.hash),
      chainId,
      plugin_id,
      pluginAddress,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      onlyListed: event.params.onlyListed,
      minApprovals: Number(event.params.minApprovals),
      votingMode: undefined,
      supportThreshold: undefined,
      minParticipation: undefined,
      minApprovalRatio: undefined,
      minDuration: undefined,
      minProposerVotingPower: undefined,
      stages: undefined,
      policy: undefined,
      votingEscrow: undefined,
      inactiveAtBlockNumber: undefined,
    });
  },
);

indexer.onEvent(
  { contract: "Multisig", event: "MembersAdded" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    for (const rawMember of event.params.members) {
      const memberAddress = getAddress(rawMember);
      context.PluginMember.set({
        id: pluginMemberId(chainId, pluginAddress, memberAddress),
        chainId,
        plugin_id,
        pluginAddress,
        memberAddress,
        daoAddress: plugin.daoAddress,
      });
      await addMember(context, { address: memberAddress, blockNumber: event.block.number });
    }

    const dao = await context.Dao.get(plugin.dao_id);
    if (dao) {
      context.Dao.set({
        ...dao,
        memberCount: dao.memberCount + event.params.members.length,
      });
    }
  },
);

indexer.onEvent(
  { contract: "Multisig", event: "MembersRemoved" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    for (const rawMember of event.params.members) {
      context.PluginMember.deleteUnsafe(pluginMemberId(chainId, pluginAddress, rawMember));
    }

    const dao = await context.Dao.get(plugin.dao_id);
    if (dao) {
      context.Dao.set({
        ...dao,
        memberCount: Math.max(0, dao.memberCount - event.params.members.length),
      });
    }
  },
);

indexer.onEvent(
  { contract: "Multisig", event: "MultisigProposalCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    // Snapshot member count at proposal creation — used to compute approval
    // ratios against the membership at the moment of proposal creation rather
    // than the (possibly mutated) current PluginMember count.
    const members = await context.PluginMember.getWhere({
      pluginAddress: { _eq: pluginAddress },
    });

    await createProposal(context, {
      chainId,
      pluginAddress,
      plugin_id,
      dao_id: plugin.dao_id,
      daoAddress: plugin.daoAddress,
      proposalIndex: event.params.proposalId.toString(),
      creatorAddress: getAddress(event.params.creator),
      metadata: event.params.metadata,
      actions: event.params.actions,
      allowFailureMap: event.params.allowFailureMap,
      startDate: event.params.startDate,
      endDate: event.params.endDate,
      snapshot: { membersCount: members.length },
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "Multisig", event: "MultisigProposalExecuted" },
  async ({ event, context }) =>
    executeProposal(context, {
      chainId: event.chainId,
      pluginAddress: getAddress(event.srcAddress),
      proposalIndex: event.params.proposalId.toString(),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "Multisig", event: "Approved" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    await recordVote(context, {
      chainId,
      pluginAddress,
      plugin_id,
      dao_id: plugin.dao_id,
      daoAddress: plugin.daoAddress,
      proposalIndex: event.params.proposalId.toString(),
      memberAddress: getAddress(event.params.approver),
      voteOption: VoteOption.Yes,
      votingPower: undefined,
      tokenAddress: undefined,
      blockNumber: event.block.number,
      transactionIndex: event.transaction.transactionIndex,
      logIndex: event.logIndex,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "Multisig", event: "MultisigMetadataSet" },
  async ({ event, context }) => {
    await applyPluginMetadata(context, {
      chainId: event.chainId,
      pluginAddress: event.srcAddress,
      metadata: event.params.metadata,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  },
);
