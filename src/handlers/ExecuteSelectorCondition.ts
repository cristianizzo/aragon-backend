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
    // Mirrors legacy `SelectorPermission.target`: the contract being called
    // (the actual function-call target). Same value as `whereAddress` for
    // events emitted by the standard ExecuteSelectorCondition contract —
    // legacy denormed for query convenience and we follow the convention.
    target: whereAddress,
    allowed: true,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    functionName: decoded.functionName ?? undefined,
    functionSig: decoded.functionSig ?? undefined,
    // Rich blob mirroring legacy `SelectorPermission.decoded`. Only the
    // fields we can derive locally land here — contract source / NatSpec
    // (`contractName`, `proxyName`, `implementationAddress`, `notice`)
    // would require a per-permission Etherscan lookup we deliberately skip
    // to keep the hot-path cheap.
    decoded: decoded.functionSig ? { functionName: decoded.functionName, functionSig: decoded.functionSig } : undefined,
    // Active permission — `disallowed` audit object lands later when (if)
    // a SelectorDisallowed event flips `allowed`.
    disallowed: undefined,
  });
});

ExecuteSelectorCondition.SelectorDisallowed.handler(async ({ event, context }) => {
  const id = selectorPermissionId(event.chainId, event.srcAddress, event.params.selector, event.params.where);
  const existing = await context.SelectorPermission.get(id);
  if (existing) {
    context.SelectorPermission.set({
      ...existing,
      allowed: false,
      // Soft-clear audit object mirroring legacy `SelectorPermission.disallowed`.
      // Same shape as `Vote.voteCleared` — keeps the row so historical queries
      // still see it, with the disallow event's metadata stamped for audit.
      disallowed: {
        status: true,
        transactionHash: event.transaction.hash,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
      },
    });
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
