import { indexer } from "envio";
import { getAddress } from "viem";
import { TransactionSide, TransactionType } from "../enums";
import { updateDaoAssets } from "../services/asset";
import { addToken } from "../services/token";
import { recordTransaction } from "../services/transaction";
import { daoId } from "../utils/ids";

// Wildcard subscription: every ERC-20 `Transfer` on every contract on every
// configured chain hits this handler. We filter at handler-time on
// `context.Dao.get(from)` / `context.Dao.get(to)` — Envio's recommended
// pattern for "thousands of addresses to watch":
//   https://docs.envio.dev/docs/HyperIndex/wildcard-indexing#assert-erc20-transfers-in-handler
//
// When a transfer goes from one DAO to another (rare but valid), TWO rows
// are written — one withdraw perspective for the sender, one deposit
// perspective for the receiver — disambiguated via `daoAddress` in the
// transaction id.
indexer.onEvent(
  { contract: "ERC20", event: "Transfer", wildcard: true },
  async ({ event, context }) => {
    const value = event.params.value;
    if (value === 0n) return;

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
