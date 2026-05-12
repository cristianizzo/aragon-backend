/**
 * Detect ERC token interface + governance / escrow-adapter flags by matching
 * function-selector prefixes in deployed bytecode. Mirrors legacy
 * `app-backend/src/helpers/tokenDetector.ts` — same selector lists, same
 * keccak256-prefix approach, no RPC calls (input is already-fetched bytecode).
 *
 * Caller is responsible for resolving proxy → implementation bytecode before
 * passing in. Selectors live on the implementation, not the EIP-1967 shim.
 */

import { keccak256, toHex } from "viem";
import { TokenType } from "../enums";

const SIG = (sig: string): string => keccak256(toHex(sig)).slice(2, 10);

// Compose by named groups rather than scattering selector strings through
// the detector body — keeps the legacy mapping obvious.
const ERC20_VOTES_SIGS = ["getVotes(address)", "getPastVotes(address,uint256)", "getPastTotalSupply(uint256)"];
const ERC20_SIGS = [
  "totalSupply()",
  "balanceOf(address)",
  "transfer(address,uint256)",
  "transferFrom(address,address,uint256)",
  "approve(address,uint256)",
  "allowance(address,address)",
];
const ERC721_SIGS = [
  "ownerOf(uint256)",
  "balanceOf(address)",
  "approve(address,uint256)",
  "getApproved(uint256)",
  "setApprovalForAll(address,bool)",
  "isApprovedForAll(address,address)",
  "safeTransferFrom(address,address,uint256)",
];
const ESCROW_ADAPTER_SIGS = ["escrow()", "clock()"];

const ERC20_VOTES_SELECTORS = ERC20_VOTES_SIGS.map(SIG);
const ERC20_SELECTORS = ERC20_SIGS.map(SIG);
const ERC721_SELECTORS = ERC721_SIGS.map(SIG);
const ESCROW_ADAPTER_SELECTORS = ESCROW_ADAPTER_SIGS.map(SIG);

const hasAll = (lowerCode: string, selectors: readonly string[]): boolean =>
  selectors.every((s) => lowerCode.includes(s));

export interface TokenInterfaceFlags {
  /** `Erc20` / `Erc721` if the standard interface is fully present, otherwise undefined. */
  type: TokenType | undefined;
  /** True if the contract implements the OpenZeppelin ERC20Votes governance interface. */
  isGovernance: boolean;
  /** True if the contract is an Aragon VE escrow adapter (`escrow()` + `clock()`). */
  isEscrowAdapter: boolean;
}

export function detectTokenInterface(bytecode: string | undefined): TokenInterfaceFlags {
  if (!bytecode || bytecode === "0x") {
    return { type: undefined, isGovernance: false, isEscrowAdapter: false };
  }
  const code = bytecode.toLowerCase();

  let type: TokenType | undefined;
  if (hasAll(code, ERC20_SELECTORS)) type = TokenType.Erc20;
  else if (hasAll(code, ERC721_SELECTORS)) type = TokenType.Erc721;

  return {
    type,
    isGovernance: hasAll(code, ERC20_VOTES_SELECTORS),
    isEscrowAdapter: hasAll(code, ESCROW_ADAPTER_SELECTORS),
  };
}
