import type { HandlerContext } from "generated";
import { getAddress } from "viem";
import { multisig as multisigAbi, tokenVoting as tokenVotingAbi } from "../abis";
import { fetchTxReceiptLogs } from "../effects/txReceipt";
import { PluginInterfaceType, type PluginSetupEvent, PluginStatus } from "../enums";
import { detectPluginByBytecode } from "../utils/bytecodeDetector";
import { decodeLogsForEvent, parseReceiptLogs } from "../utils/eventDecode";
import { daoId, pluginId, pluginMemberId, pluginRepoId, pluginSetupLogId, settingId } from "../utils/ids";
import { findProposalConditionAddress, pluginRoleFlags, pluginSlug, tokenFromHelpers } from "../utils/plugin";
import { discoverLockManagerAddress, discoverVeContracts } from "../utils/veDiscovery";
import { addMember } from "./member";
import { addToken } from "./token";

/**
 * Plugin-install lifecycle service — owns every DB write for the
 * `PluginSetupLog` audit table and the `Plugin` row's status transitions
 * driven by `PluginSetupProcessor` events.
 *
 * The handler file routes Installation / Update / Uninstallation events
 * (Prepared + Applied) here so the per-status `Plugin.set` patches and the
 * setup-log shape live in one place.
 */

// Plugin types whose helpers array carries a governance token / IVotesAdapter
// at `helpers[last]`. Extending this set adds `Plugin.tokenAddress` and
// triggers `addToken(isGovernance: true)` for that plugin's installations.
const TOKEN_BEARING_PLUGINS: ReadonlySet<PluginInterfaceType> = new Set([
  PluginInterfaceType.TokenVoting,
  PluginInterfaceType.AddresslistVoting,
  PluginInterfaceType.LockToVote,
  PluginInterfaceType.Gauge,
]);

// Plugins that have no follow-up "settings" event to flip `isSupported`
// later (unlike multisig/tokenVoting/spp/lockToVote, which flip it from
// their own settings handlers). For these we flip on InstallationApplied.
const FLIP_SUPPORTED_ON_INSTALL: ReadonlySet<PluginInterfaceType> = new Set([
  PluginInterfaceType.Admin,
  PluginInterfaceType.Gauge,
  PluginInterfaceType.CapitalDistributor,
]);

interface LogPreparedArgs {
  chainId: number;
  event: PluginSetupEvent;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  daoAddress: string;
  pluginAddress: string;
  preparedSetupId: string;
  pluginSetupRepo: string;
  sender: string;
  release: number;
  build: number;
  permissions: unknown;
}

export function logPluginSetupPrepared(context: HandlerContext, args: LogPreparedArgs): void {
  context.PluginSetupLog.set({
    id: pluginSetupLogId(args.chainId, args.transactionHash, args.logIndex),
    chainId: args.chainId,
    event: args.event,
    blockNumber: args.blockNumber,
    transactionHash: args.transactionHash,
    logIndex: args.logIndex,
    daoAddress: args.daoAddress,
    pluginAddress: args.pluginAddress,
    preparedSetupId: args.preparedSetupId,
    appliedSetupId: undefined,
    pluginSetupRepo: args.pluginSetupRepo,
    sender: args.sender,
    release: args.release,
    build: args.build,
    permissions: args.permissions,
  });
}

interface LogAppliedArgs {
  chainId: number;
  event: PluginSetupEvent;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
  daoAddress: string;
  pluginAddress: string;
  preparedSetupId: string;
  // Optional: UninstallationApplied carries a preparedSetupId but no
  // appliedSetupId in the OSx event payload.
  appliedSetupId?: string;
}

export function logPluginSetupApplied(context: HandlerContext, args: LogAppliedArgs): void {
  context.PluginSetupLog.set({
    id: pluginSetupLogId(args.chainId, args.transactionHash, args.logIndex),
    chainId: args.chainId,
    event: args.event,
    blockNumber: args.blockNumber,
    transactionHash: args.transactionHash,
    logIndex: args.logIndex,
    daoAddress: args.daoAddress,
    pluginAddress: args.pluginAddress,
    preparedSetupId: args.preparedSetupId,
    appliedSetupId: args.appliedSetupId,
    pluginSetupRepo: undefined,
    sender: undefined,
    release: undefined,
    build: undefined,
    permissions: undefined,
  });
}

interface StubPluginArgs {
  chainId: number;
  daoAddress: string;
  pluginAddress: string;
  pluginSetupRepo: string;
  helpers: readonly string[];
  release: number;
  build: number;
  // Both shapes of the permissions array: `permissions` is the parsed Json
  // blob stored on Plugin; `rawPermissions` is the original event tuple
  // that we walk to extract the proposal-creation condition address.
  permissions: unknown;
  rawPermissions: ReadonlyArray<readonly [bigint | number, string, string, string, string]> | undefined;
  blockNumber: number;
  blockTimestamp: number;
  transactionHash: string;
}

/**
 * Write the initial `Plugin` row on `InstallationPrepared` (status = PreInstall)
 * and register any tokens this plugin carries.
 *
 * Detects `interfaceType` via bytecode, derives the governance `tokenAddress`
 * from the helpers tuple (for token-bearing plugin types), runs the
 * VE-chain discovery to populate `Plugin.votingEscrow`, and registers the
 * governance token + (if VE) the lock NFT as `Token` rows via `addToken`.
 *
 * No-op if a `Plugin` row already exists at `(chainId, pluginAddress)`. A
 * duplicate `InstallationPrepared` for the same plugin shouldn't actually
 * happen in production, but the guard keeps the entity write idempotent.
 */
export async function stubPluginOnInstallPrepared(context: HandlerContext, args: StubPluginArgs): Promise<void> {
  const daoAddress = getAddress(args.daoAddress);
  const pluginAddress = getAddress(args.pluginAddress);
  const dao_id = daoId(args.chainId, daoAddress);

  let interfaceType: PluginInterfaceType = PluginInterfaceType.Unknown;
  try {
    interfaceType = await detectPluginByBytecode(pluginAddress, args.chainId);
  } catch {
    /* keep as unknown */
  }

  const tokenAddress = TOKEN_BEARING_PLUGINS.has(interfaceType) ? tokenFromHelpers(args.helpers) : undefined;

  // Full VE chain discovery (curve / clock / nftLock / underlying), mirroring
  // legacy `findVotingEscrow`. Best-effort — non-VE tokens return null. We
  // re-run the same RPC discovery that contractRegister already executed,
  // because contractRegister can't write entities so the result was lost.
  const ve = tokenAddress ? await discoverVeContracts(tokenAddress, args.chainId).catch(() => null) : null;

  const lockManagerAddress =
    interfaceType === PluginInterfaceType.LockToVote
      ? await discoverLockManagerAddress(pluginAddress, args.chainId).catch(() => null)
      : null;

  const plugin_id = pluginId(args.chainId, pluginAddress);
  const existingPlugin = await context.Plugin.get(plugin_id);
  if (existingPlugin) return;

  // Look up the plugin's repo subdomain (`tokenvoting.plugin.dao.eth` etc.)
  // — populated when `PluginRepoRegistered` fired earlier. Stays null if
  // the repo is unindexed (e.g. for the cross-chain repos we don't sync).
  const repo = await context.PluginRepo.get(pluginRepoId(args.chainId, args.pluginSetupRepo));

  context.Plugin.set({
    id: plugin_id,
    chainId: args.chainId,
    address: pluginAddress,
    dao_id,
    daoAddress,
    interfaceType,
    status: PluginStatus.PreInstall,
    isSupported: false,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    pluginSetupRepo: getAddress(args.pluginSetupRepo),
    release: args.release,
    build: args.build,
    subdomain: repo?.subdomain,
    slug: pluginSlug(interfaceType, pluginAddress),
    ...pluginRoleFlags(interfaceType),
    tokenAddress: tokenAddress ? getAddress(tokenAddress) : undefined,
    votingEscrow: ve ?? undefined,
    // Indexed denorm of `votingEscrow.escrowAddress` so VE handlers can
    // resolve the parent plugin via `Plugin.getWhere({escrowAddress})`
    // — the JSON sub-field isn't queryable as an index.
    escrowAddress: ve?.escrowAddress ? getAddress(ve.escrowAddress) : undefined,
    // `conditionAddress` is the runtime-tracked latest non-zero condition
    // ever Granted for this plugin (maintained by the DAO.Granted handler in
    // `src/handlers/Permission.ts`). Starts undefined at install — mirrors
    // legacy `pluginHandler.updateConditionAddress` lazy population pattern.
    conditionAddress: undefined,
    // Install-time stable condition gating CREATE_PROPOSAL_PERMISSION.
    // Distinct from `conditionAddress` — legacy keeps both, and they often
    // differ (CREATE_PROPOSAL gating vs generic permission gating).
    proposalCreationConditionAddress: findProposalConditionAddress(args.rawPermissions),
    lockManagerAddress: lockManagerAddress ? getAddress(lockManagerAddress) : undefined,
    permissions: args.permissions,
    // Metadata fields populated separately by per-plugin `MetadataSet`
    // handlers (see `src/services/pluginMetadata.ts`).
    metadataUri: undefined,
    name: undefined,
    description: undefined,
    links: undefined,
    processKey: undefined,
    stageNames: undefined,
  });

  if (tokenAddress) {
    // Plugin holds a tokenAddress → this token is used for governance even
    // if its bytecode doesn't expose the standard ERC20Votes selectors.
    await addToken(context, {
      chainId: args.chainId,
      tokenAddress,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
      transactionHash: args.transactionHash,
      isGovernance: true,
    });
  }

  // VE chains expose the lock NFT as a separate ERC-721 — register it so
  // queries for "all tokens in play for this DAO" surface it. Bytecode
  // detection in `fetchTokenMetadata` will mark it as `type: erc721`.
  if (ve?.nftLockAddress) {
    await addToken(context, {
      chainId: args.chainId,
      tokenAddress: ve.nftLockAddress,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
      transactionHash: args.transactionHash,
      isGovernance: true,
    });
  }

  // Backfill events that fired from the just-installed plugin in the same
  // tx — Envio's HyperSync misses these because the plugin address wasn't
  // registered when the block range was pre-fetched (see
  // `effects/txReceipt.ts` for the full rationale).
  await backfillFromInstallTx(context, {
    chainId: args.chainId,
    pluginAddress,
    plugin_id,
    dao_id,
    daoAddress,
    interfaceType,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
  });
}

/**
 * One RPC fetch (cached per tx) gives us every log emitted in the install
 * transaction. We decode the ones we'd otherwise miss:
 *
 *   - `MembersAdded` from Multisig / AddresslistVoting plugins → write
 *     PluginMember rows + bump `Dao.memberCount`.
 *   - `MultisigSettingsUpdated` from Multisig → write the initial
 *     PluginSetting row.
 *   - `VotingSettingsUpdated` from TokenVoting / AddresslistVoting →
 *     write the initial PluginSetting row.
 *
 * LockToVote / SPP / VE settings are emitted user-side post-install (or
 * have their own setup-time discovery), so they don't need this backfill.
 */
async function backfillFromInstallTx(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: `0x${string}`;
    plugin_id: ReturnType<typeof pluginId>;
    dao_id: ReturnType<typeof daoId>;
    daoAddress: `0x${string}`;
    interfaceType: PluginInterfaceType;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
  },
): Promise<void> {
  const isMembershipBased =
    args.interfaceType === PluginInterfaceType.Multisig || args.interfaceType === PluginInterfaceType.AddresslistVoting;
  const isTokenVoting =
    args.interfaceType === PluginInterfaceType.TokenVoting ||
    args.interfaceType === PluginInterfaceType.AddresslistVoting;

  // Skip the receipt fetch entirely when there's nothing to extract — saves
  // an RPC per non-membership / non-voting plugin install.
  if (!isMembershipBased && args.interfaceType !== PluginInterfaceType.Multisig && !isTokenVoting) return;

  const raw = await context.effect(fetchTxReceiptLogs, {
    chainId: args.chainId,
    txHash: args.transactionHash,
  });
  const logs = parseReceiptLogs(raw);
  if (logs.length === 0) return;

  // --- MembersAdded backfill (Multisig + AddresslistVoting) ---
  if (isMembershipBased) {
    const memberEvents = decodeLogsForEvent<{ members: readonly string[] }>({
      logs,
      contractAddress: args.pluginAddress,
      abi: multisigAbi.membersAddedEvent,
      eventName: "MembersAdded",
    });
    let added = 0;
    for (const ev of memberEvents) {
      for (const rawMember of ev.members) {
        const memberAddress = getAddress(rawMember);
        const memberKey = pluginMemberId(args.chainId, args.pluginAddress, memberAddress);
        if (await context.PluginMember.get(memberKey)) continue;
        context.PluginMember.set({
          id: memberKey,
          chainId: args.chainId,
          plugin_id: args.plugin_id,
          pluginAddress: args.pluginAddress,
          memberAddress,
          daoAddress: args.daoAddress,
        });
        await addMember(context, { address: memberAddress, blockNumber: args.blockNumber });
        added++;
      }
    }
    if (added > 0) {
      const dao = await context.Dao.get(args.dao_id);
      if (dao) context.Dao.set({ ...dao, memberCount: dao.memberCount + added });
    }
  }

  // --- Initial settings backfill ---
  if (args.interfaceType === PluginInterfaceType.Multisig) {
    const settingsEvents = decodeLogsForEvent<{ onlyListed: boolean; minApprovals: number | bigint }>({
      logs,
      contractAddress: args.pluginAddress,
      abi: multisigAbi.multisigSettingsUpdatedEvent,
      eventName: "MultisigSettingsUpdated",
    });
    const ev = settingsEvents[0];
    if (ev) {
      context.PluginSetting.set({
        id: settingId(args.chainId, args.pluginAddress, args.transactionHash),
        chainId: args.chainId,
        plugin_id: args.plugin_id,
        pluginAddress: args.pluginAddress,
        blockNumber: args.blockNumber,
        blockTimestamp: args.blockTimestamp,
        transactionHash: args.transactionHash,
        onlyListed: ev.onlyListed,
        minApprovals: Number(ev.minApprovals),
        votingMode: undefined,
        supportThreshold: undefined,
        minParticipation: undefined,
        minApprovalRatio: undefined,
        minDuration: undefined,
        minProposerVotingPower: undefined,
        stages: undefined,
        policy: undefined,
        votingEscrow: undefined,
        inactiveAtBlockNumber: undefined,
      });
    }
  }

  if (isTokenVoting) {
    const settingsEvents = decodeLogsForEvent<{
      votingMode: number | bigint;
      supportThreshold: bigint;
      minParticipation: bigint;
      minDuration: bigint;
      minProposerVotingPower: bigint;
    }>({
      logs,
      contractAddress: args.pluginAddress,
      abi: tokenVotingAbi.votingSettingsUpdatedEvent,
      eventName: "VotingSettingsUpdated",
    });
    const ev = settingsEvents[0];
    if (ev) {
      context.PluginSetting.set({
        id: settingId(args.chainId, args.pluginAddress, args.transactionHash),
        chainId: args.chainId,
        plugin_id: args.plugin_id,
        pluginAddress: args.pluginAddress,
        blockNumber: args.blockNumber,
        blockTimestamp: args.blockTimestamp,
        transactionHash: args.transactionHash,
        onlyListed: undefined,
        minApprovals: undefined,
        votingMode: Number(ev.votingMode),
        supportThreshold: ev.supportThreshold,
        minParticipation: ev.minParticipation,
        minApprovalRatio: undefined,
        minDuration: ev.minDuration,
        minProposerVotingPower: ev.minProposerVotingPower,
        stages: undefined,
        policy: undefined,
        votingEscrow: undefined,
        inactiveAtBlockNumber: undefined,
      });
    }
  }
}

interface SetPluginStatusArgs {
  chainId: number;
  pluginAddress: string;
  status: PluginStatus;
  // Block at which the status change happened — stamped on
  // `PluginSetting.inactiveAtBlockNumber` during the uninstall cascade.
  blockNumber: number;
}

/**
 * Patch the `Plugin.status` field after Installation / Update / Uninstallation
 * is applied. On `Installed`, also flips `isSupported` for plugin types
 * that have no follow-up settings event (see `FLIP_SUPPORTED_ON_INSTALL`).
 * On `Uninstalled`, cascades into sub-plugin abandonment via
 * `cascadeUninstall`. No-op if the plugin row is missing.
 */
export async function setPluginStatus(context: HandlerContext, args: SetPluginStatusArgs): Promise<void> {
  const pluginAddress = getAddress(args.pluginAddress);
  const plugin = await context.Plugin.get(pluginId(args.chainId, pluginAddress));
  if (!plugin) return;

  const isSupported =
    args.status === PluginStatus.Installed && FLIP_SUPPORTED_ON_INSTALL.has(plugin.interfaceType)
      ? true
      : plugin.isSupported;

  context.Plugin.set({ ...plugin, status: args.status, isSupported });

  if (args.status === PluginStatus.Uninstalled) {
    await cascadeUninstall(context, {
      chainId: args.chainId,
      parentAddress: pluginAddress,
      daoAddress: plugin.daoAddress,
      blockNumber: args.blockNumber,
    });
  }
}

/**
 * Cascade an uninstall to sub-plugins and active settings.
 *
 * When a parent (typically an SPP) is uninstalled:
 *
 *  1. Inactivate the parent's own active `PluginSetting` rows (stamps
 *     `inactiveAtBlockNumber` so consumers know which row applied to
 *     historical proposals before the uninstall).
 *  2. Drop the parent's `PluginParentLink` rows in this DAO.
 *  3. For each former child, check whether any *other* parent still
 *     references it inside the same DAO. If not, the child is orphaned
 *     and we mark it `Abandoned`.
 *
 * The "any other parent" check matters because a sub-plugin can sit
 * under multiple SPPs (see `project_plugin_relationships.md`). Marking
 * abandonment without that check would wrongly disable a child that
 * still has live parents.
 */
async function cascadeUninstall(
  context: HandlerContext,
  args: { chainId: number; parentAddress: string; daoAddress: string; blockNumber: number },
): Promise<void> {
  const settings = await context.PluginSetting.getWhere({ pluginAddress: { _eq: args.parentAddress } });
  for (const setting of settings) {
    if (setting.inactiveAtBlockNumber !== undefined) continue;
    context.PluginSetting.set({ ...setting, inactiveAtBlockNumber: args.blockNumber });
  }

  const links = await context.PluginParentLink.getWhere({
    parentPluginAddress: { _eq: args.parentAddress },
  });

  // DAO-scope guard: a parent address can theoretically appear in multiple
  // DAOs (same contract address re-installed). Only act on links for this
  // DAO; siblings in other DAOs keep their relationships intact.
  const inThisDao = links.filter((l) => l.daoAddress === args.daoAddress);
  if (inThisDao.length === 0) return;

  const childAddresses = new Set<string>();
  for (const link of inThisDao) {
    context.PluginParentLink.deleteUnsafe(link.id);
    childAddresses.add(link.childPluginAddress);
  }

  for (const childAddress of childAddresses) {
    // Any remaining parent in the same DAO? If yes, the child is still
    // attached to a live SPP and stays as it is.
    const remaining = await context.PluginParentLink.getWhere({
      childPluginAddress: { _eq: childAddress },
    });
    const hasOtherParentInDao = remaining.some((l) => l.daoAddress === args.daoAddress);
    if (hasOtherParentInDao) continue;

    const child = await context.Plugin.get(pluginId(args.chainId, childAddress));
    if (!child) continue;
    // Only demote children that were live. Already-uninstalled or
    // already-abandoned children stay where they are.
    if (child.status !== PluginStatus.Installed && child.status !== PluginStatus.Updated) continue;

    context.Plugin.set({ ...child, status: PluginStatus.Abandoned });
  }
}
