import { GovernanceERC20 } from "generated";
import { ZERO_ADDRESS } from "../constants";
import { eventId, tokenMemberId } from "../utils/ids";

GovernanceERC20.DelegateChanged.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });
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
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const evtId = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });
  context.DelegateVotesChangedEvent.set({
    id: evtId,
    chainId,
    tokenAddress,
    delegate,
    previousVotes: event.params.previousBalance,
    newVotes: event.params.newBalance,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  // Update or create TokenMember with current voting power
  const tmId = tokenMemberId({ chainId, tokenAddress, memberAddress: delegate });
  const existing = await context.TokenMember.get(tmId);

  context.TokenMember.set({
    id: tmId,
    chainId,
    tokenAddress,
    memberAddress: delegate,
    votingPower: event.params.newBalance,
  });
});
