import { indexer } from "envio";
import { getAddress } from "viem";
import { TransactionSide, TransactionType } from "../enums";
import { updateDaoAssets } from "../services/asset";
import { addToken } from "../services/token";
import { recordTransaction } from "../services/transaction";
import { getDaoSet } from "../utils/daoRegistry";

// Wildcard subscription: every ERC-20 `Transfer` on every contract on every
// configured chain hits this handler. The DAO-membership check filters out
// the 99.99% of events that don't touch a DAO via the in-memory address
// registry (`getDaoSet`) — no per-event `context.Dao.get()` round-trip.
//
// When a transfer goes from one DAO to another (rare but valid), TWO rows
// are written — one withdraw perspective for the sender, one deposit
// perspective for the receiver — disambiguated via `daoAddress` in the
// transaction id.
indexer.onEvent({ contract: "ERC20", event: "Transfer", wildcard: true }, async ({ event, context }) => {
  const value = event.params.value;
  if (value === 0n) return;

  const { chainId } = event;
  const fromAddress = getAddress(event.params.from);
  const toAddress = getAddress(event.params.to);

  const daos = getDaoSet(chainId);
  const fromDao = daos.has(fromAddress);
  const toDao = daos.has(toAddress);
  if (!fromDao && !toDao) return;

  const tokenAddress = getAddress(event.srcAddress);
  const txCommon = {
    chainId,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    type: TransactionType.Erc20,
    fromAddress,
    toAddress,
    tokenAddress,
    value,
  };
  const assetCommon = {
    chainId,
    tokenAddress,
    amount: value,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  };

  // Run addToken + per-side asset updates in parallel. addToken's first-
  // sight cost (RPC + DaoPermission lookup) overlaps with the asset
  // get/set work; sides write to different Asset rows so no race even
  // when both fromDao and toDao are present.
  const sideTasks: Array<Promise<void>> = [
    addToken(context, {
      chainId,
      tokenAddress,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    }),
  ];
  if (toDao) {
    recordTransaction(context, { ...txCommon, daoAddress: toAddress, side: TransactionSide.Deposit });
    sideTasks.push(updateDaoAssets(context, { ...assetCommon, daoAddress: toAddress, side: TransactionSide.Deposit }));
  }
  if (fromDao) {
    recordTransaction(context, { ...txCommon, daoAddress: fromAddress, side: TransactionSide.Withdraw });
    sideTasks.push(
      updateDaoAssets(context, { ...assetCommon, daoAddress: fromAddress, side: TransactionSide.Withdraw }),
    );
  }
  await Promise.all(sideTasks);
});
