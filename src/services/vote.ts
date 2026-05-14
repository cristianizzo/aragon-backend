import type { EvmOnEventContext as HandlerContext } from "envio";
import { PluginActivityType, PluginInterfaceType } from "../enums";
import { daoVoterId, pluginId, pluginMemberId, proposalId, voteId } from "../utils/ids";
import { trackPluginActivity } from "../utils/metrics";
import { addMember } from "./member";

/**
 * Vote lifecycle service — owns every DB write for the `Vote` entity plus
 * the related counter bumps on `Proposal` and `Dao`.
 *
 * Handlers across Multisig (`Approved` — yes-only, membership weight),
 * TokenVoting (`VoteCast` — yes/no/abstain, token weight), and LockToVote
 * (`LockToVoteVoteCast` — same as TokenVoting, plus a `VoteCleared` inverse)
 * delegate here so the create / delete flows live in one place.
 */

interface RecordVoteArgs {
  chainId: number;
  pluginAddress: string;
  plugin_id: string;
  dao_id: string;
  daoAddress: string;
  proposalIndex: string;
  memberAddress: string;
  voteOption: number;
  // Undefined for membership-based plugins (Multisig) where every approval
  // weights equally. Token-weighted plugins always supply a value.
  votingPower?: bigint;
  // Voting-token contract address — denormed onto the Vote row for
  // one-hop joins. Null for membership-based plugins.
  tokenAddress?: string;
  blockNumber: number;
  // Tx position inside the block + log position inside the tx — stamped on
  // the Vote row for stable cross-block ordering.
  transactionIndex?: number;
  logIndex?: number;
  blockTimestamp: number;
  transactionHash: string;
}

export async function recordVote(context: HandlerContext, args: RecordVoteArgs): Promise<void> {
  const proposal_id = proposalId(args.chainId, args.pluginAddress, args.proposalIndex);
  const vote_id = voteId(args.chainId, args.pluginAddress, args.proposalIndex, args.memberAddress);

  // Detect re-vote: same voter on the same proposal already wrote a row.
  // TokenVoting/LockToVote allow changing your vote before close — Multisig
  // cannot (each member can approve at most once on-chain). For replacements
  // we keep `voteCount` flat (no double-count) and stash the prior tx so
  // consumers can render "you previously voted X". The per-option tally
  // also rebalances: subtract the old option's contribution before adding
  // the new one.
  const existingVote = await context.Vote.get(vote_id);
  const isReplacement = existingVote !== undefined;

  context.Vote.set({
    id: vote_id,
    chainId: args.chainId,
    plugin_id: args.plugin_id,
    proposal_id,
    blockNumber: args.blockNumber,
    transactionIndex: args.transactionIndex,
    logIndex: args.logIndex,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    daoAddress: args.daoAddress,
    pluginAddress: args.pluginAddress,
    tokenAddress: args.tokenAddress,
    proposalIndex: args.proposalIndex,
    memberAddress: args.memberAddress,
    voteOption: args.voteOption,
    votingPower: args.votingPower,
    replacedTransactionHash: isReplacement ? existingVote.transactionHash : undefined,
    // Re-voting clears any prior soft-clear marker.
    voteCleared: undefined,
  });

  const proposal = await context.Proposal.get(proposal_id);
  if (proposal) {
    let votesByOption = proposal.votesByOption;
    if (isReplacement && existingVote.voteOption !== undefined && existingVote.voteOption !== null) {
      votesByOption = bumpVotesByOption(votesByOption, existingVote.voteOption, existingVote.votingPower ?? 0n, -1);
    }
    votesByOption = bumpVotesByOption(votesByOption, args.voteOption, args.votingPower ?? 0n, +1);

    context.Proposal.set({
      ...proposal,
      voteCount: isReplacement ? proposal.voteCount : proposal.voteCount + 1,
      votesByOption,
    });
  }

  // Dao.voteCount = cumulative votes; bump on every vote (including
  // replacements — legacy counts each cast event regardless of whether it
  // overwrites a prior one for the same voter).
  // Dao.uniqueVoters = distinct addresses across all proposals; bump only
  // the first time we see this voter inside this DAO. The DaoVoter row
  // serves as the dedup marker — its presence means we've already counted.
  const dao = await context.Dao.get(args.dao_id);
  if (dao) {
    const voterKey = daoVoterId(args.chainId, args.daoAddress, args.memberAddress);
    const seen = await context.DaoVoter.get(voterKey);
    const uniqueVotersDelta = seen ? 0 : 1;
    if (!seen) {
      context.DaoVoter.set({
        id: voterKey,
        chainId: args.chainId,
        dao_id: args.dao_id,
        daoAddress: args.daoAddress,
        memberAddress: args.memberAddress,
        firstVotedAt: args.blockTimestamp,
        firstVoteTransactionHash: args.transactionHash,
      });
    }
    context.Dao.set({
      ...dao,
      voteCount: dao.voteCount + 1,
      uniqueVoters: dao.uniqueVoters + uniqueVotersDelta,
    });
  }

  await trackPluginActivity(context, {
    chainId: args.chainId,
    pluginId: args.plugin_id,
    pluginAddress: args.pluginAddress,
    memberAddress: args.memberAddress,
    daoAddress: args.daoAddress,
    blockNumber: args.blockNumber,
    type: PluginActivityType.Vote,
  });

  await addMember(context, { address: args.memberAddress, blockNumber: args.blockNumber });

  // Fallback PluginMember backfill for membership-based plugins.
  //
  // Aragon's `Multisig.initialize()` and `AddresslistVoting.initialize()`
  // emit `MembersAdded` in the same tx as `InstallationPrepared` /
  // `Applied`. Envio's dynamic `contractRegister` can miss those
  // same-block events from a just-registered contract, so the initial
  // member set never reaches us.
  //
  // Both contracts enforce "voter must be member" on-chain, so seeing a
  // vote (Approved for Multisig, VoteCast for AddresslistVoting) is
  // proof of membership — register here if missing. Active members are
  // backfilled correctly; passive members who never vote remain a known
  // gap (acceptable trade-off — Aragon doesn't expose a `getMembers()`
  // enumerator on either plugin so we can't backfill via RPC either).
  //
  // Admin path goes through `EXECUTE_PROPOSAL_PERMISSION` Granted on the
  // DAO contract (`Permission.ts`) — DAO contract same-block events ARE
  // captured by Envio, so Admin doesn't need this fallback.
  // TokenVoting / LockToVote / VE / Gauge use member-discovery paths that
  // fire user-initiated post-install — no same-block risk.
  const plugin = await context.Plugin.get(pluginId(args.chainId, args.pluginAddress));
  const isMembershipBased =
    plugin?.interfaceType === PluginInterfaceType.Multisig ||
    plugin?.interfaceType === PluginInterfaceType.AddresslistVoting;
  if (isMembershipBased) {
    const memberKey = pluginMemberId(args.chainId, args.pluginAddress, args.memberAddress);
    const existingMember = await context.PluginMember.get(memberKey);
    if (!existingMember) {
      context.PluginMember.set({
        id: memberKey,
        chainId: args.chainId,
        plugin_id: args.plugin_id,
        pluginAddress: args.pluginAddress,
        memberAddress: args.memberAddress,
        daoAddress: args.daoAddress,
      });
      const daoForMember = await context.Dao.get(args.dao_id);
      if (daoForMember) {
        context.Dao.set({ ...daoForMember, memberCount: daoForMember.memberCount + 1 });
      }
    }
  }
}

interface ClearVoteArgs {
  chainId: number;
  pluginAddress: string;
  proposalIndex: string;
  memberAddress: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
}

/**
 * LockToVote-only: voter pulls their lock-vote back before the proposal
 * closes. Mirrors legacy `Vote.voteCleared` — we KEEP the row and stamp
 * the clear-event metadata as a soft-delete so audit history survives.
 *
 * `Proposal.voteCount` decrements (the cleared vote no longer counts);
 * `votesByOption` rolls back the option's contribution. `Dao.voteCount`
 * is NOT decremented — it tracks cumulative voting activity (historical
 * record), not the current set of valid votes.
 */
export async function clearVote(context: HandlerContext, args: ClearVoteArgs): Promise<void> {
  const vote_id = voteId(args.chainId, args.pluginAddress, args.proposalIndex, args.memberAddress);
  const existingVote = await context.Vote.get(vote_id);
  if (!existingVote) return;

  context.Vote.set({
    ...existingVote,
    voteCleared: {
      status: true,
      transactionHash: args.transactionHash,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
    },
  });

  const proposal_id = proposalId(args.chainId, args.pluginAddress, args.proposalIndex);
  const proposal = await context.Proposal.get(proposal_id);
  if (proposal && proposal.voteCount > 0) {
    const votesByOption =
      existingVote.voteOption !== undefined && existingVote.voteOption !== null
        ? bumpVotesByOption(proposal.votesByOption, existingVote.voteOption, existingVote.votingPower ?? 0n, -1)
        : proposal.votesByOption;
    context.Proposal.set({ ...proposal, voteCount: proposal.voteCount - 1, votesByOption });
  }
}

/**
 * Pure update on the per-option tally blob. Shape:
 *   `{ "<voteOption>": { totalVotes: number, totalVotingPower: string } }`
 *
 * `totalVotingPower` is stored as a decimal string so the JSON column can
 * round-trip arbitrary BigInts. `delta` is +1 / -1 — `clearVote` and
 * vote-replacement are the only -1 callers. Counters are clamped at 0 as
 * a defensive guard against unexpected double-clears.
 */
function bumpVotesByOption(
  current: unknown,
  voteOption: number,
  votingPower: bigint,
  delta: 1 | -1,
): Record<string, { totalVotes: number; totalVotingPower: string }> {
  const base =
    current && typeof current === "object" && !Array.isArray(current)
      ? (current as Record<string, { totalVotes: number; totalVotingPower: string }>)
      : {};
  const key = String(voteOption);
  const prev = base[key] ?? { totalVotes: 0, totalVotingPower: "0" };
  const nextVotes = Math.max(prev.totalVotes + delta, 0);
  const prevPower = BigInt(prev.totalVotingPower);
  const nextPower = delta === 1 ? prevPower + votingPower : prevPower - votingPower;
  const clampedPower = nextPower < 0n ? 0n : nextPower;
  return { ...base, [key]: { totalVotes: nextVotes, totalVotingPower: clampedPower.toString() } };
}
