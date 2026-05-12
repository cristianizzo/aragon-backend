import { PluginRepoRegistry } from "generated";
import { getAddress } from "viem";
import { pluginRepoId } from "../ids";

PluginRepoRegistry.PluginRepoRegistered.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const address = getAddress(event.params.pluginRepo);
  const id = pluginRepoId(chainId, address);

  context.PluginRepo.set({
    id,
    chainId,
    address,
    subdomain: event.params.subdomain,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});
