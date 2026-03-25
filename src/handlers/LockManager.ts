import { LockManager } from "generated";
import { lockToVoteMemberId } from "../utils/ids";

LockManager.BalanceLocked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const lockManagerAddress = event.srcAddress;
  const memberAddress = event.params.voter;
  const id = lockToVoteMemberId({ chainId, lockManagerAddress, memberAddress });

  const existing = await context.LockToVoteMember.get(id);
  const currentAmount = existing?.lockedAmount ?? 0n;

  context.LockToVoteMember.set({
    id,
    chainId,
    lockManagerAddress,
    memberAddress,
    lockedAmount: currentAmount + event.params.amount,
  });
});

LockManager.BalanceUnlocked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const lockManagerAddress = event.srcAddress;
  const memberAddress = event.params.voter;
  const id = lockToVoteMemberId({ chainId, lockManagerAddress, memberAddress });

  const existing = await context.LockToVoteMember.get(id);
  if (!existing) return;

  const newAmount = existing.lockedAmount - event.params.amount;
  context.LockToVoteMember.set({
    ...existing,
    lockedAmount: newAmount < 0n ? 0n : newAmount,
  });
});
