import type { EvmOnEventContext as HandlerContext } from "envio";
import { getAddress } from "viem";
import { fetchIpfsJson } from "../effects/ipfs";
import logger from "../helpers/logger";
import { eventLogId, pluginId } from "../utils/ids";
import { extractIpfsCid, parsePluginMetadata } from "../utils/metadata";

const llo = logger.logMeta.bind(null, { service: "services:pluginMetadata" });

/**
 * Apply a `MetadataSet(bytes metadata)` event to the Plugin entity.
 *
 * OSx plugins inherit `_setMetadata(bytes)` from `PluginUUPSUpgradeable`,
 * which emits `MetadataSet(bytes metadata)`. Whether each plugin type
 * actually emits it depends on whether its `initialize()` calls
 * `_setMetadata` and whether the DAO ever calls `setMetadata` post-install.
 * We subscribe to all plugin types defensively — handlers no-op for plugin
 * types that never emit, harmless.
 *
 * Each plugin contract type registers its own aliased event in `config.yaml`
 * (`MultisigMetadataSet`, `TokenVotingMetadataSet`, etc.) and routes to a
 * one-line handler that delegates here.
 *
 * **Plugin row must exist** — typically true because OSx plugin `initialize`
 * implementations don't call `_setMetadata` (so MetadataSet only fires later,
 * via DAO governance, by which time `InstallationPrepared` has created the
 * Plugin row). If we ever observe the warning below in production, we'll need
 * to add a stub-then-merge path (which requires resolving the DAO address —
 * not derivable from MetadataSet alone, so non-trivial).
 */
export async function applyPluginMetadata(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: string;
    metadata: string;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
    logIndex: number;
  },
): Promise<void> {
  const pluginAddress = getAddress(args.pluginAddress);
  const plugin_id = pluginId(args.chainId, pluginAddress);
  const plugin = await context.Plugin.get(plugin_id);
  if (!plugin) {
    logger.warn(
      "Plugin metadata received before Plugin row exists — metadata dropped",
      llo({ pluginAddress, chainId: args.chainId }),
    );
    return;
  }

  const cid = extractIpfsCid(args.metadata);
  if (!cid) return;

  const raw = await context.effect(fetchIpfsJson, cid);
  const metadata = parsePluginMetadata(raw);

  // Audit-log this MetadataSet event before updating the Plugin row so
  // historical metadata changes are queryable (mirrors `DaoMetadataLog`).
  context.PluginMetadataLog.set({
    id: eventLogId(args.chainId, args.transactionHash, args.logIndex),
    chainId: args.chainId,
    plugin_id,
    pluginAddress,
    metadataUri: `ipfs://${cid}`,
    rawMetadata: args.metadata,
    name: metadata?.name,
    description: metadata?.description,
    links: metadata?.links,
    processKey: metadata?.processKey,
    stageNames: metadata?.stageNames,
    fetchSucceeded: metadata !== null,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    logIndex: args.logIndex,
  });

  // Only update `metadataUri` when the IPFS fetch actually succeeded —
  // preserves the previous good URI if this fetch failed. The other fields
  // already fall back to the existing values via `?? plugin.X`.
  const metadataUri = metadata ? `ipfs://${cid}` : plugin.metadataUri;

  context.Plugin.set({
    ...plugin,
    metadataUri,
    name: metadata?.name ?? plugin.name,
    description: metadata?.description ?? plugin.description,
    links: metadata?.links ?? plugin.links,
    processKey: metadata?.processKey ?? plugin.processKey,
    stageNames: metadata?.stageNames ?? plugin.stageNames,
  });
}
