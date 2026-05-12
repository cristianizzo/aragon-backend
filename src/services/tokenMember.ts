import type { HandlerContext } from "generated";
import { ZERO_ADDRESS } from "../constants";
import { tokenMemberId } from "../utils/ids";

/**
 * Adjust the `delegateReceivedCount` and `tokenIds` of a TokenMember row at
 * write-time. Used by both ERC-20 (`GovernanceERC20.DelegateChanged`) and
 * VE (`VotingEscrow.TokensDelegated/Undelegated`) flows; the only difference
 * is what `tokenAddress` keys the row:
 *   - ERC-20: the token contract itself; `tokenIds` is always omitted (no
 *     per-NFT identity in balance-based delegation).
 *   - VE: the escrow contract address; `tokenIds` carries the delegated
 *     lock-NFT ids.
 *
 * The function is idempotent on `tokenIds` add (deduped) and tolerant on
 * remove (missing ids are silently skipped). `delegateReceivedCount` is
 * clamped at 0 — a -1 against a missing or zero row is a no-op rather than
 * a negative count, which would imply we missed an earlier delegation.
 */
export async function adjustDelegateRelationship(
  context: HandlerContext,
  args: {
    chainId: number;
    tokenAddress: string;
    delegate: string;
    countDelta: number;
    blockNumber: number;
    addTokenIds?: readonly string[];
    removeTokenIds?: readonly string[];
  },
): Promise<void> {
  if (args.delegate === ZERO_ADDRESS) return;

  const id = tokenMemberId(args.chainId, args.tokenAddress, args.delegate);
  const existing = await context.TokenMember.get(id);

  const baseTokenIds = existing?.tokenIds ?? [];
  const removeSet = args.removeTokenIds?.length ? new Set(args.removeTokenIds) : null;
  const filtered = removeSet ? baseTokenIds.filter((t) => !removeSet.has(t)) : [...baseTokenIds];
  if (args.addTokenIds?.length) {
    const seen = new Set(filtered);
    for (const t of args.addTokenIds) {
      if (!seen.has(t)) {
        filtered.push(t);
        seen.add(t);
      }
    }
  }

  if (existing) {
    context.TokenMember.set({
      ...existing,
      delegateReceivedCount: Math.max(existing.delegateReceivedCount + args.countDelta, 0),
      tokenIds: filtered,
    });
    return;
  }

  context.TokenMember.set({
    id,
    chainId: args.chainId,
    tokenAddress: args.tokenAddress,
    memberAddress: args.delegate,
    votingPower: 0n,
    lastVPBlockNumber: args.blockNumber,
    tokenIds: filtered,
    delegateReceivedCount: Math.max(args.countDelta, 0),
  });
}
