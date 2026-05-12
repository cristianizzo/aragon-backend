import { DAO, type HandlerContext } from "generated";
import { getAddress } from "viem";
import { NATIVE_AS_ERC20_CHAINS, ZERO_ADDRESS } from "../constants";
import { TransactionSide, TransactionType } from "../enums";
import { updateDaoAssets } from "../services/asset";
import { applyDaoMetadata, applyDaoUpgrade } from "../services/dao";
import { recordTransaction } from "../services/transaction";

/**
 * Handlers that mutate the `Dao` entity itself plus its native treasury.
 * Permission-domain events (`Granted` / `Revoked`) live in `Permission.ts`
 * even though they're emitted by the same DAO contract — splitting by the
 * entity each handler operates on, not by the event source.
 */

DAO.MetadataSet.handler(async ({ event, context }) =>
  applyDaoMetadata(context, {
    chainId: event.chainId,
    daoAddress: event.srcAddress,
    metadata: event.params.metadata,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  }),
);

DAO.Upgraded.handler(async ({ event, context }) =>
  applyDaoUpgrade(context, {
    chainId: event.chainId,
    daoAddress: event.srcAddress,
    implementationAddress: event.params.implementation,
    transactionHash: event.transaction.hash,
  }),
);

DAO.NativeTokenDeposited.handler(async ({ event, context }) => {
  if (NATIVE_AS_ERC20_CHAINS.has(event.chainId)) return;
  const amount = event.params.amount;
  if (amount === 0n) return;

  const { chainId } = event;
  const daoAddress = getAddress(event.srcAddress);
  const sender = getAddress(event.params.sender);

  recordTransaction(context, {
    chainId,
    daoAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    side: TransactionSide.Deposit,
    type: TransactionType.NativeToken,
    fromAddress: sender,
    toAddress: daoAddress,
    tokenAddress: ZERO_ADDRESS,
    value: amount,
  });

  await updateDaoAssets(context, {
    chainId,
    daoAddress,
    tokenAddress: ZERO_ADDRESS,
    side: TransactionSide.Deposit,
    amount,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  });
});

/**
 * Native withdraws live inside `execute()` calls — the `Executed` log carries
 * an array of `(to, value, data)` actions. Any action with non-zero `value`
 * transfers native out of the DAO. Multiple actions share one `logIndex` —
 * disambiguated via `actionIndex` in the Transaction id.
 *
 * V1 and V2 of the event differ only in trailing fields (`allowFailureMap` is
 * v1-only) — the `actions` array sits at the same position in both. Handlers
 * for both signatures funnel into this helper.
 */
async function recordNativeWithdraws(
  context: HandlerContext,
  args: {
    chainId: number;
    srcAddress: string;
    actions: ReadonlyArray<readonly [string, bigint, string]>;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
    transactionIndex?: number;
    logIndex: number;
  },
): Promise<void> {
  if (NATIVE_AS_ERC20_CHAINS.has(args.chainId)) return;

  const { chainId } = args;
  const daoAddress = getAddress(args.srcAddress);
  const txCommon = {
    chainId,
    daoAddress,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    transactionIndex: args.transactionIndex,
    logIndex: args.logIndex,
    side: TransactionSide.Withdraw,
    type: TransactionType.NativeToken,
    fromAddress: daoAddress,
    tokenAddress: ZERO_ADDRESS,
  };

  for (let actionIndex = 0; actionIndex < args.actions.length; actionIndex++) {
    const action = args.actions[actionIndex];
    if (!action) continue;
    const [to, value] = action;
    if (value === 0n) continue;

    recordTransaction(context, {
      ...txCommon,
      toAddress: getAddress(to),
      value,
      actionIndex,
    });

    await updateDaoAssets(context, {
      chainId,
      daoAddress,
      tokenAddress: ZERO_ADDRESS,
      side: TransactionSide.Withdraw,
      amount: value,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
    });
  }
}

DAO.Executed.handler(async ({ event, context }) =>
  recordNativeWithdraws(context, {
    chainId: event.chainId,
    srcAddress: event.srcAddress,
    actions: event.params.actions,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
  }),
);

DAO.ExecutedV2.handler(async ({ event, context }) =>
  recordNativeWithdraws(context, {
    chainId: event.chainId,
    srcAddress: event.srcAddress,
    actions: event.params.actions,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
  }),
);
