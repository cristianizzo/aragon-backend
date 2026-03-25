import { ExitQueue } from "generated";
import { lockId as makeLockId } from "../utils/ids";

ExitQueue.ExitQueued.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  // Lock is append-only — find existing lock to get context, create new Lock record
  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l: any) => l.chainId === chainId && !l.isWithdrawn);

  const id = makeLockId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex, escrowAddress: lock?.escrowAddress ?? event.srcAddress, tokenId });

  context.Lock.set({
    id,
    chainId,
    escrowAddress: lock?.escrowAddress ?? event.srcAddress,
    tokenId,
    memberAddress: lock?.memberAddress ?? "",
    amount: lock?.amount ?? 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isWithdrawn: false,
    withdrawnAt: undefined,
    exitQueued: true,
    exitQueuedAt: event.block.timestamp,
    exitCancelled: false,
  });
});

ExitQueue.ExitQueuedV2.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l: any) => l.chainId === chainId && !l.isWithdrawn);

  const id = makeLockId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex, escrowAddress: lock?.escrowAddress ?? event.srcAddress, tokenId });

  context.Lock.set({
    id,
    chainId,
    escrowAddress: lock?.escrowAddress ?? event.srcAddress,
    tokenId,
    memberAddress: lock?.memberAddress ?? "",
    amount: lock?.amount ?? 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isWithdrawn: false,
    withdrawnAt: undefined,
    exitQueued: true,
    exitQueuedAt: event.block.timestamp,
    exitCancelled: false,
  });
});

ExitQueue.ExitCancelled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();
  const txIndex = Number(event.transaction.transactionIndex ?? 0);

  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l: any) => l.chainId === chainId && !l.isWithdrawn);

  const id = makeLockId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex, escrowAddress: lock?.escrowAddress ?? event.srcAddress, tokenId });

  context.Lock.set({
    id,
    chainId,
    escrowAddress: lock?.escrowAddress ?? event.srcAddress,
    tokenId,
    memberAddress: lock?.memberAddress ?? "",
    amount: lock?.amount ?? 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    isWithdrawn: false,
    withdrawnAt: undefined,
    exitQueued: false,
    exitQueuedAt: undefined,
    exitCancelled: true,
  });
});

ExitQueue.MinLockSet.handler(async ({ event, context }) => {
  // Track minimum lock period changes — informational
});

ExitQueue.ExitFeePercentAdjusted.handler(async ({ event, context }) => {
  // Track fee adjustments — informational
});
