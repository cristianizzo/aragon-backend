import { indexer } from "envio";
import { getAddress } from "viem";
import { fetchEscrowSettings } from "../effects/escrowSettings";
import { fetchTokenTotalSupplyAtBlock } from "../effects/token";
import { PluginInterfaceType } from "../enums";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { createProposal, executeProposal } from "../services/proposal";
import { clearVote, recordVote } from "../services/vote";
import { pluginId, settingId } from "../utils/ids";

indexer.onEvent({ contract: "LockToVote", event: "LockToVoteVoteCast" }, async ({ event, context }) => {
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
    // LockToVote's underlying ERC-20 governance token (set at install).
    tokenAddress: plugin.tokenAddress ?? undefined,
    blockNumber: event.block.number,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});

indexer.onEvent({ contract: "LockToVote", event: "VoteCleared" }, async ({ event, context }) =>
  clearVote(context, {
    chainId: event.chainId,
    pluginAddress: getAddress(event.srcAddress),
    proposalIndex: event.params.proposalId.toString(),
    memberAddress: getAddress(event.params.voter),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  }),
);

indexer.onEvent({ contract: "LockToVote", event: "LockToVoteProposalCreated" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const plugin_id = pluginId(chainId, pluginAddress);

  const plugin = await context.Plugin.get(plugin_id);
  if (!plugin) return;

  if (plugin.interfaceType === PluginInterfaceType.Unknown) {
    context.Plugin.set({ ...plugin, interfaceType: PluginInterfaceType.LockToVote, isSupported: true });
  }

  // Token-weighted snapshot at proposal creation block. For LockToVote the
  // governance token is the underlying ERC-20 stored in `plugin.tokenAddress`
  // (set during PSP install). Locked-amount accounting lives on the
  // LockManager — captured separately if/when needed; for now we record the
  // underlying token's totalSupply as the denominator.
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
});

indexer.onEvent({ contract: "LockToVote", event: "LockToVoteProposalExecuted" }, async ({ event, context }) =>
  executeProposal(context, {
    chainId: event.chainId,
    pluginAddress: getAddress(event.srcAddress),
    proposalIndex: event.params.proposalId.toString(),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  }),
);

indexer.onEvent({ contract: "LockToVote", event: "LockToVoteSettingsUpdated" }, async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const plugin_id = pluginId(chainId, pluginAddress);

  const plugin = await context.Plugin.get(plugin_id);
  if (!plugin) return;

  if (plugin.interfaceType === PluginInterfaceType.Unknown) {
    context.Plugin.set({ ...plugin, interfaceType: PluginInterfaceType.LockToVote, isSupported: true });
  }

  // Fetch the VE escrow's full settings via RPC if this plugin has a VE
  // chain attached. Returns null if no escrow addresses are present
  // (non-VE LockToVote variants); the field stays undefined in that case.
  const ve = plugin.votingEscrow as
    | { escrowAddress?: string; exitQueueAddress?: string; curveAddress?: string }
    | undefined;
  const escrowSettings = ve
    ? await context.effect(fetchEscrowSettings, {
        chainId,
        escrowAddress: ve.escrowAddress ?? null,
        exitQueueAddress: ve.exitQueueAddress ?? null,
        curveAddress: ve.curveAddress ?? null,
      })
    : null;

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
    supportThreshold: BigInt(event.params.supportThresholdRatio),
    minParticipation: BigInt(event.params.minParticipationRatio),
    // LockToVote-specific extra knob: the absolute approval ratio (against
    // total locked) that a proposal must hit to pass. Distinct from
    // `supportThreshold` which is the YES-vs-NO ratio.
    minApprovalRatio: BigInt(event.params.minApprovalRatio),
    minDuration: BigInt(event.params.proposalDuration),
    minProposerVotingPower: event.params.minProposerVotingPower,
    stages: undefined,
    policy: undefined,
    votingEscrow: escrowSettings ?? undefined,
    inactiveAtBlockNumber: undefined,
  });
});

indexer.onEvent({ contract: "LockToVote", event: "LockToVoteMetadataSet" }, async ({ event, context }) => {
  await applyPluginMetadata(context, {
    chainId: event.chainId,
    pluginAddress: event.srcAddress,
    metadata: event.params.metadata,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
});
