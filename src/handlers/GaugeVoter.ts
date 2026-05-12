import type { HandlerContext } from "generated";
import { GaugeVoter } from "generated";
import { getAddress } from "viem";
import { fetchIpfsJson } from "../effects/ipfs";
import { GaugeStatus, GaugeVoteKind } from "../enums";
import { canonicalGaugeVoteId, gaugeId, gaugeMetricsId, gaugeVoteId } from "../ids";
import { addMember } from "../services/member";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { parseDaoMetadata } from "../utils/metadata";

/**
 * Pull the IPFS CID out of a plain string metadata URI (Gauge events use
 * `string metadataURI`, not the hex-encoded `bytes` form that
 * `utils/metadata.ts:extractIpfsCid` parses). Returns undefined when the
 * string doesn't look like an IPFS reference.
 */
function extractCidFromString(uri: string | undefined): string | undefined {
  if (!uri) return undefined;
  const trimmed = uri.replace(/\0/g, "");
  if (trimmed.startsWith("ipfs://")) return trimmed.slice(7);
  if (trimmed.startsWith("Qm") || trimmed.startsWith("bafy")) return trimmed;
  return undefined;
}

/**
 * Fetch + parse gauge metadata (name / description / avatar / links). The
 * payload shape matches the DAO metadata format so we reuse the same parser.
 * Returns null on missing CID / fetch failure / parse failure.
 */
async function loadGaugeMetadata(
  context: HandlerContext,
  metadataURI: string | undefined,
): Promise<{ name?: string; description?: string; links?: unknown[]; avatar?: string } | null> {
  const cid = extractCidFromString(metadataURI);
  if (!cid) return null;
  const raw = await context.effect(fetchIpfsJson, cid);
  return parseDaoMetadata(raw);
}

GaugeVoter.GaugeCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const creatorAddress = getAddress(event.params.creator);
  const metadata = await loadGaugeMetadata(context, event.params.metadataURI);

  context.Gauge.set({
    id: gaugeId(chainId, gaugeAddress),
    chainId,
    address: gaugeAddress,
    pluginAddress,
    creatorAddress,
    metadataUri: event.params.metadataURI || undefined,
    name: metadata?.name,
    description: metadata?.description,
    links: metadata?.links,
    avatar: metadata?.avatar,
    status: GaugeStatus.Active,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  await addMember(context, { address: creatorAddress, blockNumber: event.block.number });
});

GaugeVoter.GaugeActivated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: GaugeStatus.Active });
  }
});

GaugeVoter.GaugeDeactivated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: GaugeStatus.Deactivated });
  }
});

GaugeVoter.GaugeMetadataUpdated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (!gauge) return;

  const metadata = await loadGaugeMetadata(context, event.params.metadataURI);
  context.Gauge.set({
    ...gauge,
    metadataUri: event.params.metadataURI || gauge.metadataUri,
    name: metadata?.name ?? gauge.name,
    description: metadata?.description ?? gauge.description,
    links: metadata?.links ?? gauge.links,
    avatar: metadata?.avatar ?? gauge.avatar,
  });
});

GaugeVoter.Voted.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const voterAddress = getAddress(event.params.voter);
  const epoch = event.params.epoch.toString();
  const totalVotingPowerInGauge = event.params.totalVotingPowerInGauge;
  const totalVotingPowerInContract = event.params.totalVotingPowerInContract;

  // Canonical row per (gauge, voter, epoch). Voted overwrites — when the
  // same voter re-votes in the same epoch the row is updated, not appended.
  const canonical_id = canonicalGaugeVoteId(chainId, gaugeAddress, voterAddress, epoch);
  const existing = await context.GaugeVote.get(canonical_id);
  // Append-only audit row keyed by logIndex (mirrors legacy `LogGaugeVote`).
  // Lets consumers walk every Voted / Reset event in the order they fired.
  const audit_id = gaugeVoteId(chainId, gaugeAddress, voterAddress, epoch, event.logIndex, GaugeVoteKind.Vote);

  // First-active-vote semantics: a row that doesn't exist OR is currently
  // soft-cleared (`resetVoteTransactionHash` set) counts as fresh.
  const isFirstActiveVote = !existing || existing.resetVoteTransactionHash !== undefined;

  context.GaugeVote.set({
    id: canonical_id,
    chainId,
    pluginAddress,
    gaugeAddress,
    voterAddress,
    epoch,
    votingPower: event.params.votingPowerCastForGauge,
    // `persistentVote` defaults to false — the on-chain Voted event doesn't
    // expose persistence, legacy derives it from the plugin's
    // `enabledUpdatedVotingPowerHook` setting which we haven't wired through
    // yet. Once that PluginSetting field is populated, set this from the
    // active setting at vote time.
    persistentVote: false,
    resetVoteTransactionHash: undefined,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  // Audit copy — identical shape, distinct id so the canonical row can be
  // overwritten without losing history.
  context.GaugeVote.set({
    id: audit_id,
    chainId,
    pluginAddress,
    gaugeAddress,
    voterAddress,
    epoch,
    votingPower: event.params.votingPowerCastForGauge,
    persistentVote: false,
    resetVoteTransactionHash: undefined,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  await bumpGaugeMetrics(context, {
    chainId,
    pluginAddress,
    gaugeAddress,
    epoch,
    currentEpochVotingPower: totalVotingPowerInGauge,
    totalGaugeVotingPower: totalVotingPowerInContract,
    voterDelta: isFirstActiveVote ? 1 : 0,
    blockNumber: event.block.number,
  });

  await addMember(context, { address: voterAddress, blockNumber: event.block.number });
});

GaugeVoter.Reset.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const voterAddress = getAddress(event.params.voter);
  const epoch = event.params.epoch.toString();
  const totalVotingPowerInGauge = event.params.totalVotingPowerInGauge;
  const totalVotingPowerInContract = event.params.totalVotingPowerInContract;

  // Soft-clear: patch the canonical row in place — mirrors `Vote.voteCleared`.
  // Decrement the member count only when there was actually an active vote.
  const canonical_id = canonicalGaugeVoteId(chainId, gaugeAddress, voterAddress, epoch);
  const existing = await context.GaugeVote.get(canonical_id);
  const hadActiveVote = existing !== undefined && existing.resetVoteTransactionHash === undefined;
  if (existing) {
    context.GaugeVote.set({
      ...existing,
      votingPower: 0n,
      resetVoteTransactionHash: event.transaction.hash,
    });
  }

  // Append the Reset event row for audit. Distinct id (`-reset` suffix +
  // logIndex) so it doesn't collide with the canonical row above.
  context.GaugeVote.set({
    id: gaugeVoteId(chainId, gaugeAddress, voterAddress, epoch, event.logIndex, GaugeVoteKind.Reset),
    chainId,
    pluginAddress,
    gaugeAddress,
    voterAddress,
    epoch,
    votingPower: 0n,
    persistentVote: false,
    resetVoteTransactionHash: event.transaction.hash,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  await bumpGaugeMetrics(context, {
    chainId,
    pluginAddress,
    gaugeAddress,
    epoch,
    currentEpochVotingPower: totalVotingPowerInGauge,
    totalGaugeVotingPower: totalVotingPowerInContract,
    voterDelta: hadActiveVote ? -1 : 0,
    blockNumber: event.block.number,
  });

  await addMember(context, { address: voterAddress, blockNumber: event.block.number });
});

GaugeVoter.GaugeVoterMetadataSet.handler(async ({ event, context }) => {
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

/**
 * Upsert the GaugeMetrics row for (gauge, epoch). The voting-power totals
 * come straight from the event; `totalMemberVoteCount` deltas in by
 * +1 / -1 / 0 depending on whether this event flipped the voter's active
 * state. Clamped at 0 to be defensive against double-resets.
 */
async function bumpGaugeMetrics(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: string;
    gaugeAddress: string;
    epoch: string;
    currentEpochVotingPower: bigint;
    totalGaugeVotingPower: bigint;
    voterDelta: number;
    blockNumber: number;
  },
): Promise<void> {
  const id = gaugeMetricsId(args.chainId, args.gaugeAddress, args.epoch);
  const existing = await context.GaugeMetrics.get(id);
  context.GaugeMetrics.set({
    id,
    chainId: args.chainId,
    pluginAddress: args.pluginAddress,
    gaugeAddress: args.gaugeAddress,
    epoch: args.epoch,
    totalMemberVoteCount: Math.max((existing?.totalMemberVoteCount ?? 0) + args.voterDelta, 0),
    currentEpochVotingPower: args.currentEpochVotingPower,
    totalGaugeVotingPower: args.totalGaugeVotingPower,
    blockNumber: args.blockNumber,
  });
}
