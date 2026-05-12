import type { HandlerContext } from "generated";
import { getAddress } from "viem";
import type { TransactionSide, TransactionType } from "../enums";
import logger from "../helpers/logger";
import { daoId, transactionId } from "../ids";

const llo = logger.logMeta.bind(null, { service: "services:transaction" });

export interface RecordTransactionInput {
  chainId: number;
  daoAddress: string;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
  // Tx position inside the block — second sort key after `blockNumber`.
  // Required by callers that need stable ordering between transactions in
  // the same block. Optional because some legacy code paths don't have it.
  transactionIndex?: number;
  logIndex: number;
  side: TransactionSide;
  type: TransactionType;
  fromAddress: string;
  toAddress: string;
  tokenAddress: string;
  value: bigint;
  // Set only when this Transaction comes from a batch action inside a
  // `DAO.Executed` log — disambiguates multiple transfers sharing one logIndex.
  actionIndex?: number;
  // ERC-721 / ERC-1155 only — the specific NFT id transferred. Null for
  // ERC-20 and native transfers.
  tokenId?: string;
}

/**
 * Persist one DAO's perspective on a transfer log. Caller decides which DAO
 * is the subject (deposits use the receiver, withdrawals use the sender);
 * a single Transfer that touches two DAOs results in two calls — one per
 * perspective.
 */
export function recordTransaction(context: HandlerContext, input: RecordTransactionInput): void {
  const daoAddress = getAddress(input.daoAddress);
  const id = transactionId(input.chainId, daoAddress, input.transactionHash, input.logIndex, input.actionIndex);

  context.Transaction.set({
    id,
    chainId: input.chainId,
    dao_id: daoId(input.chainId, daoAddress),
    daoAddress,
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
    transactionHash: input.transactionHash,
    transactionIndex: input.transactionIndex,
    logIndex: input.logIndex,
    side: input.side,
    type: input.type,
    fromAddress: getAddress(input.fromAddress),
    toAddress: getAddress(input.toAddress),
    tokenAddress: getAddress(input.tokenAddress),
    value: input.value,
    actionIndex: input.actionIndex,
    tokenId: input.tokenId,
  });

  logger.debug(
    "Transaction created",
    llo({
      id,
      side: input.side,
      type: input.type,
      daoAddress,
      tokenAddress: input.tokenAddress,
      value: input.value.toString(),
      transactionHash: input.transactionHash,
      actionIndex: input.actionIndex,
    }),
  );
}
