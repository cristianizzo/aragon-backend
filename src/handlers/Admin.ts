import { indexer } from "envio";
import { getAddress } from "viem";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { createProposal, executeProposal } from "../services/proposal";
import { pluginId } from "../utils/ids";

indexer.onEvent(
  { contract: "Admin", event: "AdminProposalCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin_id = pluginId(chainId, pluginAddress);

    const plugin = await context.Plugin.get(plugin_id);
    if (!plugin) return;

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
      // Admin = single-EOA executor. Snapshot is fixed at one member.
      snapshot: { membersCount: 1 },
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "Admin", event: "AdminProposalExecuted" },
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
  { contract: "Admin", event: "MembershipContractAnnounced" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const plugin = await context.Plugin.get(pluginId(chainId, pluginAddress));
    if (!plugin) return;

    const definingContract = getAddress(event.params.definingContract);
    context.Plugin.set({ ...plugin, tokenAddress: definingContract });
  },
);

indexer.onEvent(
  { contract: "Admin", event: "AdminMetadataSet" },
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
