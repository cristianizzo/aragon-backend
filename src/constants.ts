import { parseAbi } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * Solidity enum IMajorityVoting.VoteOption
 * 0 = None, 1 = Abstain, 2 = Yes, 3 = No
 */
export enum VoteOption {
  None = 0,
  Abstain = 1,
  Yes = 2,
  No = 3,
}

export function safeJsonParse(value: string | undefined | null): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// Shared ABIs for VE contract discovery
export const ESCROW_ABI = parseAbi(["function escrow() view returns (address)"]);
export const QUEUE_ABI = parseAbi(["function queue() view returns (address)"]);
export const LOCK_NFT_ABI = parseAbi(["function lockNFT() view returns (address)"]);
export const TOKEN_ABI = parseAbi(["function token() view returns (address)"]);
export const LOCK_MANAGER_ABI = parseAbi(["function lockManager() view returns (address)"]);
export const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
]);
