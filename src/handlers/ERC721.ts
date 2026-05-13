import { indexer } from "envio";
import { getAddress } from "viem";
import { TransactionSide, TransactionType } from "../enums";
import { updateDaoAssets } from "../services/asset";
import { addToken } from "../services/token";
import { recordTransaction } from "../services/transaction";
import { daoId } from "../utils/ids";

// Wildcard ERC-721 Transfer subscription — mirrors the ERC-20 wildcard
// handler. Topic0 collides with ERC-20's Transfer, but the third param
// being `indexed` means logs with 4 topics route here and 3-topic ERC-20
// logs route to `ERC20.ts`. Per-perspective row emission (from + to)
// matches the ERC-20 handler so a DAO-to-DAO transfer produces two rows.
//
// `value` on the Transaction entity is set to `1n` since ERC-721 transfers
// always move a single NFT. The actual NFT id is on `Transaction.tokenId`.
// `Asset.amount` accumulates the NFT count: deposits add 1, withdrawals
// subtract 1.
indexer.onEvent(
  { contract: "ERC721", event: "Transfer", wildcard: true },
  async ({ event, context }) => {
    const { chainId } = event;
    const fromAddress = getAddress(event.params.from);
    const toAddress = getAddress(event.params.to);

    const [fromDao, toDao] = await Promise.all([
      context.Dao.get(daoId(chainId, fromAddress)),
      context.Dao.get(daoId(chainId, toAddress)),
    ]);
    if (!fromDao && !toDao) return;

    const tokenAddress = getAddress(event.srcAddress);
    await addToken(context, {
      chainId,
      tokenAddress,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });

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

    if (toDao) {
      recordTransaction(context, { ...txCommon, daoAddress: toAddress, side: TransactionSide.Deposit });
      await updateDaoAssets(context, { ...assetCommon, daoAddress: toAddress, side: TransactionSide.Deposit });
    }

    if (fromDao) {
      recordTransaction(context, { ...txCommon, daoAddress: fromAddress, side: TransactionSide.Withdraw });
      await updateDaoAssets(context, { ...assetCommon, daoAddress: fromAddress, side: TransactionSide.Withdraw });
    }
  },
);
