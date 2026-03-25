import { ExecuteSelectorCondition } from "generated";
import { eventId } from "../utils/ids";

ExecuteSelectorCondition.SelectorAllowed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const conditionAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.SelectorPermission.set({
    id,
    chainId,
    conditionAddress,
    selector: event.params.selector,
    whereAddress: event.params.where,
    allowed: true,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

ExecuteSelectorCondition.SelectorDisallowed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const conditionAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  // Append-only — create new record with allowed: false
  context.SelectorPermission.set({
    id,
    chainId,
    conditionAddress,
    selector: event.params.selector,
    whereAddress: event.params.where,
    allowed: false,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

ExecuteSelectorCondition.NativeTransfersAllowed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const conditionAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.NativeTransferPermission.set({
    id,
    chainId,
    conditionAddress,
    whereAddress: event.params.where,
    allowed: true,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

ExecuteSelectorCondition.NativeTransfersDisallowed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const conditionAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  // Append-only — create new record with allowed: false
  context.NativeTransferPermission.set({
    id,
    chainId,
    conditionAddress,
    whereAddress: event.params.where,
    allowed: false,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});
