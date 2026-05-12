/**
 * Typed constant mirrors of the schema enums (`PluginStatus`, `ProposalStatus`,
 * `GaugeStatus`, `PluginInterfaceType`). The values must stay byte-identical
 * to the schema literals — the schema is the source of truth and these
 * constants exist only for autocomplete + find-usages in handler code.
 */

export const PluginStatus = {
  PreInstall: "preInstall",
  Installed: "installed",
  Updated: "updated",
  Uninstalled: "uninstalled",
  Abandoned: "abandoned",
} as const;
export type PluginStatus = (typeof PluginStatus)[keyof typeof PluginStatus];

export const ProposalStatus = {
  Active: "Active",
  Succeeded: "Succeeded",
  Defeated: "Defeated",
  Executed: "Executed",
  Canceled: "Canceled",
} as const;
export type ProposalStatus = (typeof ProposalStatus)[keyof typeof ProposalStatus];

export const GaugeStatus = {
  Active: "Active",
  Deactivated: "Deactivated",
} as const;
export type GaugeStatus = (typeof GaugeStatus)[keyof typeof GaugeStatus];

export const PermissionEvent = {
  Granted: "Granted",
  Revoked: "Revoked",
} as const;
export type PermissionEvent = (typeof PermissionEvent)[keyof typeof PermissionEvent];

// Tag for `PluginSetupLog.event`. Schema field is `String!` (no enum), but
// the value space is closed — these six names cover every PluginSetupProcessor
// lifecycle event we record.
export const PluginSetupEvent = {
  InstallationPrepared: "InstallationPrepared",
  InstallationApplied: "InstallationApplied",
  UpdatePrepared: "UpdatePrepared",
  UpdateApplied: "UpdateApplied",
  UninstallationPrepared: "UninstallationPrepared",
  UninstallationApplied: "UninstallationApplied",
} as const;
export type PluginSetupEvent = (typeof PluginSetupEvent)[keyof typeof PluginSetupEvent];

export const TransactionSide = {
  Deposit: "deposit",
  Withdraw: "withdraw",
} as const;
export type TransactionSide = (typeof TransactionSide)[keyof typeof TransactionSide];

export const TransactionType = {
  NativeToken: "nativeToken",
  Erc20: "erc20",
  Erc721: "erc721",
  Erc1155: "erc1155",
} as const;
export type TransactionType = (typeof TransactionType)[keyof typeof TransactionType];

export const TokenType = {
  NativeToken: "nativeToken",
  Erc20: "erc20",
  Erc721: "erc721",
} as const;
export type TokenType = (typeof TokenType)[keyof typeof TokenType];

export const ClockMode = {
  Blocknumber: "blocknumber",
  Timestamp: "timestamp",
} as const;
export type ClockMode = (typeof ClockMode)[keyof typeof ClockMode];

/**
 * Parse the raw IERC6372 `CLOCK_MODE()` return value into our enum.
 * Spec values: `"mode=blocknumber"` (default), `"mode=timestamp&from=default"`.
 */
export function parseClockMode(raw: string | undefined): ClockMode | undefined {
  if (!raw) return undefined;
  if (raw.includes("blocknumber")) return ClockMode.Blocknumber;
  if (raw.includes("timestamp")) return ClockMode.Timestamp;
  return undefined;
}

export const PluginInterfaceType = {
  TokenVoting: "tokenVoting",
  Multisig: "multisig",
  Admin: "admin",
  AddresslistVoting: "addresslistVoting",
  Spp: "spp",
  LockToVote: "lockToVote",
  Gauge: "gauge",
  CapitalDistributor: "capitalDistributor",
  Router: "router",
  Claimer: "claimer",
  Unknown: "unknown",
} as const;
export type PluginInterfaceType = (typeof PluginInterfaceType)[keyof typeof PluginInterfaceType];

/**
 * Activity that updates a `PluginActivityMetric` row — currently we only
 * distinguish proposal-created vs vote-cast contributions toward
 * per-member-per-plugin counters.
 */
export const PluginActivityType = {
  Vote: "vote",
  Proposal: "proposal",
} as const;
export type PluginActivityType = (typeof PluginActivityType)[keyof typeof PluginActivityType];

/**
 * GaugeVoter emits two kinds of voting-power changes per (voter, gauge,
 * epoch): casting a fresh vote (`Voted` event) and clearing it (`Reset`
 * event). The `gaugeVoteId` helper appends this to disambiguate them.
 */
export const GaugeVoteKind = {
  Vote: "vote",
  Reset: "reset",
} as const;
export type GaugeVoteKind = (typeof GaugeVoteKind)[keyof typeof GaugeVoteKind];
