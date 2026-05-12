import type { HandlerContext } from "generated";
import { getAddress } from "viem";
import { TransactionSide } from "../enums";
import logger from "../helpers/logger";
import { assetId, daoId } from "../utils/ids";

const llo = logger.logMeta.bind(null, { service: "services:asset" });

export interface UpdateDaoAssetsInput {
  chainId: number;
  daoAddress: string;
  tokenAddress: string;
  side: TransactionSide;
  amount: bigint;
  blockNumber: number;
  blockTimestamp: number;
}

/**
 * Apply a single transfer to the DAO's running balance for one token.
 * Deposits add, withdrawals subtract. Creates the row on first sight.
 * Native uses `0x000...000` as the token address.
 *
 * Balance is derived from event history alone — no on-chain reconciliation.
 * Rebase / wrapper / ERC777 edge cases are out of scope for now.
 */
export async function updateDaoAssets(context: HandlerContext, input: UpdateDaoAssetsInput): Promise<void> {
  const daoAddress = getAddress(input.daoAddress);
  const tokenAddress = getAddress(input.tokenAddress);
  const id = assetId(input.chainId, daoAddress, tokenAddress);
  const delta = input.side === TransactionSide.Deposit ? input.amount : -input.amount;
  const existing = await context.Asset.get(id);

  if (!existing) {
    context.Asset.set({
      id,
      chainId: input.chainId,
      dao_id: daoId(input.chainId, daoAddress),
      daoAddress,
      tokenAddress,
      amount: delta,
      blockNumber: input.blockNumber,
      blockTimestamp: input.blockTimestamp,
    });
    logger.debug(
      "Asset created",
      llo({ id, daoAddress, tokenAddress, amount: delta.toString(), blockNumber: input.blockNumber }),
    );
    return;
  }

  const newAmount = existing.amount + delta;
  context.Asset.set({
    ...existing,
    amount: newAmount,
    blockNumber: input.blockNumber,
    blockTimestamp: input.blockTimestamp,
  });
  logger.debug(
    "Asset updated",
    llo({
      id,
      daoAddress,
      tokenAddress,
      delta: delta.toString(),
      amount: newAmount.toString(),
      blockNumber: input.blockNumber,
    }),
  );
}
