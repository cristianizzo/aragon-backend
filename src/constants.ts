import { keccak256, toHex } from "viem";

export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000";

/**
 * EVM precompile addresses (0x01–0x09). Show up as `condition` in
 * `DAO.Granted` events when a permission uses an inline crypto check —
 * e.g. SHA-256 (0x02) is common in mainnet condition addresses. They're
 * not real contracts, so registering them as ExecuteSelectorCondition
 * sources floods logs with duplicate-registration warnings.
 */
export const PRECOMPILE_ADDRESSES: ReadonlySet<string> = new Set([
  "0x0000000000000000000000000000000000000001", // ecRecover
  "0x0000000000000000000000000000000000000002", // SHA-256
  "0x0000000000000000000000000000000000000003", // RIPEMD-160
  "0x0000000000000000000000000000000000000004", // identity
  "0x0000000000000000000000000000000000000005", // modexp
  "0x0000000000000000000000000000000000000006", // ecAdd
  "0x0000000000000000000000000000000000000007", // ecMul
  "0x0000000000000000000000000000000000000008", // ecPairing
  "0x0000000000000000000000000000000000000009", // blake2f
]);

/**
 * `keccak256("MINT_PERMISSION")` — Aragon governance ERC20s grant this to the
 * owning DAO so the DAO can mint via proposal execution. Used by `addToken`
 * and the `Granted` handler to derive `Token.mintableByDao`.
 */
export const MINT_PERMISSION_ID = keccak256(toHex("MINT_PERMISSION"));

/**
 * `keccak256("EXECUTE_PROPOSAL_PERMISSION")` — Aragon Admin plugin grants
 * this to addresses authorised to execute proposals through it. Used by the
 * `Granted` / `Revoked` handlers to derive admin members (one PluginMember
 * row per holder of this permission on an admin plugin), mirroring legacy
 * `permissionHandler.handleForAdminPlugin` logic.
 */
export const EXECUTE_PROPOSAL_PERMISSION_ID = keccak256(toHex("EXECUTE_PROPOSAL_PERMISSION"));

/**
 * `keccak256("CREATE_PROPOSAL_PERMISSION")` — gates who can create proposals
 * on a governance plugin. When this permission carries a non-zero
 * `condition` address, `Plugin.conditionAddress` records it so consumers
 * can resolve "who is allowed to create proposals" without walking the
 * full permissions blob.
 */
export const CREATE_PROPOSAL_PERMISSION_ID = keccak256(toHex("CREATE_PROPOSAL_PERMISSION"));

/**
 * `keccak256("EXECUTE_PERMISSION")` — gates a plugin's ability to call
 * `DAO.execute()`. The standard PSP install/uninstall flow grants/revokes
 * this; out-of-band grants/revokes (DAO bypassing PSP) are treated as
 * fallback re-install/uninstall signals in `handlers/Permission.ts`.
 */
export const EXECUTE_PERMISSION_ID = keccak256(toHex("EXECUTE_PERMISSION"));

/**
 * Chains where the native token is exposed as an ERC-20 contract — zkSync's
 * ETH and Peaq's PEAQ. On these chains every "native" transfer also fires a
 * standard `Transfer` event which our wildcard ERC-20 handler already catches,
 * so native-specific handlers must skip these chains to avoid double-counting.
 *
 * Mirrors legacy `DaoTransactions.start` skipping in
 * `app-backend/src/services/aragon-dao/daoTransactions.ts`.
 */
export const NATIVE_AS_ERC20_CHAINS: ReadonlySet<number> = new Set([
  324, // zksync
  3338, // peaq
]);

/**
 * Testnet chain ids — used by spam heuristics to skip false positives
 * (testnet tokens often have garbage names by design).
 */
export const TESTNET_CHAIN_IDS: ReadonlySet<number> = new Set([
  11155111, // ethereum sepolia
]);

/**
 * keccak256("eip1967.proxy.implementation") - 1.
 * Storage slot holding the implementation address of an EIP-1967 transparent proxy.
 */
export const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc";

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
