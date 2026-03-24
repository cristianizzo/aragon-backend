import { GovernanceERC20 } from "generated";
import { ZERO_ADDRESS } from "../constants";

GovernanceERC20.DelegateChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress;

  const id = `${chainId}-${event.transaction.hash}-${event.logIndex}`;
  context.DelegateChangedEvent.set({
    id,
    chainId,
    tokenAddress,
    delegator: event.params.delegator,
    fromDelegate: event.params.fromDelegate,
    toDelegate: event.params.toDelegate,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

GovernanceERC20.DelegateVotesChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress;
  const delegate = event.params.delegate;

  if (delegate === ZERO_ADDRESS) return;

  // Log the event
  const eventId = `${chainId}-${event.transaction.hash}-${event.logIndex}`;
  context.DelegateVotesChangedEvent.set({
    id: eventId,
    chainId,
    tokenAddress,
    delegate,
    previousVotes: event.params.previousBalance,
    newVotes: event.params.newBalance,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  // Update or create TokenMember with current voting power
  const tokenMemberId = `${chainId}-${tokenAddress}-${delegate}`;
  const existing = await context.TokenMember.get(tokenMemberId);

  context.TokenMember.set({
    id: tokenMemberId,
    chainId,
    tokenAddress,
    memberAddress: delegate,
    votingPower: event.params.newBalance,
  });
});
