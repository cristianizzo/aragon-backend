import { indexer } from "envio";
import { getAddress } from "viem";
import { TransactionSide, TransactionType } from "../enums";
import { updateDaoAssets } from "../services/asset";
import { addToken } from "../services/token";
import { recordTransaction } from "../services/transaction";
import { getDaoSet } from "../utils/daoRegistry";

// Wildcard ERC-721 Transfer subscription — mirrors the ERC-20 wildcard
// handler. Topic0 collides with ERC-20's Transfer, but the third param
// being `indexed` means logs with 4 topics route here and 3-topic ERC-20
// logs route to `ERC20.ts`. Per-perspective row emission (from + to)
// matches the ERC-20 handler so a DAO-to-DAO transfer produces two rows.
//
// DAO-membership check uses `getDaoSet` (in-memory address registry) — no
// per-event DB lookup. See `src/utils/daoRegistry.ts` for the rationale.
//
// `value` on the Transaction entity is set to `1n` since ERC-721 transfers
// always move a single NFT. The actual NFT id is on `Transaction.tokenId`.
// `Asset.amount` accumulates the NFT count: deposits add 1, withdrawals
// subtract 1.
indexer.onEvent({ contract: "ERC721", event: "Transfer", wildcard: true }, async ({ event, context }) => {
  const { chainId } = event;
  const fromAddress = getAddress(event.params.from);
  const toAddress = getAddress(event.params.to);

  const daos = getDaoSet(chainId);
  const fromDao = daos.has(fromAddress);
  const toDao = daos.has(toAddress);
  if (!fromDao && !toDao) return;

  const tokenAddress = getAddress(event.srcAddress);
  const tokenId = event.params.tokenId.toString();
  const txCommon = {
    chainId,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    transactionIndex: event.transaction.transactionIndex,
    logIndex: event.logIndex,
    type: TransactionType.Erc721,
    fromAddress,
    toAddress,
    tokenAddress,
    value: 1n,
    tokenId,
  };
  const assetCommon = {
    chainId,
    tokenAddress,
    amount: 1n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
  };

  // Run addToken + per-side asset updates in parallel — same rationale
  // as the ERC-20 wildcard handler: addToken's first-sight cost overlaps
  // with the asset get/set work, and the two sides write to distinct
  // Asset rows so concurrent execution is safe.
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
