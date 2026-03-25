/**
 * Entity ID builders.
 *
 * All builders take a single typed object — TypeScript catches wrong/missing params.
 * All addresses are EIP-55 checksummed via viem's getAddress() for consistency.
 * All IDs are prefixed with chainId for multichain uniqueness.
 *
 * Strategies:
 *   State (upsert)       — business-key based, one record per identity
 *   Versioned            — txHash in ID, new record per lifecycle event
 *   Event-sourced        — txHash+txIndex+logIndex, append-only, idempotent
 *   Hybrid               — business-key for lookups, but carries txHash for creation uniqueness
 */

import { getAddress } from "viem";

/** Normalize address to EIP-55 checksum format. */
const addr = (a: string) => getAddress(a);

// =============================================================================
// Event-sourced (append-only — one record per on-chain event)
// Used for: PluginSetupLog, DaoPermission, PluginSetting, DelegateChangedEvent,
//           DelegateVotesChangedEvent, Vote, GaugeVote, TokenDelegation,
//           SelectorPermission, NativeTransferPermission, Lock
// =============================================================================

export const eventId = (p: {
  chainId: number;
  txHash: string;
  txIndex: number;
  logIndex: number;
}) => `${p.chainId}-${p.txHash}-${p.txIndex}-${p.logIndex}`;

// =============================================================================
// State entities (upsert — one record per identity, updated in place)
// =============================================================================

export const daoId = (p: {
  chainId: number;
  daoAddress: string;
}) => `${p.chainId}-${addr(p.daoAddress)}`;

export const tokenId = (p: {
  chainId: number;
  tokenAddress: string;
}) => `${p.chainId}-${addr(p.tokenAddress)}`;

export const pluginMemberId = (p: {
  chainId: number;
  pluginAddress: string;
  memberAddress: string;
}) => `${p.chainId}-${addr(p.pluginAddress)}-${addr(p.memberAddress)}`;

export const tokenMemberId = (p: {
  chainId: number;
  tokenAddress: string;
  memberAddress: string;
}) => `${p.chainId}-${addr(p.tokenAddress)}-${addr(p.memberAddress)}`;

export const lockToVoteMemberId = (p: {
  chainId: number;
  lockManagerAddress: string;
  memberAddress: string;
}) => `${p.chainId}-${addr(p.lockManagerAddress)}-${addr(p.memberAddress)}`;

export const gaugeId = (p: {
  chainId: number;
  pluginAddress: string;
  gaugeAddress: string;
}) => `${p.chainId}-${addr(p.pluginAddress)}-${addr(p.gaugeAddress)}`;

export const campaignId = (p: {
  chainId: number;
  pluginAddress: string;
  campaignId: string;
}) => `${p.chainId}-${addr(p.pluginAddress)}-${p.campaignId}`;

export const pluginActivityMetricId = (p: {
  chainId: number;
  pluginAddress: string;
  memberAddress: string;
}) => `${p.chainId}-${addr(p.pluginAddress)}-${addr(p.memberAddress)}`;

// =============================================================================
// Versioned entities (txHash in ID — new record per lifecycle event)
// =============================================================================

export const pluginId = (p: {
  chainId: number;
  txHash: string;
  pluginAddress: string;
}) => `${p.chainId}-${p.txHash}-${addr(p.pluginAddress)}`;

export const pluginRepoId = (p: {
  chainId: number;
  txHash: string;
  txIndex: number;
  logIndex: number;
}) => `${p.chainId}-${p.txHash}-${p.txIndex}-${p.logIndex}`;

// =============================================================================
// Hybrid entities (business-key for lookups, txHash for creation uniqueness)
// Created once by ProposalCreated, updated by Executed/Canceled.
// Lookups by pluginAddress+proposalIndex via getWhere.
// =============================================================================

export const proposalId = (p: {
  chainId: number;
  txHash: string;
  pluginAddress: string;
  proposalIndex: string;
}) => `${p.chainId}-${p.txHash}-${addr(p.pluginAddress)}-${p.proposalIndex}`;

// =============================================================================
// Composite event-sourced with domain context
// =============================================================================

export const transferId = (p: {
  chainId: number;
  daoAddress: string;
  txHash: string;
  type: string;
  logIndex?: number;
  actionIndex?: number;
}) => {
  const base = `${p.chainId}-${addr(p.daoAddress)}-${p.txHash}-${p.type}`;
  if (p.actionIndex !== undefined) return `${base}-action${p.actionIndex}`;
  if (p.logIndex !== undefined) return `${base}-${p.logIndex}`;
  return base;
};

export const lockId = (p: {
  chainId: number;
  txHash: string;
  txIndex: number;
  logIndex: number;
  escrowAddress: string;
  tokenId: string;
}) => `${p.chainId}-${p.txHash}-${p.txIndex}-${p.logIndex}-${addr(p.escrowAddress)}-${p.tokenId}`;
