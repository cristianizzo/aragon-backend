import { getAddress } from "viem";
import { GaugeVoteKind } from "../enums";

type Branded<T extends string> = string & { readonly __brand: T };

export type DaoId = Branded<"DaoId">;
export type PluginId = Branded<"PluginId">;
export type PluginRepoId = Branded<"PluginRepoId">;
export type TokenId = Branded<"TokenId">;
export type GaugeId = Branded<"GaugeId">;
export type ProposalId = Branded<"ProposalId">;
export type VoteId = Branded<"VoteId">;
export type SettingId = Branded<"SettingId">;
export type CampaignId = Branded<"CampaignId">;
export type MemberId = Branded<"MemberId">;
export type PluginMemberId = Branded<"PluginMemberId">;
export type TokenMemberId = Branded<"TokenMemberId">;
export type LockToVoteMemberId = Branded<"LockToVoteMemberId">;
export type LockId = Branded<"LockId">;
export type TokenDelegationId = Branded<"TokenDelegationId">;
export type GaugeVoteId = Branded<"GaugeVoteId">;
export type SelectorPermissionId = Branded<"SelectorPermissionId">;
export type NativeTransferPermissionId = Branded<"NativeTransferPermissionId">;
export type AssetId = Branded<"AssetId">;
export type TransactionId = Branded<"TransactionId">;
export type EventLogId = Branded<"EventLogId">;
export type PluginSetupLogId = Branded<"PluginSetupLogId">;
export type ActivityMetricId = Branded<"ActivityMetricId">;
export type PluginParentLinkId = Branded<"PluginParentLinkId">;
export type SubProposalLinkId = Branded<"SubProposalLinkId">;
export type DaoVoterId = Branded<"DaoVoterId">;
export type CampaignMerkleRootLogId = Branded<"CampaignMerkleRootLogId">;

const a = (addr: string) => getAddress(addr);

export const daoId = (chainId: number, dao: string): DaoId => `${chainId}-${a(dao)}` as DaoId;

export const pluginId = (chainId: number, plugin: string): PluginId => `${chainId}-${a(plugin)}` as PluginId;

export const pluginRepoId = (chainId: number, repo: string): PluginRepoId => `${chainId}-${a(repo)}` as PluginRepoId;

export const tokenId = (chainId: number, token: string): TokenId => `${chainId}-${a(token)}` as TokenId;

export const gaugeId = (chainId: number, gauge: string): GaugeId => `${chainId}-${a(gauge)}` as GaugeId;

export const proposalId = (chainId: number, plugin: string, proposalIndex: string | number | bigint): ProposalId =>
  `${chainId}-${a(plugin)}-${proposalIndex}` as ProposalId;

export const voteId = (
  chainId: number,
  plugin: string,
  proposalIndex: string | number | bigint,
  voter: string,
): VoteId => `${chainId}-${a(plugin)}-${proposalIndex}-${a(voter)}` as VoteId;

export const settingId = (chainId: number, plugin: string, txHash: string): SettingId =>
  `${chainId}-${a(plugin)}-${txHash}` as SettingId;

// (chainId, daoAddress, parent, stageIndex, child) — DAO-scoped because the
// same plugin contract address can be installed in multiple DAOs and the
// parent-child relationship is per-installation. stageIndex is part of the
// id so a child appearing at multiple stages under the same parent gets
// distinct rows.
export const pluginParentLinkId = (
  chainId: number,
  dao: string,
  parent: string,
  stageIndex: number,
  child: string,
): PluginParentLinkId => `${chainId}-${a(dao)}-${a(parent)}-${stageIndex}-${a(child)}` as PluginParentLinkId;

// (chainId, childPlugin, childProposalIndex) — keyed by the child so
// `createProposal` can look up "am I a sub of something?" by computing
// the same id from its own (pluginAddress, proposalIndex).
export const subProposalLinkId = (
  chainId: number,
  childPlugin: string,
  childProposalIndex: string | number | bigint,
): SubProposalLinkId => `${chainId}-${a(childPlugin)}-${childProposalIndex}` as SubProposalLinkId;

// (chainId, daoAddress, voter) — keyed by the (dao, voter) pair so the
// vote-recording service can look up "have I counted this voter yet?" with
// a single get. Bump `Dao.uniqueVoters` only when this row doesn't exist.
export const daoVoterId = (chainId: number, dao: string, voter: string): DaoVoterId =>
  `${chainId}-${a(dao)}-${a(voter)}` as DaoVoterId;

// Per-event audit log. (chainId, allocationStrategy, campaignId, txHash,
// logIndex) — txHash + logIndex make every row uniquely identifiable even
// when the same root is set twice in the same block.
export const campaignMerkleRootLogId = (
  chainId: number,
  allocationStrategy: string,
  campaignId: string | number | bigint,
  txHash: string,
  logIndex: number,
): CampaignMerkleRootLogId =>
  `${chainId}-${a(allocationStrategy)}-${campaignId}-${txHash}-${logIndex}` as CampaignMerkleRootLogId;

export const campaignId = (chainId: number, plugin: string, campaign: string | number | bigint): CampaignId =>
  `${chainId}-${a(plugin)}-${campaign}` as CampaignId;

// Global Member id — no chainId. Same wallet across chains = same Member row.
export const memberId = (member: string): MemberId => a(member) as MemberId;

export const pluginMemberId = (chainId: number, plugin: string, member: string): PluginMemberId =>
  `${chainId}-${a(plugin)}-${a(member)}` as PluginMemberId;

export const tokenMemberId = (chainId: number, token: string, holder: string): TokenMemberId =>
  `${chainId}-${a(token)}-${a(holder)}` as TokenMemberId;

export const lockToVoteMemberId = (chainId: number, lockManager: string, member: string): LockToVoteMemberId =>
  `${chainId}-${a(lockManager)}-${a(member)}` as LockToVoteMemberId;

export const lockId = (chainId: number, escrow: string, nftTokenId: string | number | bigint): LockId =>
  `${chainId}-${a(escrow)}-${nftTokenId}` as LockId;

export const tokenDelegationId = (
  chainId: number,
  escrow: string,
  sender: string,
  delegatee: string,
): TokenDelegationId => `${chainId}-${a(escrow)}-${a(sender)}-${a(delegatee)}` as TokenDelegationId;

export const gaugeVoteId = (
  chainId: number,
  gauge: string,
  voter: string,
  epoch: string | number | bigint,
  logIndex: number,
  kind: GaugeVoteKind = GaugeVoteKind.Vote,
): GaugeVoteId => {
  const tag = kind === GaugeVoteKind.Reset ? "-reset" : "";
  return `${chainId}-${a(gauge)}-${a(voter)}-${epoch}${tag}-${logIndex}` as GaugeVoteId;
};

/**
 * Canonical (gauge, voter, epoch) id — one row per voter's active vote in
 * an epoch. Used for the soft-clear pattern: `Voted` upserts, `Reset`
 * patches `resetVoteTransactionHash` on the same row instead of writing a
 * sibling. Mirrors legacy `VoteGauge` semantics.
 */
export const canonicalGaugeVoteId = (
  chainId: number,
  gauge: string,
  voter: string,
  epoch: string | number | bigint,
): GaugeVoteId => `${chainId}-${a(gauge)}-${a(voter)}-${epoch}` as GaugeVoteId;

export const gaugeMetricsId = (chainId: number, gauge: string, epoch: string | number | bigint): string =>
  `${chainId}-${a(gauge)}-${epoch}`;

/**
 * Canonical (campaign, claimer) id — one row per claimer per campaign.
 * `PayoutClaimed` upserts the row and appends to its `claims` Json array.
 * Mirrors legacy `CampaignReward.id`.
 */
export const campaignRewardId = (chainId: number, plugin: string, campaignId: string, claimer: string): string =>
  `${chainId}-${a(plugin)}-${campaignId}-${a(claimer)}`;

export const selectorPermissionId = (
  chainId: number,
  condition: string,
  selector: string,
  where: string,
): SelectorPermissionId => `${chainId}-${a(condition)}-${selector}-${a(where)}` as SelectorPermissionId;

export const nativeTransferPermissionId = (
  chainId: number,
  condition: string,
  where: string,
): NativeTransferPermissionId => `${chainId}-${a(condition)}-native-${a(where)}` as NativeTransferPermissionId;

export const assetId = (chainId: number, dao: string, token: string): AssetId =>
  `${chainId}-${a(dao)}-${a(token)}` as AssetId;

/**
 * Per-DAO perspective on a transfer log. `daoAddress` is included so a
 * single Transfer that touches two DAOs (DAO_A → DAO_B) yields two rows
 * without colliding on id. `actionIndex` is set when the transfer comes
 * from a batch action inside a `DAO.Executed` log (multiple withdrawals
 * sharing one logIndex).
 */
export const transactionId = (
  chainId: number,
  daoAddress: string,
  txHash: string,
  logIndex: number,
  actionIndex?: number,
): TransactionId => {
  const suffix = actionIndex !== undefined ? `-action${actionIndex}` : "";
  return `${chainId}-${a(daoAddress)}-${txHash}-${logIndex}${suffix}` as TransactionId;
};

/**
 * Generic event-keyed ID for any entity that records a single on-chain log
 * (DaoPermission, NativeTokenDeposited, MetadataChange, Granted/Revoked, etc.).
 */
export const eventLogId = (chainId: number, txHash: string, logIndex: number): EventLogId =>
  `${chainId}-${txHash}-${logIndex}` as EventLogId;

export const pluginSetupLogId = (chainId: number, txHash: string, logIndex: number): PluginSetupLogId =>
  `${chainId}-${txHash}-${logIndex}` as PluginSetupLogId;

export const activityMetricId = (chainId: number, plugin: string, member: string): ActivityMetricId =>
  `${chainId}-${a(plugin)}-${a(member)}` as ActivityMetricId;
