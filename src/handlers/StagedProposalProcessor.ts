import { StagedProposalProcessor } from "generated";
import { PluginStatus, ProposalStatus } from "../constants";
import { decodeProposalActions } from "../effects/decodeActions";
import { fetchDaoMetadata, fetchProposalMetadata } from "../effects/ipfs";
import { eventId, proposalId as makeProposalId } from "../utils/ids";
import { extractIpfsCid, parseRawActions, parseStages, safeJsonParse } from "../utils/metadata";
import { trackPluginActivity } from "../utils/metrics";

StagedProposalProcessor.ProposalResultReported.handler(async ({ event, context }) => {
  // Log proposal result reports from sub-bodies
  // Can be used for tracking multi-stage proposal progression
});

StagedProposalProcessor.ProposalCanceled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find proposal by pluginAddress + proposalIndex
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);
  if (!proposal) return;

  context.Proposal.set({
    ...proposal,
    status: ProposalStatus.Canceled,
  });
});

StagedProposalProcessor.ProposalEdited.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find proposal by pluginAddress + proposalIndex
  const proposals = await context.Proposal.getWhere({ pluginAddress: { _eq: pluginAddress }, proposalIndex: { _eq: proposalIndex } });
  const proposal = proposals.find((p: any) => p.chainId === chainId);
  if (!proposal) return;

  const cid = extractIpfsCid(event.params.metadata);
  const metadata = cid ? await context.effect(fetchProposalMetadata, cid) : null;

  context.Proposal.set({
    ...proposal,
    metadataUri: cid ? `ipfs://${cid}` : proposal.metadataUri,
    title: metadata?.title ?? proposal.title,
    summary: metadata?.summary ?? proposal.summary,
    description: metadata?.description ?? proposal.description,
    resources: safeJsonParse(metadata?.resourcesJson) ?? proposal.resources,
  });
});

StagedProposalProcessor.ProposalAdvanced.handler(async ({ event, context }) => {
  // Proposal advanced to next stage — no status change needed
  // Stage progression tracked via the event itself
});

StagedProposalProcessor.SPPProposalCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const proposalIndex = event.params.proposalId.toString();

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  // Update plugin type if unknown
  if (plugin.interfaceType === "unknown") {
    context.Plugin.set({ ...plugin, interfaceType: "spp", isSupported: true });
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

  // Update DAO proposal count
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

StagedProposalProcessor.SPPProposalExecuted.handler(async ({ event, context }) => {
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

// =============================================
// StagesUpdated — parse stage structure and pair sub-plugins
// =============================================
StagedProposalProcessor.StagesUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  const stages = parseStages(event.params.stages);

  // Build subPlugins array: [{stageIndex, addresses}]
  const subPlugins = stages.map((s: any) => ({
    stageIndex: s.stageIndex,
    addresses: s.bodies.map((b: any) => b.address),
  }));

  // Update SPP plugin with totalStages and subPlugins
  context.Plugin.set({
    ...plugin,
    totalStages: stages.length,
    subPlugins,
  });

  // Create PluginSetting with full stage config
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
    votingMode: undefined,
    supportThreshold: undefined,
    minParticipation: undefined,
    minDuration: undefined,
    minProposerVotingPower: undefined,
    stages,
    policy: undefined,
  });

  // Pair sub-plugins — update each body plugin with parentPlugin/stageIndex/isSubPlugin
  for (const stage of stages) {
    for (const body of stage.bodies) {
      const subPlugins = await context.Plugin.getWhere({ address: { _eq: body.address } });
      const subPlugin = subPlugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
      if (subPlugin) {
        context.Plugin.set({
          ...subPlugin,
          parentPlugin: pluginAddress,
          stageIndex: stage.stageIndex,
          isSubPlugin: true,
          isBody: subPlugin.interfaceType !== "spp",
          isProcess: true,
        });
      }
    }
  }
});

StagedProposalProcessor.SPPMetadataSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;

  // Find active plugin by address
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === PluginStatus.Installed);
  if (!plugin) return;

  const cid = extractIpfsCid(event.params.metadata);
  if (!cid) return;

  const metadata = await context.effect(fetchDaoMetadata, cid);

  // SPP MetadataSet updates the plugin's own metadata (not the DAO's)
  // Store as plugin subdomain/name for now
  if (metadata?.name) {
    context.Plugin.set({
      ...plugin,
      subdomain: metadata.name,
    });
  }
});
