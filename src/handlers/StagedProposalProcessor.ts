import { indexer } from "envio";
import { getAddress } from "viem";
import { PluginInterfaceType } from "../enums";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { cancelProposal, createProposal, editProposal, executeProposal } from "../services/proposal";
import {
  applyProposalAdvanced,
  applyProposalResultReported,
  applyStagesUpdated,
  applySubProposalCreated,
} from "../services/sppStages";
import { pluginId } from "../utils/ids";

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "ProposalResultReported" },
  async ({ event, context }) =>
    applyProposalResultReported(context, {
      chainId: event.chainId,
      pluginAddress: event.srcAddress,
      proposalIndex: event.params.proposalId.toString(),
      stageIndex: Number(event.params.stageId),
      body: event.params.body,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "ProposalCanceled" },
  async ({ event, context }) =>
    cancelProposal(context, {
      chainId: event.chainId,
      pluginAddress: getAddress(event.srcAddress),
      proposalIndex: event.params.proposalId.toString(),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "ProposalEdited" },
  async ({ event, context }) =>
    editProposal(context, {
      chainId: event.chainId,
      pluginAddress: getAddress(event.srcAddress),
      proposalIndex: event.params.proposalId.toString(),
      metadata: event.params.metadata,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "ProposalAdvanced" },
  async ({ event, context }) =>
    applyProposalAdvanced(context, {
      chainId: event.chainId,
      pluginAddress: event.srcAddress,
      proposalIndex: event.params.proposalId.toString(),
      stageIndex: Number(event.params.stageId),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "SPPProposalCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

    if (plugin.interfaceType === PluginInterfaceType.Unknown) {
      context.Plugin.set({ ...plugin, interfaceType: PluginInterfaceType.Spp, isSupported: true });
    }

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
      snapshot: undefined,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "SPPProposalExecuted" },
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
  { contract: "StagedProposalProcessor", event: "SPPMetadataSet" },
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

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "StagesUpdated" },
  async ({ event, context }) =>
    applyStagesUpdated(context, {
      chainId: event.chainId,
      pluginAddress: event.srcAddress,
      stages: event.params.stages,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);

indexer.onEvent(
  { contract: "StagedProposalProcessor", event: "SubProposalCreated" },
  async ({ event, context }) =>
    applySubProposalCreated(context, {
      chainId: event.chainId,
      parentPluginAddress: event.srcAddress,
      parentProposalIndex: event.params.proposalId.toString(),
      body: event.params.body,
      bodyProposalIndex: event.params.bodyProposalId.toString(),
      stageIndex: Number(event.params.stageId),
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
);
