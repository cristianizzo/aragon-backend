import { ExitQueue } from "generated";

ExitQueue.ExitQueued.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();

  // Find the lock by looking up across all escrow addresses for this tokenId
  // The ExitQueue contract is linked to a VotingEscrow, but we don't know which one
  // from the event alone. Use a composite key with the exitQueue address.
  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l) => l.chainId === chainId);
  if (lock) {
    context.Lock.set({
      ...lock,
      exitQueued: true,
      exitQueuedAt: event.block.timestamp,
      exitCancelled: false,
    });
  }
});

ExitQueue.ExitQueuedV2.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();

  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l) => l.chainId === chainId);
  if (lock) {
    context.Lock.set({
      ...lock,
      exitQueued: true,
      exitQueuedAt: event.block.timestamp,
      exitCancelled: false,
    });
  }
});

ExitQueue.ExitCancelled.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();

  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l) => l.chainId === chainId);
  if (lock) {
    context.Lock.set({
      ...lock,
      exitQueued: false,
      exitCancelled: true,
    });
  }
});

ExitQueue.MinLockSet.handler(async ({ event, context }) => {
  // Track minimum lock period changes — informational
});

ExitQueue.ExitFeePercentAdjusted.handler(async ({ event, context }) => {
  // Track fee adjustments — informational
});
