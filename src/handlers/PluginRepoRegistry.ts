import { PluginRepoRegistry } from "generated";
import { pluginRepoId } from "../utils/ids";

PluginRepoRegistry.PluginRepoRegistered.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = pluginRepoId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  const existing = await context.PluginRepo.get(id);
  if (existing) return;

  context.PluginRepo.set({
    id,
    chainId,
    address: event.params.pluginRepo,
    subdomain: event.params.subdomain,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});
