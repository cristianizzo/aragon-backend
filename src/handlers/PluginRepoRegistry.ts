import { indexer } from "envio";
import { getAddress } from "viem";
import { pluginRepoId } from "../utils/ids";

indexer.onEvent({ contract: "PluginRepoRegistry", event: "PluginRepoRegistered" }, async ({ event, context }) => {
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
