import type { HandlerContext } from "generated";

/**
 * Resolve the VE-chain sibling addresses (exit queue, NFT-lock contract)
 * for an escrow address by reading the parent Plugin's `votingEscrow` blob
 * via the indexed `escrowAddress` column.
 *
 * Returns `null` when no Plugin references this escrow yet (e.g. an
 * out-of-order Deposit before the install-time discovery row lands — rare,
 * since `contractRegister` writes Plugin first).
 */
export interface VeChainAddresses {
  pluginAddress: string;
  exitQueueAddress: string | null;
  nftLockAddress: string | null;
  underlyingToken: string | null;
}

export async function lookupVeChainByEscrow(
  context: HandlerContext,
  args: { chainId: number; escrowAddress: string },
): Promise<VeChainAddresses | null> {
  const matches = await context.Plugin.getWhere({ escrowAddress: { _eq: args.escrowAddress } });
  const plugin = matches.find((p) => p.chainId === args.chainId);
  if (!plugin) return null;

  const ve = plugin.votingEscrow as
    | { exitQueueAddress?: string; nftLockAddress?: string; underlying?: string }
    | undefined
    | null;
  return {
    pluginAddress: plugin.address,
    exitQueueAddress: ve?.exitQueueAddress ?? null,
    nftLockAddress: ve?.nftLockAddress ?? null,
    underlyingToken: ve?.underlying ?? null,
  };
}
