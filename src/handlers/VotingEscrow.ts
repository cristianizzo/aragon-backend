import { VotingEscrow } from "generated";

VotingEscrow.Deposit.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const tokenId = event.params.tokenId.toString();
  const lockId = `${chainId}-${escrowAddress}-${tokenId}`;

  context.Lock.set({
    id: lockId,
    chainId,
    escrowAddress,
    tokenId,
    memberAddress: event.params.depositor,
    amount: event.params.value,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isWithdrawn: false,
    withdrawnAt: undefined,
    exitQueued: false,
    exitQueuedAt: undefined,
    exitCancelled: false,
  });
});

VotingEscrow.Withdraw.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const tokenId = event.params.tokenId.toString();
  const lockId = `${chainId}-${escrowAddress}-${tokenId}`;

  const lock = await context.Lock.get(lockId);
  if (!lock) return;

  context.Lock.set({
    ...lock,
    isWithdrawn: true,
    withdrawnAt: event.block.timestamp,
    amount: 0n,
  });
});

VotingEscrow.MinDepositSet.handler(async ({ event, context }) => {
  // Track minimum deposit changes — informational, no entity update needed
});

VotingEscrow.TokensDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const id = `${chainId}-${escrowAddress}-${event.params.sender}-${event.params.delegatee}`;

  context.TokenDelegation.set({
    id,
    chainId,
    escrowAddress,
    delegator: event.params.sender,
    delegatee: event.params.delegatee,
    tokenIds: event.params.tokenIds.map((t) => t.toString()),
    isDelegated: true,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

VotingEscrow.TokensUndelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const id = `${chainId}-${escrowAddress}-${event.params.sender}-${event.params.delegatee}`;

  const existing = await context.TokenDelegation.get(id);
  if (existing) {
    context.TokenDelegation.set({
      ...existing,
      isDelegated: false,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    });
  }
});
