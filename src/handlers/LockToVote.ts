import { LockToVote } from "generated";
import { PluginStatus, ProposalStatus } from "../constants";
import { decodeProposalActions } from "../effects/decodeActions";
import { fetchProposalMetadata } from "../effects/ipfs";
import { eventId, proposalId as makeProposalId } from "../utils/ids";
import { extractIpfsCid, parseRawActions, safeJsonParse } from "../utils/metadata";
import { trackPluginActivity } from "../utils/metrics";

LockToVote.LockToVoteVoteCast.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  // Find proposal by pluginAddress + proposalIndex
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const vId = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });
  context.Vote.set({
    id: vId,
    chainId,
    plugin_id: plugin.id,
    proposal_id: proposal?.id ?? "",
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    daoAddress: plugin.daoAddress,
    pluginAddress,
    proposalIndex,
    memberAddress: event.params.voter,
    voteOption: Number(event.params.voteOption),
    votingPower: event.params.votingPower,
    replacedBy: undefined,
  });

  if (proposal) {
    context.Proposal.set({ ...proposal, voteCount: proposal.voteCount + 1 });
  }
  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, voteCount: dao.voteCount + 1 });
  }
  await trackPluginActivity(context, {
    chainId,
    pluginId: plugin.id,
    pluginAddress,
    memberAddress: event.params.voter,
    daoAddress: plugin.daoAddress,
    blockNumber: event.block.number,
    type: "vote",
  });
});

LockToVote.VoteCleared.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Vote is now append-only (eventId-based), so we can't delete by computed ID.
  // Find votes by pluginAddress+proposalIndex+voter and mark as replaced
  // For now, just decrement vote count on the proposal
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);
  if (proposal && proposal.voteCount > 0) {
    context.Proposal.set({ ...proposal, voteCount: proposal.voteCount - 1 });
  }
});

LockToVote.LockToVoteProposalCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "lockToVote", isSupported: true });
  }

  const cid = extractIpfsCid(event.params.metadata);
  const metadata = cid ? await context.effect(fetchProposalMetadata, cid) : null;

  // Extract and decode proposal actions
  const rawActions = parseRawActions(event.params.actions);

  const decodedActions =
    rawActions.length > 0
      ? await context.effect(decodeProposalActions, {
          actions: rawActions,
          chainId,
          daoAddress: plugin.daoAddress,
        })
      : null;

  const propId = makeProposalId({ chainId, txHash: event.transaction.hash, pluginAddress, proposalIndex });
  context.Proposal.set({
    id: propId,
    chainId,
    dao_id: plugin.dao_id,
    plugin_id: plugin.id,
    daoAddress: plugin.daoAddress,
    pluginAddress,
    proposalIndex,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    creatorAddress: event.params.creator,
    metadataUri: cid ? `ipfs://${cid}` : undefined,
    title: metadata?.title,
    summary: metadata?.summary,
    description: metadata?.description,
    resources: safeJsonParse(metadata?.resourcesJson),
    rawActions: rawActions.length > 0 ? rawActions : undefined,
    decodedActions: decodedActions ?? undefined,
    status: ProposalStatus.Active,
    startDate: event.params.startDate,
    endDate: event.params.endDate,
    executed: false,
    executedAt: undefined,
    executedTxHash: undefined,
    voteCount: 0,
  });

  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
  }
  await trackPluginActivity(context, {
    chainId,
    pluginId: plugin.id,
    pluginAddress,
    memberAddress: event.params.creator,
    daoAddress: plugin.daoAddress,
    blockNumber: event.block.number,
    type: "proposal",
  });
});

LockToVote.LockToVoteProposalExecuted.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find proposal by pluginAddress + proposalIndex
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);
  if (!proposal) return;

  context.Proposal.set({
    ...proposal,
    status: ProposalStatus.Executed,
    executed: true,
    executedAt: event.block.timestamp,
    executedTxHash: event.transaction.hash,
  });

  const dao = await context.Dao.get(proposal.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, proposalsExecuted: dao.proposalsExecuted + 1 });
  }
});

LockToVote.LockToVoteSettingsUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "lockToVote", isSupported: true });
  }

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const settingId = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });
  context.PluginSetting.set({
    id: settingId,
    chainId,
    plugin_id: plugin.id,
    pluginAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    onlyListed: undefined,
    minApprovals: undefined,
    votingMode: Number(event.params.votingMode),
    supportThreshold: BigInt(event.params.supportThresholdRatio),
    minParticipation: BigInt(event.params.minParticipationRatio),
    minDuration: BigInt(event.params.proposalDuration),
    minProposerVotingPower: event.params.minProposerVotingPower,
    stages: undefined,
    policy: undefined,
  });
});
