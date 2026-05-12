import { LockManager } from "generated";
import { getAddress } from "viem";
import { lockToVoteMemberId } from "../ids";
import { addMember } from "../services/member";

LockManager.BalanceLocked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const lockManagerAddress = getAddress(event.srcAddress);
  const memberAddress = getAddress(event.params.voter);
  const id = lockToVoteMemberId(chainId, lockManagerAddress, memberAddress);

  const existing = await context.LockToVoteMember.get(id);
  const currentAmount = existing?.lockedAmount ?? 0n;

  context.LockToVoteMember.set({
    id,
    chainId,
    lockManagerAddress,
    memberAddress,
    lockedAmount: currentAmount + event.params.amount,
  });

  await addMember(context, { address: memberAddress, blockNumber: event.block.number });
});

LockManager.BalanceUnlocked.handler(async ({ event, context }) => {
  const memberAddress = getAddress(event.params.voter);
  const id = lockToVoteMemberId(event.chainId, event.srcAddress, memberAddress);
  const existing = await context.LockToVoteMember.get(id);
  if (!existing) return;

  const newAmount = existing.lockedAmount - event.params.amount;
  context.LockToVoteMember.set({
    ...existing,
    lockedAmount: newAmount < 0n ? 0n : newAmount,
  });

  await addMember(context, { address: memberAddress, blockNumber: event.block.number });
});
