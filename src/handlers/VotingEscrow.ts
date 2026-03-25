import { VotingEscrow } from "generated";
import { eventId, lockId as makeLockId } from "../utils/ids";

VotingEscrow.Deposit.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const nftTokenId = event.params.tokenId.toString();
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = makeLockId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex, escrowAddress, tokenId: nftTokenId });

  context.Lock.set({
    id,
    chainId,
    escrowAddress,
    tokenId: nftTokenId,
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
  const nftTokenId = event.params.tokenId.toString();
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  // Lock is now append-only — create a new Lock record for the withdrawal event
  const id = makeLockId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex, escrowAddress, tokenId: nftTokenId });

  // Find existing lock to get memberAddress
  const locks = await context.Lock.getWhere({ tokenId: { _eq: nftTokenId } });
  const existingLock = locks.find((l: any) => l.chainId === chainId && l.escrowAddress === escrowAddress && !l.isWithdrawn);

  context.Lock.set({
    id,
    chainId,
    escrowAddress,
    tokenId: nftTokenId,
    memberAddress: existingLock?.memberAddress ?? "",
    amount: 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isWithdrawn: true,
    withdrawnAt: event.block.timestamp,
    exitQueued: existingLock?.exitQueued ?? false,
    exitQueuedAt: existingLock?.exitQueuedAt,
    exitCancelled: existingLock?.exitCancelled ?? false,
  });
});

VotingEscrow.MinDepositSet.handler(async ({ event, context }) => {
  // Track minimum deposit changes — informational, no entity update needed
});

VotingEscrow.TokensDelegated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const escrowAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

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
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  // TokenDelegation is now append-only — create a new record for undelegation
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.TokenDelegation.set({
    id,
    chainId,
    escrowAddress,
    delegator: event.params.sender,
    delegatee: event.params.delegatee,
    tokenIds: event.params.tokenIds.map((t) => t.toString()),
    isDelegated: false,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});
