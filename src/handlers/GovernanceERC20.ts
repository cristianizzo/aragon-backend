import { GovernanceERC20 } from "generated";
import { getAddress } from "viem";
import { ZERO_ADDRESS } from "../constants";
import { eventLogId, tokenMemberId } from "../ids";
import { addMember } from "../services/member";
import { addToken } from "../services/token";
import { adjustDelegateRelationship } from "../services/tokenMember";

// Both GovernanceERC20 events are emitted exclusively by ERC20Votes-style
// governance tokens, so any source we see them on is by definition a
// governance token. Backstops the wildcard ERC-20 Transfer handler — without
// this, a governance token whose Transfer event isn't seen in the indexed
// range (or which never transfers, just delegates) would never get a Token
// row. Mirrors legacy `GovernanceErc20Handler` ↔ `ProxyToken.saveAndGetToken`.
GovernanceERC20.DelegateChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = getAddress(event.srcAddress);
  const delegator = getAddress(event.params.delegator);
  const fromDelegate = getAddress(event.params.fromDelegate);
  const toDelegate = getAddress(event.params.toDelegate);

  context.DelegateChangedEvent.set({
    id: eventLogId(chainId, event.transaction.hash, event.logIndex),
    chainId,
    tokenAddress,
    delegator,
    fromDelegate,
    toDelegate,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  await addToken(context, {
    chainId,
    tokenAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isGovernance: true,
  });

  // Maintain `delegateReceivedCount`: a self-relegation (from==to) is a no-op.
  // Service handles ZERO_ADDRESS skip and clamping at 0.
  if (fromDelegate !== toDelegate) {
    await Promise.all([
      adjustDelegateRelationship(context, {
        chainId,
        tokenAddress,
        delegate: fromDelegate,
        countDelta: -1,
        blockNumber: event.block.number,
      }),
      adjustDelegateRelationship(context, {
        chainId,
        tokenAddress,
        delegate: toDelegate,
        countDelta: 1,
        blockNumber: event.block.number,
      }),
    ]);
  }

  // ZERO_ADDRESS guard inside addMember filters fromDelegate=0x0 (no prior
  // delegate) or toDelegate=0x0 (revoking).
  await Promise.all([
    addMember(context, { address: delegator, blockNumber: event.block.number }),
    addMember(context, { address: fromDelegate, blockNumber: event.block.number }),
    addMember(context, { address: toDelegate, blockNumber: event.block.number }),
  ]);
});

GovernanceERC20.DelegateVotesChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = getAddress(event.srcAddress);
  const delegate = getAddress(event.params.delegate);

  if (delegate === ZERO_ADDRESS) return;

  context.DelegateVotesChangedEvent.set({
    id: eventLogId(chainId, event.transaction.hash, event.logIndex),
    chainId,
    tokenAddress,
    delegate,
    previousVotes: event.params.previousBalance,
    newVotes: event.params.newBalance,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  await addToken(context, {
    chainId,
    tokenAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isGovernance: true,
  });

  // Preserve `tokenIds` / `delegateReceivedCount` if a DelegateChanged for
  // this delegate already wrote a row in the same batch. ERC20Votes never
  // populates `tokenIds` here (no per-NFT identity).
  const id = tokenMemberId(chainId, tokenAddress, delegate);
  const existing = await context.TokenMember.get(id);
  context.TokenMember.set({
    id,
    chainId,
    tokenAddress,
    memberAddress: delegate,
    votingPower: event.params.newBalance,
    lastVPBlockNumber: event.block.number,
    tokenIds: existing?.tokenIds ?? [],
    delegateReceivedCount: existing?.delegateReceivedCount ?? 0,
  });

  await addMember(context, { address: delegate, blockNumber: event.block.number });
});
