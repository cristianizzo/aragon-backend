import { ExitQueue } from "generated";
import { getAddress } from "viem";
import { addMember } from "../services/member";

ExitQueue.ExitQueued.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();
  const holder = getAddress(event.params.holder);
  const exitDateAt = Number(event.params.exitDate);

  // The ExitQueue contract is linked to a VotingEscrow but the event itself
  // doesn't carry the escrow address — we look up the Lock by tokenId
  // (chain-scoped) and patch the row in place.
  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l) => l.chainId === chainId);
  if (lock) {
    context.Lock.set({
      ...lock,
      exitQueued: true,
      exitQueuedAt: event.block.timestamp,
      exitCancelled: false,
      // Rich audit object mirroring legacy `Lock.lockExit`. `holder` is
      // the address that initiated the exit (may differ from the lock
      // owner when delegated).
      lockExit: {
        status: true,
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        exitDateAt,
        holder,
      },
    });
  }

  await addMember(context, { address: holder, blockNumber: event.block.number });
});

ExitQueue.ExitQueuedV2.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const tokenId = event.params.tokenId.toString();
  const holder = getAddress(event.params.holder);
  // V2 renamed `exitDate` → `queuedAt` and tightened the type. Same semantics.
  const exitDateAt = Number(event.params.queuedAt);

  const locks = await context.Lock.getWhere({ tokenId: { _eq: tokenId } });
  const lock = locks.find((l) => l.chainId === chainId);
  if (lock) {
    context.Lock.set({
      ...lock,
      exitQueued: true,
      exitQueuedAt: event.block.timestamp,
      exitCancelled: false,
      lockExit: {
        status: true,
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        exitDateAt,
        holder,
      },
    });
  }

  await addMember(context, { address: holder, blockNumber: event.block.number });
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
      // Clearing `lockExit` matches legacy `existingLock.lockExit = null`
      // on cancel so consumers don't see a stale exit countdown.
      lockExit: undefined,
    });
  }

  await addMember(context, { address: getAddress(event.params.holder), blockNumber: event.block.number });
});

ExitQueue.MinLockSet.handler(async () => {
  // Placeholder — informational, no entity update needed yet.
});

ExitQueue.ExitFeePercentAdjusted.handler(async () => {
  // Placeholder — informational, no entity update needed yet.
});
