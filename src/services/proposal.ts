import type { HandlerContext } from "generated";
import { decodeProposalActions } from "../effects/decodeActions";
import { fetchIpfsJson } from "../effects/ipfs";
import { PluginActivityType, PluginInterfaceType, ProposalStatus } from "../enums";
import { toRawActions } from "../utils/actions";
import { proposalId, subProposalLinkId } from "../utils/ids";
import { extractIpfsCid, parseProposalMetadata } from "../utils/metadata";
import { trackPluginActivity } from "../utils/metrics";
import { addMember } from "./member";

// Local JSON.parse wrapper that swallows malformed input — used to lift
// the stringified effect payload back into structured Json.
const safeJsonParseUnknown = (raw: string): unknown => {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
};

/**
 * Proposal lifecycle service — owns every DB write for the `Proposal` entity.
 *
 * Handlers across all proposal-emitting plugins (Multisig, TokenVoting,
 * LockToVote, Admin, SPP) delegate here so the create / execute / cancel /
 * edit logic stays in one place. Per-plugin specifics that *don't* fit a
 * shared shape — Multisig's PluginMember-count snapshot, TokenVoting's
 * totalSupply snapshot, the LockToVote interfaceType flip on first
 * proposal — remain in the calling handler. Anything reused goes here.
 */

interface CreateProposalArgs {
  chainId: number;
  pluginAddress: string;
  plugin_id: string;
  dao_id: string;
  daoAddress: string;
  proposalIndex: string;
  creatorAddress: string;
  // Raw `bytes metadata` from the ProposalCreated event. CID extraction,
  // IPFS fetch, and parsing are owned here so every plugin gets identical
  // metadata handling.
  metadata: string;
  actions: ReadonlyArray<readonly [string, bigint, string]>;
  allowFailureMap?: bigint;
  startDate?: bigint;
  endDate?: bigint;
  // Plugin-specific snapshot blob — e.g. `{ membersCount }` for
  // Multisig/Admin, `{ totalSupply, tokenAddress }` for TokenVoting/LockToVote,
  // undefined for SPP (sub-bodies snapshot independently).
  snapshot?: unknown;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
}

export async function createProposal(context: HandlerContext, args: CreateProposalArgs): Promise<void> {
  const cid = extractIpfsCid(args.metadata);
  const raw = cid ? await context.effect(fetchIpfsJson, cid) : null;
  const metadata = parseProposalMetadata(raw);

  const rawActions = toRawActions(args.actions);
  // The effect returns a stringified JSON payload (see `effects/decodeActions.ts`
  // for why it isn't raw). Parse back into Json before persisting so the
  // `Proposal.decodedActions` column is queryable as structured data.
  const decodedActionsRaw =
    rawActions.length > 0
      ? await context.effect(decodeProposalActions, {
          actions: rawActions,
          chainId: args.chainId,
          daoAddress: args.daoAddress,
        })
      : null;
  const decodedActions = decodedActionsRaw ? safeJsonParseUnknown(decodedActionsRaw) : null;

  // Embed the plugin's active voting settings into the proposal snapshot so
  // historical proposals stay valid when settings are later updated. Mirrors
  // legacy `Proposal.settings`. The caller's plugin-specific snapshot blob
  // (membersCount / totalSupply / etc.) is preserved alongside.
  const activeSettings = await loadActiveSettings(context, args.pluginAddress);
  const snapshot = mergeSnapshot(args.snapshot, activeSettings);

  // SPP linkage: by the time a body's ProposalCreated fires, the parent SPP
  // has already emitted SubProposalCreated and `applySubProposalCreated`
  // has written a SubProposalLink keyed on (chainId, body, bodyProposalId).
  // Look it up by computing the same id from this proposal's identity.
  const link = await context.SubProposalLink.get(
    subProposalLinkId(args.chainId, args.pluginAddress, args.proposalIndex),
  );

  // Load Plugin once for both SPP stage counting and pluginSubdomain denorm.
  const plugin = await context.Plugin.get(args.plugin_id);

  // SPP parents: count the stages from PluginParentLink to set totalStages.
  // We only do this for SPP plugins (cheap heuristic — non-SPP plugins
  // skip the lookup). Sub-proposals never have totalStages.
  let totalStages: number | undefined;
  if (!link && plugin?.interfaceType === PluginInterfaceType.Spp) {
    const links = await context.PluginParentLink.getWhere({
      parentPluginAddress: { _eq: args.pluginAddress },
    });
    const sameDao = links.filter((l) => l.daoAddress === args.daoAddress);
    const distinctStages = new Set(sameDao.map((l) => l.stageIndex));
    totalStages = distinctStages.size > 0 ? distinctStages.size : undefined;
  }

  context.Proposal.set({
    id: proposalId(args.chainId, args.pluginAddress, args.proposalIndex),
    chainId: args.chainId,
    dao_id: args.dao_id,
    plugin_id: args.plugin_id,
    daoAddress: args.daoAddress,
    pluginAddress: args.pluginAddress,
    pluginSubdomain: plugin?.subdomain ?? undefined,
    proposalIndex: args.proposalIndex,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    creatorAddress: args.creatorAddress,
    metadataUri: cid ? `ipfs://${cid}` : undefined,
    title: metadata?.title,
    summary: metadata?.summary,
    description: metadata?.description,
    resources: metadata?.resources,
    media: metadata?.media,
    rawActions: rawActions.length > 0 ? rawActions : undefined,
    decodedActions: decodedActions ?? undefined,
    allowFailureMap: args.allowFailureMap,
    snapshot,
    status: ProposalStatus.Active,
    startDate: args.startDate,
    endDate: args.endDate,
    executed: false,
    executedAt: undefined,
    executedBlockNumber: undefined,
    executedTxHash: undefined,
    voteCount: 0,
    votesByOption: undefined,
    incrementalId: Number(args.proposalIndex),
    editedTxInfo: undefined,
    cancelTxInfo: undefined,
    isSubProposal: link !== undefined,
    parentProposalId: link?.parentProposalId,
    stageIndex: link?.stageIndex,
    totalStages,
    lastStageTransition: undefined,
    subProposals: undefined,
    stageExecutions: undefined,
    results: undefined,
  });

  const dao = await context.Dao.get(args.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
    await trackPluginActivity(context, {
      chainId: args.chainId,
      pluginId: args.plugin_id,
      pluginAddress: args.pluginAddress,
      memberAddress: args.creatorAddress,
      daoAddress: args.daoAddress,
      blockNumber: args.blockNumber,
      type: PluginActivityType.Proposal,
    });
  }

  await addMember(context, { address: args.creatorAddress, blockNumber: args.blockNumber });
}

interface ExecuteProposalArgs {
  chainId: number;
  pluginAddress: string;
  proposalIndex: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
}

export async function executeProposal(context: HandlerContext, args: ExecuteProposalArgs): Promise<void> {
  const id = proposalId(args.chainId, args.pluginAddress, args.proposalIndex);
  const proposal = await context.Proposal.get(id);
  if (!proposal) return;

  context.Proposal.set({
    ...proposal,
    status: ProposalStatus.Executed,
    executed: true,
    executedAt: args.blockTimestamp,
    executedBlockNumber: args.blockNumber,
    executedTxHash: args.transactionHash,
  });

  const dao = await context.Dao.get(proposal.dao_id);
  if (dao) {
    context.Dao.set({ ...dao, proposalsExecuted: dao.proposalsExecuted + 1 });
  }
}

interface CancelProposalArgs {
  chainId: number;
  pluginAddress: string;
  proposalIndex: string;
  // Optional audit info — when provided, stamped onto `Proposal.cancelTxInfo`
  // so consumers can show "cancelled at block N in tx 0x…" without joining
  // back to logs. SPP's earlier `ProposalCanceled` callers may omit it.
  blockNumber?: number;
  blockTimestamp?: number;
  transactionHash?: string;
}

export async function cancelProposal(context: HandlerContext, args: CancelProposalArgs): Promise<void> {
  const id = proposalId(args.chainId, args.pluginAddress, args.proposalIndex);
  const proposal = await context.Proposal.get(id);
  if (!proposal) return;

  const cancelTxInfo = args.transactionHash
    ? { transactionHash: args.transactionHash, blockNumber: args.blockNumber, blockTimestamp: args.blockTimestamp }
    : proposal.cancelTxInfo;

  context.Proposal.set({ ...proposal, status: ProposalStatus.Canceled, cancelTxInfo });
}

interface EditProposalArgs {
  chainId: number;
  pluginAddress: string;
  proposalIndex: string;
  metadata: string;
  // Same rationale as `cancelProposal` — stamped onto `editedTxInfo`.
  blockNumber?: number;
  blockTimestamp?: number;
  transactionHash?: string;
}

export async function editProposal(context: HandlerContext, args: EditProposalArgs): Promise<void> {
  const id = proposalId(args.chainId, args.pluginAddress, args.proposalIndex);
  const proposal = await context.Proposal.get(id);
  if (!proposal) return;

  const cid = extractIpfsCid(args.metadata);
  const raw = cid ? await context.effect(fetchIpfsJson, cid) : null;
  const metadata = parseProposalMetadata(raw);

  const editedTxInfo = args.transactionHash
    ? { transactionHash: args.transactionHash, blockNumber: args.blockNumber, blockTimestamp: args.blockTimestamp }
    : proposal.editedTxInfo;

  context.Proposal.set({
    ...proposal,
    metadataUri: cid ? `ipfs://${cid}` : proposal.metadataUri,
    title: metadata?.title ?? proposal.title,
    summary: metadata?.summary ?? proposal.summary,
    description: metadata?.description ?? proposal.description,
    resources: metadata?.resources ?? proposal.resources,
    media: metadata?.media ?? proposal.media,
    editedTxInfo,
  });
}

/**
 * Find the active `PluginSetting` for a plugin: highest blockNumber row
 * where `inactiveAtBlockNumber` is null. Returns undefined if the plugin
 * has no settings yet (proposal created before any settings event fired).
 */
async function loadActiveSettings(context: HandlerContext, pluginAddress: string) {
  const all = await context.PluginSetting.getWhere({ pluginAddress: { _eq: pluginAddress } });
  const active = all.filter((s) => s.inactiveAtBlockNumber === undefined);
  if (active.length === 0) return undefined;
  return active.reduce((latest, current) => (current.blockNumber > latest.blockNumber ? current : latest));
}

/**
 * Pure shape extractor — strips the row's identity columns and serializes
 * BigInts to strings so the result round-trips cleanly through `Json`.
 */
function settingsToSnapshot(s: NonNullable<Awaited<ReturnType<typeof loadActiveSettings>>>) {
  return {
    onlyListed: s.onlyListed,
    minApprovals: s.minApprovals,
    votingMode: s.votingMode,
    supportThreshold: s.supportThreshold?.toString(),
    minParticipation: s.minParticipation?.toString(),
    minDuration: s.minDuration?.toString(),
    minProposerVotingPower: s.minProposerVotingPower?.toString(),
    minApprovalRatio: s.minApprovalRatio?.toString(),
    stages: s.stages,
    policy: s.policy,
  };
}

function mergeSnapshot(caller: unknown, settings: Awaited<ReturnType<typeof loadActiveSettings>>): unknown {
  const settingsBlob = settings ? settingsToSnapshot(settings) : undefined;
  if (!caller && !settingsBlob) return undefined;
  if (!caller) return { settings: settingsBlob };
  if (!settingsBlob) return caller;
  // Caller-provided snapshot is preserved alongside `settings` — never
  // overwritten, since the caller's blob carries plugin-specific data
  // (membersCount / totalSupply) that doesn't belong inside settings.
  return { ...(caller as object), settings: settingsBlob };
}
