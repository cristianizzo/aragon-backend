import { escrow, lockManager } from "../abis";
import { ZERO_ADDRESS } from "../constants";
import { getClientSafe } from "../helpers/rpcProvider";

/**
 * Direct RPC calls for VE contract discovery.
 * Used in contractRegister (which doesn't have access to context.effect()).
 */

/**
 * Result of `discoverVeContracts`. Field names mirror the legacy
 * `findVotingEscrow` return shape so consumers see the same JSON in
 * `Plugin.votingEscrow`. Each sub-contract is optional because escrow
 * variants in the wild differ — older VE contracts may not expose `curve`
 * or `clock`, for instance. A null overall result means the input address
 * is not a token-votes adapter at all.
 */
export interface VeContracts {
  escrowAddress: string;
  exitQueueAddress?: string;
  curveAddress?: string;
  clockAddress?: string;
  nftLockAddress?: string;
  /** Underlying ERC-20 staked into the escrow (returned by `escrow.token()`). */
  underlying?: string;
}

/**
 * Discover the full VE governance chain from a token adapter address.
 *
 * Discovery chain (per legacy `GovernanceVeHelper`):
 *   tokenAddress.escrow()      → escrowAddress     (REQUIRED, gates everything)
 *   escrowAddress.queue()      → exitQueueAddress  (best-effort)
 *   escrowAddress.curve()      → curveAddress      (best-effort)
 *   escrowAddress.clock()      → clockAddress      (best-effort)
 *   escrowAddress.lockNFT()    → nftLockAddress    (best-effort)
 *   escrowAddress.token()      → underlying ERC-20 (best-effort)
 *
 * The five sub-calls fan out in parallel via `Promise.allSettled` so one
 * missing accessor doesn't drop the whole chain. Returns null only when
 * the initial `escrow()` call fails — that's the "not a VE token" signal.
 */
export async function discoverVeContracts(tokenAddress: string, chainId: number): Promise<VeContracts | null> {
  const client = getClientSafe(chainId);
  if (!client) return null;

  let escrowAddress: string;
  try {
    escrowAddress = await client.readContract({
      address: tokenAddress as `0x${string}`,
      abi: escrow.escrow,
      functionName: "escrow",
    });
  } catch {
    return null; // Not a VE token
  }
  if (!escrowAddress || escrowAddress === ZERO_ADDRESS) return null;

  const escrowAddr = escrowAddress as `0x${string}`;
  const [queue, curve, clock, lockNft, token] = await Promise.allSettled([
    client.readContract({ address: escrowAddr, abi: escrow.queue, functionName: "queue" }),
    client.readContract({ address: escrowAddr, abi: escrow.curve, functionName: "curve" }),
    client.readContract({ address: escrowAddr, abi: escrow.clock, functionName: "clock" }),
    client.readContract({ address: escrowAddr, abi: escrow.lockNft, functionName: "lockNFT" }),
    client.readContract({ address: escrowAddr, abi: escrow.token, functionName: "token" }),
  ]);

  const fulfilledOrUndefined = (r: PromiseSettledResult<string>): string | undefined =>
    r.status === "fulfilled" && r.value && r.value !== ZERO_ADDRESS ? r.value : undefined;

  return {
    escrowAddress,
    exitQueueAddress: fulfilledOrUndefined(queue),
    curveAddress: fulfilledOrUndefined(curve),
    clockAddress: fulfilledOrUndefined(clock),
    nftLockAddress: fulfilledOrUndefined(lockNft),
    underlying: fulfilledOrUndefined(token),
  };
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
      abi: lockManager.lockManager,
      functionName: "lockManager",
    });
  } catch {
    return null;
  }
}
