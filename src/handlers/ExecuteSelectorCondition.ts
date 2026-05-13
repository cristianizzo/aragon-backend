import { indexer } from "envio";
import { getAddress } from "viem";
import { decodeSelector } from "../effects/decodeSelector";
import { nativeTransferPermissionId, selectorPermissionId } from "../utils/ids";

indexer.onEvent(
  { contract: "ExecuteSelectorCondition", event: "SelectorAllowed" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const conditionAddress = getAddress(event.srcAddress);
    const whereAddress = getAddress(event.params.where);
    const selector = event.params.selector;

    const decoded = await context.effect(decodeSelector, selector);

    context.SelectorPermission.set({
      id: selectorPermissionId(chainId, conditionAddress, selector, whereAddress),
      chainId,
      conditionAddress,
      selector,
      whereAddress,
      target: whereAddress,
      allowed: true,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      functionName: decoded.functionName ?? undefined,
      functionSig: decoded.functionSig ?? undefined,
      decoded: decoded.functionSig ? { functionName: decoded.functionName, functionSig: decoded.functionSig } : undefined,
      disallowed: undefined,
    });
  },
);

indexer.onEvent(
  { contract: "ExecuteSelectorCondition", event: "SelectorDisallowed" },
  async ({ event, context }) => {
    const id = selectorPermissionId(event.chainId, event.srcAddress, event.params.selector, event.params.where);
    const existing = await context.SelectorPermission.get(id);
    if (existing) {
      context.SelectorPermission.set({
        ...existing,
        allowed: false,
        disallowed: {
          status: true,
          transactionHash: event.transaction.hash,
          blockNumber: event.block.number,
          blockTimestamp: event.block.timestamp,
        },
      });
    }
  },
);

indexer.onEvent(
  { contract: "ExecuteSelectorCondition", event: "NativeTransfersAllowed" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const conditionAddress = getAddress(event.srcAddress);
    const whereAddress = getAddress(event.params.where);

    context.NativeTransferPermission.set({
      id: nativeTransferPermissionId(chainId, conditionAddress, whereAddress),
      chainId,
      conditionAddress,
      whereAddress,
      allowed: true,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "ExecuteSelectorCondition", event: "NativeTransfersDisallowed" },
  async ({ event, context }) => {
    const id = nativeTransferPermissionId(event.chainId, event.srcAddress, event.params.where);
    const existing = await context.NativeTransferPermission.get(id);
    if (existing) {
      context.NativeTransferPermission.set({ ...existing, allowed: false });
    }
  },
);
