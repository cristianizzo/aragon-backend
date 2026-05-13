import { indexer } from "envio";
import { getAddress } from "viem";
import { addMember } from "../services/member";
import { adjustDelegateRelationship } from "../services/tokenMember";
import { lookupVeChainByEscrow } from "../services/veChain";
import { lockId, tokenDelegationId } from "../utils/ids";

indexer.onEvent(
  { contract: "VotingEscrow", event: "Deposit" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const escrowAddress = getAddress(event.srcAddress);
    const tokenId = event.params.tokenId.toString();
    const depositor = getAddress(event.params.depositor);

    const ve = await lookupVeChainByEscrow(context, { chainId, escrowAddress });

    context.Lock.set({
      id: lockId(chainId, escrowAddress, tokenId),
      chainId,
      escrowAddress,
      exitQueueAddress: ve?.exitQueueAddress ? getAddress(ve.exitQueueAddress) : undefined,
      nftAddress: ve?.nftLockAddress ? getAddress(ve.nftLockAddress) : undefined,
      tokenId,
      memberAddress: depositor,
      amount: event.params.value,
      epochStartAt: Number(event.params.startTs),
      totalLocked: event.params.newTotalLocked,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      isWithdrawn: false,
      withdrawnAt: undefined,
      exitQueued: false,
      exitQueuedAt: undefined,
      exitCancelled: false,
      lockExit: undefined,
      lockWithdraw: undefined,
    });

    await addMember(context, { address: depositor, blockNumber: event.block.number });
  },
);

indexer.onEvent(
  { contract: "VotingEscrow", event: "Withdraw" },
  async ({ event, context }) => {
    const id = lockId(event.chainId, event.srcAddress, event.params.tokenId.toString());
    const lock = await context.Lock.get(id);
    if (!lock) return;

    context.Lock.set({
      ...lock,
      isWithdrawn: true,
      withdrawnAt: event.block.timestamp,
      amount: 0n,
      lockWithdraw: {
        status: true,
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        amount: event.params.value.toString(),
        totalLocked: event.params.newTotalLocked.toString(),
        epochEndAt: Number(event.params.ts),
      },
    });

    await addMember(context, { address: lock.memberAddress, blockNumber: event.block.number });
  },
);

indexer.onEvent({ contract: "VotingEscrow", event: "MinDepositSet" }, async () => {
  // Placeholder — informational, no entity update needed yet.
});

indexer.onEvent(
  { contract: "VotingEscrow", event: "TokensDelegated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const escrowAddress = getAddress(event.srcAddress);
    const delegator = getAddress(event.params.sender);
    const delegatee = getAddress(event.params.delegatee);
    const tokenIds = event.params.tokenIds.map((t) => t.toString());

    context.TokenDelegation.set({
      id: tokenDelegationId(chainId, escrowAddress, delegator, delegatee),
      chainId,
      escrowAddress,
      delegator,
      delegatee,
      tokenIds,
      isDelegated: true,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    });

    await adjustDelegateRelationship(context, {
      chainId,
      tokenAddress: escrowAddress,
      delegate: delegatee,
      countDelta: 1,
      blockNumber: event.block.number,
      addTokenIds: tokenIds,
    });

    await Promise.all([
      addMember(context, { address: delegator, blockNumber: event.block.number }),
      addMember(context, { address: delegatee, blockNumber: event.block.number }),
    ]);
  },
);

// Lock NFT split. Original `_from` token retains `_splitAmount1`; a new
// token id `newTokenId` is minted carrying `_splitAmount2`. The new lock
// inherits owner + escrow from the original (the contract guarantees both
// halves are still held by the same address). Mirrors legacy
// `veGovernance.lockSplit`.
indexer.onEvent(
  { contract: "VotingEscrow", event: "Split" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const escrowAddress = getAddress(event.srcAddress);
    const fromTokenId = event.params._from.toString();
    const newTokenId = event.params.newTokenId.toString();

    const fromLock = await context.Lock.get(lockId(chainId, escrowAddress, fromTokenId));
    if (!fromLock) return;

    context.Lock.set({ ...fromLock, amount: event.params._splitAmount1 });

    context.Lock.set({
      id: lockId(chainId, escrowAddress, newTokenId),
      chainId,
      escrowAddress,
      exitQueueAddress: fromLock.exitQueueAddress,
      nftAddress: fromLock.nftAddress,
      tokenId: newTokenId,
      memberAddress: fromLock.memberAddress,
      amount: event.params._splitAmount2,
      epochStartAt: fromLock.epochStartAt,
      totalLocked: fromLock.totalLocked,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      isWithdrawn: false,
      withdrawnAt: undefined,
      exitQueued: false,
      exitQueuedAt: undefined,
      exitCancelled: false,
      lockExit: undefined,
      lockWithdraw: undefined,
    });
  },
);

// Lock NFT merge. `_from` is destroyed (marked withdrawn so historical
// queries still see the row); `_to` absorbs the combined `_newTotalAmount`.
// Mirrors legacy `veGovernance.lockMerge`.
indexer.onEvent(
  { contract: "VotingEscrow", event: "Merged" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const escrowAddress = getAddress(event.srcAddress);
    const fromTokenId = event.params._from.toString();
    const toTokenId = event.params._to.toString();

    const [fromLock, toLock] = await Promise.all([
      context.Lock.get(lockId(chainId, escrowAddress, fromTokenId)),
      context.Lock.get(lockId(chainId, escrowAddress, toTokenId)),
    ]);

    if (fromLock) {
      context.Lock.set({
        ...fromLock,
        amount: 0n,
        isWithdrawn: true,
        withdrawnAt: event.block.timestamp,
        lockWithdraw: {
          status: true,
          transactionHash: event.transaction.hash,
          blockNumber: event.block.number,
          amount: fromLock.amount.toString(),
        },
      });
    }
    if (toLock) {
      context.Lock.set({ ...toLock, amount: event.params._newTotalAmount });
    }
  },
);

indexer.onEvent(
  { contract: "VotingEscrow", event: "TokensUndelegated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const escrowAddress = getAddress(event.srcAddress);
    const delegator = getAddress(event.params.sender);
    const delegatee = getAddress(event.params.delegatee);
    const tokenIds = event.params.tokenIds.map((t) => t.toString());

    const id = tokenDelegationId(chainId, escrowAddress, delegator, delegatee);
    const existing = await context.TokenDelegation.get(id);
    if (existing) {
      context.TokenDelegation.set({
        ...existing,
        isDelegated: false,
        blockNumber: event.block.number,
        transactionHash: event.transaction.hash,
      });
    }

    await adjustDelegateRelationship(context, {
      chainId,
      tokenAddress: escrowAddress,
      delegate: delegatee,
      countDelta: -1,
      blockNumber: event.block.number,
      removeTokenIds: tokenIds,
    });

    await Promise.all([
      addMember(context, { address: delegator, blockNumber: event.block.number }),
      addMember(context, { address: delegatee, blockNumber: event.block.number }),
    ]);
  },
);
