import { Multisig } from "generated";
import { VoteOption } from "../constants";
import { decodeProposalActions } from "../effects/decodeActions";
import { fetchProposalMetadata } from "../effects/ipfs";
import { eventId, pluginMemberId, proposalId as makeProposalId } from "../utils/ids";
import { extractIpfsCid, parseRawActions, safeJsonParse } from "../utils/metadata";
import { trackPluginActivity } from "../utils/metrics";

Multisig.MultisigSettingsUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (!plugin) return;

  // Update plugin interface type if still unknown
  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "multisig", isSupported: true });
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
    onlyListed: event.params.onlyListed,
    minApprovals: Number(event.params.minApprovals),
    votingMode: undefined,
    supportThreshold: undefined,
    minParticipation: undefined,
    minDuration: undefined,
    minProposerVotingPower: undefined,
    stages: undefined,
    policy: undefined,
  });
});

Multisig.MembersAdded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (!plugin) return;

  for (const member of event.params.members) {
    const memberId = pluginMemberId({ chainId, pluginAddress, memberAddress: member });
    context.PluginMember.set({
      id: memberId,
      chainId,
      plugin_id: plugin.id,
      pluginAddress,
      memberAddress: member,
      daoAddress: plugin.daoAddress,
    });
  }

  // Update DAO member count
  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({
      ...dao,
      memberCount: dao.memberCount + event.params.members.length,
    });
  }
});

Multisig.MembersRemoved.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (!plugin) return;

  for (const member of event.params.members) {
    const memberId = pluginMemberId({ chainId, pluginAddress, memberAddress: member });
    context.PluginMember.deleteUnsafe(memberId);
  }

  // Update DAO member count
  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({
      ...dao,
      memberCount: Math.max(0, dao.memberCount - event.params.members.length),
    });
  }
});

Multisig.MultisigProposalCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (!plugin) return;

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
    status: "Active",
    startDate: event.params.startDate,
    endDate: event.params.endDate,
    executed: false,
    executedAt: undefined,
    executedTxHash: undefined,
    voteCount: 0,
  });

  // Update DAO proposal count
  const dao = await context.Dao.get(plugin.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
    await trackPluginActivity(context, {
      chainId,
      pluginId: plugin.id,
      pluginAddress,
      memberAddress: event.params.creator,
      daoAddress: plugin.daoAddress,
      blockNumber: event.block.number,
      type: "proposal",
    });
  }
});

Multisig.MultisigProposalExecuted.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find proposal by pluginAddress + proposalIndex (we don't have creation txHash)
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);
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

Multisig.Approved.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
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
    memberAddress: event.params.approver,
    voteOption: VoteOption.Yes, // Multisig Approved = always Yes
    votingPower: undefined,
    replacedBy: undefined,
  });

  // Update vote count + DAO metrics
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
    memberAddress: event.params.approver,
    daoAddress: plugin.daoAddress,
    blockNumber: event.block.number,
    type: "vote",
  });
});
