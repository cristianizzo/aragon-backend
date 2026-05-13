import { indexer } from "envio";
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

const llo = logger.logMeta.bind(null, { service: "handlers:Permission" });

// Register condition addresses so subsequent ExecuteSelectorCondition events
// (SelectorAllowed / NativeTransfersAllowed / ...) get routed to our handlers.
indexer.contractRegister(
  { contract: "DAO", event: "Granted" },
  async ({ event, context }) => {
    const condition = event.params.condition;
    if (!condition || condition === ZERO_ADDRESS) return;
    const checksummed = getAddress(condition);
    if (PRECOMPILE_ADDRESSES.has(checksummed)) return;
    context.chain.ExecuteSelectorCondition.add(checksummed);
  },
);

indexer.onEvent(
  { contract: "DAO", event: "Granted" },
  async ({ event, context }) => {
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

    if (conditionAddress) {
      const targetPlugin = await context.Plugin.get(pluginId(chainId, whereAddress));
      if (targetPlugin && targetPlugin.conditionAddress !== conditionAddress) {
        context.Plugin.set({ ...targetPlugin, conditionAddress });
      }
    }

    if (event.params.permissionId === MINT_PERMISSION_ID) {
      const token = await context.Token.get(tokenId(chainId, whereAddress));
      if (token && !token.mintableByDao) {
        context.Token.set({ ...token, mintableByDao: true });
        logger.debug("Token mintableByDao flipped on", llo({ id: token.id, daoAddress }));
      }
    }

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
        if (!existing) {
          const dao = await context.Dao.get(plugin.dao_id);
          if (dao) context.Dao.set({ ...dao, memberCount: dao.memberCount + 1 });
        }
        await addMember(context, { address: whoAddress, blockNumber: event.block.number });
        logger.debug("Admin member granted", llo({ pluginAddress: whereAddress, memberAddress: whoAddress, daoAddress }));
      }
    }

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
  },
);

indexer.onEvent(
  { contract: "DAO", event: "Revoked" },
  async ({ event, context }) => {
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

    if (event.params.permissionId === EXECUTE_PROPOSAL_PERMISSION_ID) {
      const whoAddress = getAddress(event.params.who);
      const plugin = await context.Plugin.get(pluginId(chainId, whereAddress));
      if (plugin && plugin.interfaceType === PluginInterfaceType.Admin) {
        const memberKey = pluginMemberId(chainId, whereAddress, whoAddress);
        const existing = await context.PluginMember.get(memberKey);
        context.PluginMember.deleteUnsafe(memberKey);
        if (existing) {
          const dao = await context.Dao.get(plugin.dao_id);
          if (dao && dao.memberCount > 0) {
            context.Dao.set({ ...dao, memberCount: dao.memberCount - 1 });
          }
        }
        logger.debug("Admin member revoked", llo({ pluginAddress: whereAddress, memberAddress: whoAddress, daoAddress }));
      }
    }

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
  },
);
