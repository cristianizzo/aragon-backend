import { ExecuteSelectorCondition } from "generated";
import { getAddress } from "viem";
import { decodeSelector } from "../effects/decodeSelector";
import { nativeTransferPermissionId, selectorPermissionId } from "../ids";

ExecuteSelectorCondition.SelectorAllowed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const conditionAddress = getAddress(event.srcAddress);
  const whereAddress = getAddress(event.params.where);
  const selector = event.params.selector;

  // Resolve selector → function name + canonical signature so consumers
  // can render the permission without keeping their own ABI registry.
  const decoded = await context.effect(decodeSelector, selector);

  context.SelectorPermission.set({
    id: selectorPermissionId(chainId, conditionAddress, selector, whereAddress),
    chainId,
    conditionAddress,
    selector,
    whereAddress,
    allowed: true,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    functionName: decoded.functionName ?? undefined,
    functionSig: decoded.functionSig ?? undefined,
  });
});

ExecuteSelectorCondition.SelectorDisallowed.handler(async ({ event, context }) => {
  const id = selectorPermissionId(event.chainId, event.srcAddress, event.params.selector, event.params.where);
  const existing = await context.SelectorPermission.get(id);
  if (existing) {
    context.SelectorPermission.set({ ...existing, allowed: false });
  }
});

ExecuteSelectorCondition.NativeTransfersAllowed.handler(async ({ event, context }) => {
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
});

ExecuteSelectorCondition.NativeTransfersDisallowed.handler(async ({ event, context }) => {
  const id = nativeTransferPermissionId(event.chainId, event.srcAddress, event.params.where);
  const existing = await context.NativeTransferPermission.get(id);
  if (existing) {
    context.NativeTransferPermission.set({ ...existing, allowed: false });
  }
});
