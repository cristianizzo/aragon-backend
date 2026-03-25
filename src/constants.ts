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

// Schema enum values — avoid hardcoded strings in handlers
export const TransferType = { Native: "Native", ERC20: "ERC20", ERC721: "ERC721" } as const;
export const TransferSide = { Deposit: "Deposit", Withdraw: "Withdraw" } as const;
export const PermissionEvent = { Granted: "Granted", Revoked: "Revoked" } as const;
export const ProposalStatus = { Active: "Active", Succeeded: "Succeeded", Defeated: "Defeated", Executed: "Executed", Canceled: "Canceled" } as const;
export const PluginStatus = { PreInstall: "preInstall", Installed: "installed", Deprecated: "deprecated", Updated: "updated", Uninstalled: "uninstalled", Abandoned: "abandoned" } as const;
export const GaugeStatus = { Active: "Active", Deactivated: "Deactivated" } as const;
export const TokenType = { ERC20: "ERC20", ERC721: "ERC721" } as const;

// DAO upgrade detection
export const UPGRADE_TO_AND_CALL_SELECTOR = "0x4f1ef286";

// EIP-1967 implementation storage slot
export const EIP1967_IMPLEMENTATION_SLOT =
  "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// DAO protocol version ABI
export const PROTOCOL_VERSION_ABI = parseAbi([
  "function protocolVersion() view returns (uint8 major, uint8 minor, uint8 patch)",
]);

// Shared ABIs for VE contract discovery
export const ESCROW_ABI = parseAbi(["function escrow() view returns (address)"]);
export const QUEUE_ABI = parseAbi(["function queue() view returns (address)"]);
export const LOCK_NFT_ABI = parseAbi(["function lockNFT() view returns (address)"]);
export const TOKEN_ABI = parseAbi(["function token() view returns (address)"]);
export const LOCK_MANAGER_ABI = parseAbi(["function lockManager() view returns (address)"]);
export const CURVE_ABI = parseAbi(["function curve() view returns (address)"]);
export const CLOCK_ABI = parseAbi(["function clock() view returns (address)"]);

export const ERC20_METADATA_ABI = parseAbi([
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function totalSupply() view returns (uint256)",
]);
