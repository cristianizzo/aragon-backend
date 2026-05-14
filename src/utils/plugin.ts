import { getAddress } from "viem";
import { CREATE_PROPOSAL_PERMISSION_ID, ZERO_ADDRESS } from "../constants";
import { PluginInterfaceType } from "../enums";

// V3 codegen models Solidity tuples as object-keyed records. The runtime
// values are still JS arrays, but the TS types index by numeric keys.
export type RawPermission = {
  readonly 0: bigint | number;
  readonly 1: string;
  readonly 2: string;
  readonly 3: string;
  readonly 4: string;
};

/**
 * Parse the `MultiTargetPermission[]` array attached to PSP prepared events.
 * Tuple shape: `[operation, where, who, condition, permissionId]` where
 * `operation` is the OSx `PermissionLib.Operation` enum
 * (0=Grant, 1=Revoke, 2=GrantWithCondition, 3=RevokeWithCondition).
 * `condition` is `ZERO_ADDRESS` for plain Grant/Revoke — normalize to
 * `undefined` so consumers can `if (p.condition)` cleanly.
 */
export function parsePermissions(raw: readonly RawPermission[] | undefined): unknown {
  if (!raw || raw.length === 0) return undefined;
  return raw.map((p) => ({
    operation: Number(p[0]),
    where: getAddress(p[1]),
    who: getAddress(p[2]),
    condition: p[3] && p[3] !== ZERO_ADDRESS ? getAddress(p[3]) : undefined,
    permissionId: p[4],
  }));
}

/**
 * Pick the governance token address out of a plugin's `helpers` array.
 * Aragon convention: single-element helpers → that element is the token;
 * multi-element helpers → token sits at the last index. Returns undefined
 * for empty / falsy entries.
 */
export function tokenFromHelpers(helpers: readonly string[]): `0x${string}` | undefined {
  if (helpers.length === 1 && helpers[0]) return helpers[0] as `0x${string}`;
  if (helpers.length >= 2 && helpers[helpers.length - 1]) return helpers[helpers.length - 1] as `0x${string}`;
  return undefined;
}

/**
 * Walk the raw permissions tuple array and return the `condition` address
 * attached to a CREATE_PROPOSAL_PERMISSION grant. Returns undefined when
 * the permission isn't present or its condition is the zero address
 * (unconditional grant — every member can create proposals).
 *
 * Used at install-prepared time to populate `Plugin.conditionAddress` so
 * consumers can resolve "who can create proposals" without re-walking the
 * full permissions blob.
 */
export function findProposalConditionAddress(raw: readonly RawPermission[] | undefined): string | undefined {
  if (!raw) return undefined;
  for (const p of raw) {
    const condition = p[3];
    const permissionId = p[4];
    if (permissionId === CREATE_PROPOSAL_PERMISSION_ID && condition && condition !== ZERO_ADDRESS) {
      return getAddress(condition);
    }
  }
  return undefined;
}

/**
 * Slug roots per interface type — kept consistent with legacy `IPluginSlug`
 * so URLs minted by the legacy backend keep working. SPP is `core` for
 * historical reasons (legacy treated SPP as the DAO's "core process").
 */
const SLUG_ROOT: Partial<Record<PluginInterfaceType, string>> = {
  [PluginInterfaceType.LockToVote]: "locktovote",
  [PluginInterfaceType.TokenVoting]: "tokenvoting",
  [PluginInterfaceType.AddresslistVoting]: "tokenvoting",
  [PluginInterfaceType.Multisig]: "multisig",
  [PluginInterfaceType.Admin]: "admin",
  [PluginInterfaceType.Gauge]: "gauge",
  [PluginInterfaceType.Spp]: "core",
  [PluginInterfaceType.CapitalDistributor]: "capitalDistributor",
};

/**
 * Deterministic, collision-resistant slug for a plugin URL. Shape:
 * `<root>-<6-hex-suffix>` where the suffix is the last 6 hex chars of the
 * checksummed plugin address (lowercased). Deterministic = no DB
 * round-trip needed; collision-resistant = 24 bits of uniqueness inside
 * the same interface-type bucket within a single DAO.
 *
 * Falls back to `plugin-<6-hex>` for unknown interface types so every
 * plugin still gets a slug.
 */
export function pluginSlug(interfaceType: PluginInterfaceType, pluginAddress: string): string {
  const root = SLUG_ROOT[interfaceType] ?? "plugin";
  const suffix = pluginAddress.slice(-6).toLowerCase();
  return `${root}-${suffix}`;
}

const PROCESS_TYPES: ReadonlySet<PluginInterfaceType> = new Set([
  PluginInterfaceType.Multisig,
  PluginInterfaceType.TokenVoting,
  PluginInterfaceType.AddresslistVoting,
  PluginInterfaceType.LockToVote,
  PluginInterfaceType.Admin,
  PluginInterfaceType.Spp,
]);

const BODY_TYPES: ReadonlySet<PluginInterfaceType> = new Set([
  PluginInterfaceType.Multisig,
  PluginInterfaceType.TokenVoting,
  PluginInterfaceType.AddresslistVoting,
  PluginInterfaceType.LockToVote,
  PluginInterfaceType.Admin,
]);

const POLICY_TYPES: ReadonlySet<PluginInterfaceType> = new Set([
  PluginInterfaceType.Router,
  PluginInterfaceType.Claimer,
]);

/**
 * Derive the role flags from a plugin's interfaceType. Pure mapping —
 * doesn't depend on SPP context (a TokenVoting plugin is a body whether
 * it sits under an SPP or stand-alone). Mirrors legacy `Plugin.isProcess`
 * / `isBody` / `isPolicy`.
 */
export function pluginRoleFlags(interfaceType: PluginInterfaceType): {
  isProcess: boolean;
  isBody: boolean;
  isPolicy: boolean;
} {
  return {
    isProcess: PROCESS_TYPES.has(interfaceType),
    isBody: BODY_TYPES.has(interfaceType),
    isPolicy: POLICY_TYPES.has(interfaceType),
  };
}
