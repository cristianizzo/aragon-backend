import { DAO } from "generated";
import { getAddress } from "viem";
import {
  EXECUTE_PERMISSION_ID,
  EXECUTE_PROPOSAL_PERMISSION_ID,
  MINT_PERMISSION_ID,
  PRECOMPILE_ADDRESSES,
  ZERO_ADDRESS,
} from "../constants";
import { PermissionEvent, PluginInterfaceType, PluginStatus } from "../enums";
import logger from "../helpers/logger";
import { addMember } from "../services/member";
import { setPluginStatus } from "../services/pluginInstall";
import { daoId, eventLogId, pluginId, pluginMemberId, tokenId } from "../utils/ids";

/**
 * Permission lifecycle for DAOs — `DAO.Granted` and `DAO.Revoked`. Lives in
 * its own file (separate from `DAO.ts`) because the events from the DAO
 * contract span unrelated domains: this file owns the permission domain
 * (DaoPermission rows + cross-flips that DEPEND on permissions). Mirrors the
 * legacy `app-backend/src/handlers/permissionHandler.ts` organisation.
 *
 * Cross-flips driven from here:
 *   - `Token.mintableByDao` — flipped on/off when MINT_PERMISSION is granted/
 *     revoked on a token we already track (forward-flip; addToken does the
 *     reverse direction at first sight).
 *   - `PluginMember` for admin plugins — written/deleted when
 *     EXECUTE_PROPOSAL_PERMISSION is granted/revoked on a plugin whose row
 *     exists with `interfaceType: admin`. Mirrors legacy
 *     `permissionHandler.handleForAdminPlugin`.
 *
 * Also owns the `contractRegister` for ExecuteSelectorCondition: when a
 * condition address is attached to a Granted permission, register it for
 * indexing so its subsequent events (SelectorAllowed / NativeTransfersAllowed
 * / etc.) get routed to our handlers.
 */

const llo = logger.logMeta.bind(null, { service: "handlers:Permission" });

// Register condition addresses so subsequent ExecuteSelectorCondition events
// (SelectorAllowed / NativeTransfersAllowed / ...) get routed to our handlers.
DAO.Granted.contractRegister(({ event, context }) => {
  const condition = event.params.condition;
  if (!condition || condition === ZERO_ADDRESS) return;
  const checksummed = getAddress(condition);
  if (PRECOMPILE_ADDRESSES.has(checksummed)) return;
  context.addExecuteSelectorCondition(checksummed);
});

DAO.Granted.handler(async ({ event, context }) => {
  const { chainId } = event;
  const daoAddress = getAddress(event.srcAddress);
  const dao_id = daoId(chainId, daoAddress);

  const id = eventLogId(chainId, event.transaction.hash, event.logIndex);
  const conditionAddress =
    event.params.condition && event.params.condition !== ZERO_ADDRESS ? getAddress(event.params.condition) : undefined;

  const whereAddress = getAddress(event.params.where);

  context.DaoPermission.set({
    id,
    chainId,
    dao_id,
    daoAddress,
    blockNumber: event.block.number,
    transactionIndex: event.transaction.transactionIndex,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    permissionId: event.params.permissionId,
    whoAddress: getAddress(event.params.who),
    whereAddress,
    event: PermissionEvent.Granted,
    conditionAddress,
  });

  logger.debug(
    "DaoPermission created",
    llo({
      id,
      event: PermissionEvent.Granted,
      dao_id,
      permissionId: event.params.permissionId,
      transactionHash: event.transaction.hash,
    }),
  );

  // Latest-condition denorm on Plugin: if `where` is one of our indexed
  // plugins and this Granted carries a non-zero condition, stash it on
  // `Plugin.conditionAddress`. Mirrors legacy
  // `pluginHandler.updateConditionAddress` — it tracks the most recent
  // condition flipped onto the plugin so a single query can answer
  // "what condition is currently gating this plugin?".
  if (conditionAddress) {
    const targetPlugin = await context.Plugin.get(pluginId(chainId, whereAddress));
    if (targetPlugin && targetPlugin.conditionAddress !== conditionAddress) {
      context.Plugin.set({ ...targetPlugin, conditionAddress });
    }
  }

  // Forward-flip: if the granted permission is MINT_PERMISSION on a token we
  // already track, mark Token.mintableByDao=true. The backward direction
  // (token discovered after the grant) is handled in `addToken` via DB lookup.
  if (event.params.permissionId === MINT_PERMISSION_ID) {
    const token = await context.Token.get(tokenId(chainId, whereAddress));
    if (token && !token.mintableByDao) {
      context.Token.set({ ...token, mintableByDao: true });
      logger.debug("Token mintableByDao flipped on", llo({ id: token.id, daoAddress }));
    }
  }

  // Admin-member discovery: EXECUTE_PROPOSAL_PERMISSION on an admin plugin
  // means `who` is now allowed to execute proposals through that admin —
  // i.e. an admin member. Mirrors legacy `permissionHandler.handleForAdminPlugin`
  // which writes the member only after confirming the plugin row exists and
  // is of admin type. We do the same: lookup the Plugin at `where`, only
  // proceed if its `interfaceType` is admin.
  if (event.params.permissionId === EXECUTE_PROPOSAL_PERMISSION_ID) {
    const whoAddress = getAddress(event.params.who);
    const plugin = await context.Plugin.get(pluginId(chainId, whereAddress));
    if (plugin && plugin.interfaceType === PluginInterfaceType.Admin) {
      const memberKey = pluginMemberId(chainId, whereAddress, whoAddress);
      const existing = await context.PluginMember.get(memberKey);
      context.PluginMember.set({
        id: memberKey,
        chainId,
        plugin_id: plugin.id,
        pluginAddress: whereAddress,
        memberAddress: whoAddress,
        daoAddress: plugin.daoAddress,
      });
      // Only bump Dao.memberCount on the first time we see this admin —
      // duplicate Granted events for the same (plugin, who) shouldn't
      // double-count.
      if (!existing) {
        const dao = await context.Dao.get(plugin.dao_id);
        if (dao) context.Dao.set({ ...dao, memberCount: dao.memberCount + 1 });
      }
      await addMember(context, { address: whoAddress, blockNumber: event.block.number });
      logger.debug("Admin member granted", llo({ pluginAddress: whereAddress, memberAddress: whoAddress, daoAddress }));
    }
  }

  // Fallback re-install: a DAO grants EXECUTE_PERMISSION to a plugin
  // (`who` = plugin) outside the standard PSP flow. If the plugin row
  // exists and is currently `Uninstalled`, treat the grant as a re-install.
  // Standard `applyInstallation` flows also emit this Granted event but
  // only AFTER `InstallationApplied` (logIndex order), so by then the
  // plugin is already `Installed` and this branch no-ops.
  if (event.params.permissionId === EXECUTE_PERMISSION_ID) {
    const pluginAddress = getAddress(event.params.who);
    const plugin = await context.Plugin.get(pluginId(chainId, pluginAddress));
    if (plugin && plugin.status === PluginStatus.Uninstalled && plugin.daoAddress === daoAddress) {
      await setPluginStatus(context, {
        chainId,
        pluginAddress,
        status: PluginStatus.Installed,
        blockNumber: event.block.number,
      });
      logger.debug(
        "Plugin re-installed via EXECUTE_PERMISSION grant",
        llo({ pluginAddress, daoAddress, transactionHash: event.transaction.hash }),
      );
    }
  }
});

DAO.Revoked.handler(async ({ event, context }) => {
  const { chainId } = event;
  const daoAddress = getAddress(event.srcAddress);
  const dao_id = daoId(chainId, daoAddress);
  const whereAddress = getAddress(event.params.where);

  const id = eventLogId(chainId, event.transaction.hash, event.logIndex);

  context.DaoPermission.set({
    id,
    chainId,
    dao_id,
    daoAddress,
    blockNumber: event.block.number,
    transactionIndex: event.transaction.transactionIndex,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    permissionId: event.params.permissionId,
    whoAddress: getAddress(event.params.who),
    whereAddress,
    event: PermissionEvent.Revoked,
    conditionAddress: undefined,
  });

  logger.debug(
    "DaoPermission created",
    llo({
      id,
      event: PermissionEvent.Revoked,
      dao_id,
      permissionId: event.params.permissionId,
      transactionHash: event.transaction.hash,
    }),
  );

  // Mirror the forward-flip in Granted: when MINT_PERMISSION is revoked, the
  // Token may no longer be mintable by ANY DAO. Recompute by looking at the
  // full permission history at this address — only flip mintableByDao=false
  // if NO Granted MINT_PERMISSION remains. (DAO_A could grant, DAO_B could
  // revoke a different DAO's grant, etc. — DaoPermission rows are per-event,
  // so we re-derive from current state.)
  if (event.params.permissionId === MINT_PERMISSION_ID) {
    const token = await context.Token.get(tokenId(chainId, whereAddress));
    if (token?.mintableByDao) {
      const allPerms = await context.DaoPermission.getWhere({
        whereAddress: { _eq: whereAddress },
      });
      const stillMintable = allPerms.some(
        (p) => p.permissionId === MINT_PERMISSION_ID && p.event === PermissionEvent.Granted,
      );
      if (!stillMintable) {
        context.Token.set({ ...token, mintableByDao: false });
        logger.debug("Token mintableByDao flipped off", llo({ id: token.id, daoAddress }));
      }
    }
  }

  // Admin-member revoke: drop the PluginMember row when EXECUTE_PROPOSAL_PERMISSION
  // is revoked from an address on an admin plugin. We don't decrement Dao.memberCount
  // here — the Member row in the Member table stays (members are address-scoped, not
  // plugin-scoped) so historical activity is preserved.
  if (event.params.permissionId === EXECUTE_PROPOSAL_PERMISSION_ID) {
    const whoAddress = getAddress(event.params.who);
    const plugin = await context.Plugin.get(pluginId(chainId, whereAddress));
    if (plugin && plugin.interfaceType === PluginInterfaceType.Admin) {
      const memberKey = pluginMemberId(chainId, whereAddress, whoAddress);
      const existing = await context.PluginMember.get(memberKey);
      context.PluginMember.deleteUnsafe(memberKey);
      // Only decrement Dao.memberCount when there was actually a row to
      // remove — duplicate Revoked events shouldn't drive the count negative.
      if (existing) {
        const dao = await context.Dao.get(plugin.dao_id);
        if (dao && dao.memberCount > 0) {
          context.Dao.set({ ...dao, memberCount: dao.memberCount - 1 });
        }
      }
      logger.debug("Admin member revoked", llo({ pluginAddress: whereAddress, memberAddress: whoAddress, daoAddress }));
    }
  }

  // Fallback uninstall: EXECUTE_PERMISSION revoke on a still-active plugin
  // outside the standard PSP flow. Plugin status flips to `Uninstalled` and
  // the standard cascade (`services/pluginInstall.ts:cascadeUninstall`)
  // takes over — settings inactivated, sub-plugins reconsidered. Standard
  // `applyUninstallation` already moved the plugin to `Uninstalled` before
  // this Revoked event fires (logIndex order), so this branch no-ops in
  // that case.
  if (event.params.permissionId === EXECUTE_PERMISSION_ID) {
    const pluginAddress = getAddress(event.params.who);
    const plugin = await context.Plugin.get(pluginId(chainId, pluginAddress));
    if (
      plugin &&
      plugin.daoAddress === daoAddress &&
      (plugin.status === PluginStatus.Installed || plugin.status === PluginStatus.Updated)
    ) {
      await setPluginStatus(context, {
        chainId,
        pluginAddress,
        status: PluginStatus.Uninstalled,
        blockNumber: event.block.number,
      });
      logger.debug(
        "Plugin uninstalled via EXECUTE_PERMISSION revoke",
        llo({ pluginAddress, daoAddress, transactionHash: event.transaction.hash }),
      );
    }
  }
});
