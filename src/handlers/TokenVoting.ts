import { indexer } from "envio";
import { getAddress } from "viem";
import { fetchTokenTotalSupplyAtBlock } from "../effects/token";
import { PluginInterfaceType } from "../enums";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { createProposal, executeProposal } from "../services/proposal";
import { recordVote } from "../services/vote";
import { pluginId, settingId } from "../utils/ids";

indexer.onEvent(
  { contract: "TokenVoting", event: "VotingSettingsUpdated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    if (plugin.interfaceType === PluginInterfaceType.Unknown) {
      context.Plugin.set({ ...plugin, interfaceType: PluginInterfaceType.TokenVoting, isSupported: true });
    }

    context.PluginSetting.set({
      id: settingId(chainId, pluginAddress, event.transaction.hash),
      chainId,
      plugin_id,
      pluginAddress,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      onlyListed: undefined,
      minApprovals: undefined,
      votingMode: Number(event.params.votingMode),
      supportThreshold: BigInt(event.params.supportThreshold),
      minParticipation: BigInt(event.params.minParticipation),
      minApprovalRatio: undefined,
      minDuration: BigInt(event.params.minDuration),
      minProposerVotingPower: event.params.minProposerVotingPower,
      stages: undefined,
      policy: undefined,
      votingEscrow: undefined,
      inactiveAtBlockNumber: undefined,
    });
  },
);

indexer.onEvent(
  { contract: "TokenVoting", event: "TokenVotingProposalCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    const totalSupply = plugin.tokenAddress
      ? await context.effect(fetchTokenTotalSupplyAtBlock, {
          tokenAddress: plugin.tokenAddress,
          chainId,
          blockNumber: event.block.number,
        })
      : null;
    const snapshot = totalSupply ? { totalSupply, tokenAddress: plugin.tokenAddress } : undefined;

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
      snapshot,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "TokenVoting", event: "TokenVotingProposalExecuted" },
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
  { contract: "TokenVoting", event: "VoteCast" },
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
      memberAddress: getAddress(event.params.voter),
      voteOption: Number(event.params.voteOption),
      votingPower: event.params.votingPower,
      tokenAddress: plugin.tokenAddress ?? undefined,
      blockNumber: event.block.number,
      transactionIndex: event.transaction.transactionIndex,
      logIndex: event.logIndex,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "TokenVoting", event: "TokenVotingMetadataSet" },
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
