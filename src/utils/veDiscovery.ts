import { getClientSafe } from "../config";
import { ESCROW_ABI, LOCK_MANAGER_ABI, QUEUE_ABI } from "../constants";

/**
 * Direct RPC calls for VE contract discovery.
 * Used in contractRegister (which doesn't have access to context.effect()).
 */

/**
 * Discover VotingEscrow and ExitQueue from a token adapter address.
 * tokenAddress.escrow() → escrowAddress
 * escrowAddress.queue() → exitQueueAddress
 */
export async function discoverVeContracts(
  tokenAddress: string,
  chainId: number,
): Promise<{ escrowAddress: string; exitQueueAddress?: string } | null> {
  const client = getClientSafe(chainId);
  if (!client) return null;

  try {
    const escrowAddress = await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: ESCROW_ABI,
      functionName: "escrow",
    });
    if (!escrowAddress || escrowAddress === "0x0000000000000000000000000000000000000000") return null;

    let exitQueueAddress: string | undefined;
    try {
      exitQueueAddress = await client.readContract({
        address: escrowAddress as `0x${string}`,
        abi: QUEUE_ABI,
        functionName: "queue",
      });
    } catch {
      /* not all escrows have a queue */
    }

    return { escrowAddress, exitQueueAddress };
  } catch {
    return null; // Not a VE token
  }
}

/**
 * Discover LockManager address from a LockToVote plugin.
 * pluginAddress.lockManager() → lockManagerAddress
 */
export async function discoverLockManagerAddress(pluginAddress: string, chainId: number): Promise<string | null> {
  const client = getClientSafe(chainId);
  if (!client) return null;

  try {
    return await client.readContract({
      address: pluginAddress as `0x${string}`,
      abi: LOCK_MANAGER_ABI,
      functionName: "lockManager",
    });
  } catch {
    return null;
  }
}
