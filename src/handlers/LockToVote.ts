import { LockToVote } from "generated";
import { safeJsonParse } from "../constants";
import { decodeProposalActions } from "../effects/decodeActions";
import { fetchProposalMetadata } from "../effects/ipfs";
import { extractIpfsCid } from "../utils/metadata";
import { trackPluginActivity } from "../utils/metrics";

LockToVote.LockToVoteVoteCast.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const pluginId = `${chainId}-${pluginAddress}`;
  const proposalIndex = event.params.proposalId.toString();
  const proposalId = `${chainId}-${pluginAddress}-${proposalIndex}`;

  const plugin = await context.Plugin.get(pluginId);
  if (!plugin) return;

  const voteId = `${chainId}-${pluginAddress}-${proposalIndex}-${event.params.voter}`;
  context.Vote.set({
    id: voteId,
    chainId,
    plugin_id: pluginId,
    proposal_id: proposalId,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    daoAddress: plugin.daoAddress,
    pluginAddress,
    proposalIndex,
    memberAddress: event.params.voter,
    voteOption: Number(event.params.voteOption),
    votingPower: event.params.votingPower,
  });

  const proposal = await context.Proposal.get(proposalId);
  if (proposal) {
    context.Proposal.set({ ...proposal, voteCount: proposal.voteCount + 1 });
  }
  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, voteCount: dao.voteCount + 1 });
  }
  await trackPluginActivity(context, {
    chainId,
    pluginId,
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
  const voteId = `${chainId}-${pluginAddress}-${proposalIndex}-${event.params.voter}`;

  // Delete the vote — the voter's lock was unlocked before proposal ended
  context.Vote.deleteUnsafe(voteId);

  // Decrement vote count
  const proposalId = `${chainId}-${pluginAddress}-${proposalIndex}`;
  const proposal = await context.Proposal.get(proposalId);
  if (proposal && proposal.voteCount > 0) {
    context.Proposal.set({ ...proposal, voteCount: proposal.voteCount - 1 });
  }
});

LockToVote.LockToVoteProposalCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const pluginId = `${chainId}-${pluginAddress}`;
  const proposalIndex = event.params.proposalId.toString();

  const plugin = await context.Plugin.get(pluginId);
  if (!plugin) return;

  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "lockToVote", isSupported: true });
  }

  const cid = extractIpfsCid(event.params.metadata);
  const metadata = cid ? await context.effect(fetchProposalMetadata, cid) : null;

  // Extract and decode proposal actions
  const rawActions = event.params.actions.map((a: any) => ({
    to: String(a[0] ?? a.to ?? ""),
    value: String(a[1] ?? a.value ?? "0"),
    data: String(a[2] ?? a.data ?? "0x"),
  }));

  const decodedActions =
    rawActions.length > 0
      ? await context.effect(decodeProposalActions, {
          actions: rawActions,
          chainId,
          daoAddress: plugin.daoAddress,
        })
      : null;

  const proposalId = `${chainId}-${pluginAddress}-${proposalIndex}`;
  context.Proposal.set({
    id: proposalId,
    chainId,
    dao_id: plugin.dao_id,
    plugin_id: pluginId,
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
    status: "Active",
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
    pluginId: pluginId,
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
  const proposalId = `${chainId}-${pluginAddress}-${proposalIndex}`;

  const proposal = await context.Proposal.get(proposalId);
  if (!proposal) return;

  context.Proposal.set({
    ...proposal,
    status: "Executed",
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
  const pluginId = `${chainId}-${pluginAddress}`;

  const plugin = await context.Plugin.get(pluginId);
  if (!plugin) return;

  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "lockToVote", isSupported: true });
  }

  const settingId = `${chainId}-${pluginAddress}-${event.transaction.hash}`;
  context.PluginSetting.set({
    id: settingId,
    chainId,
    plugin_id: pluginId,
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
