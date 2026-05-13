import { indexer } from "envio";
import { getAddress } from "viem";
import { PluginInterfaceType, PluginSetupEvent, PluginStatus } from "../enums";
import {
  logPluginSetupApplied,
  logPluginSetupPrepared,
  setPluginStatus,
  stubPluginOnInstallPrepared,
} from "../services/pluginInstall";
import { detectPluginByBytecode } from "../utils/bytecodeDetector";
import { daoId } from "../utils/ids";
import { parsePermissions, tokenFromHelpers } from "../utils/plugin";
import { discoverLockManagerAddress, discoverVeContracts } from "../utils/veDiscovery";

// =============================================
// Contract registration — dispatch plugin addresses to dynamic indexing
// based on bytecode. contractRegister runs pre-handler (no DB, no
// context.effect) so this stays in the handler file rather than in a
// service. The actual entity writes for these plugins happen later via
// the InstallationPrepared handler → services/pluginInstall.
// =============================================

indexer.contractRegister(
  { contract: "PluginSetupProcessor", event: "InstallationPrepared" },
  async ({ event, context }) => {
    const pluginAddress = event.params.plugin;
    const helpers = event.params.preparedSetupData[0];

    let pluginType: Awaited<ReturnType<typeof detectPluginByBytecode>>;
    try {
      pluginType = await detectPluginByBytecode(pluginAddress, event.chainId);
    } catch {
      return;
    }

    switch (pluginType) {
      case PluginInterfaceType.Multisig:
        context.chain.Multisig.add(pluginAddress);
        break;

      case PluginInterfaceType.TokenVoting:
      case PluginInterfaceType.AddresslistVoting: {
        // Both share the same event surface as TokenVoting handlers.
        context.chain.TokenVoting.add(pluginAddress);
        const tokenAddress = tokenFromHelpers(helpers);
        if (tokenAddress) {
          context.chain.GovernanceERC20.add(tokenAddress);
          try {
            const ve = await discoverVeContracts(tokenAddress, event.chainId);
            if (ve) {
              context.chain.VotingEscrow.add(ve.escrowAddress as `0x${string}`);
              if (ve.exitQueueAddress) context.chain.ExitQueue.add(ve.exitQueueAddress as `0x${string}`);
            }
          } catch {
            /* best-effort */
          }
        }
        break;
      }

      case PluginInterfaceType.Spp:
        context.chain.StagedProposalProcessor.add(pluginAddress);
        break;

      case PluginInterfaceType.LockToVote: {
        context.chain.LockToVote.add(pluginAddress);
        try {
          const lockManagerAddr = await discoverLockManagerAddress(pluginAddress, event.chainId);
          if (lockManagerAddr) context.chain.LockManager.add(lockManagerAddr as `0x${string}`);
        } catch {
          /* best-effort */
        }
        const ltToken = tokenFromHelpers(helpers);
        if (ltToken) {
          context.chain.GovernanceERC20.add(ltToken);
          try {
            const ve = await discoverVeContracts(ltToken, event.chainId);
            if (ve) {
              context.chain.VotingEscrow.add(ve.escrowAddress as `0x${string}`);
              if (ve.exitQueueAddress) context.chain.ExitQueue.add(ve.exitQueueAddress as `0x${string}`);
            }
          } catch {
            /* best-effort */
          }
        }
        break;
      }

      case PluginInterfaceType.Gauge: {
        context.chain.GaugeVoter.add(pluginAddress);
        // Gauge plugins carry an IVotesAdapter / governance token in helpers.
        // Best-effort registration so the token's events get tracked. The
        // Plugin row's `tokenAddress` and the actual `Token` row are written
        // in the InstallationPrepared handler.
        const gaugeToken = tokenFromHelpers(helpers);
        if (gaugeToken) context.chain.GovernanceERC20.add(gaugeToken);
        break;
      }

      case PluginInterfaceType.CapitalDistributor:
        context.chain.CapitalDistributor.add(pluginAddress);
        break;

      case PluginInterfaceType.Admin:
        context.chain.Admin.add(pluginAddress);
        break;

      default:
        // router / claimer / unknown — no specific contract events to wire up yet.
        break;
    }
  },
);

// =============================================
// Handlers — thin orchestration over services/pluginInstall
// =============================================

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "InstallationPrepared" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const daoAddress = getAddress(event.params.dao);
    const pluginAddress = getAddress(event.params.plugin);

    // Skip if DAO doesn't exist — preserves legacy behaviour of not logging
    // setup events for unknown DAOs.
    const dao = await context.Dao.get(daoId(chainId, daoAddress));
    if (!dao) return;

    const permissions = parsePermissions(event.params.preparedSetupData[1]);
    const release = Number(event.params.versionTag[0]);
    const build = Number(event.params.versionTag[1]);

    logPluginSetupPrepared(context, {
      chainId,
      event: PluginSetupEvent.InstallationPrepared,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress,
      pluginAddress,
      preparedSetupId: event.params.preparedSetupId,
      pluginSetupRepo: getAddress(event.params.pluginSetupRepo),
      sender: getAddress(event.params.sender),
      release,
      build,
      permissions,
    });

    await stubPluginOnInstallPrepared(context, {
      chainId,
      daoAddress,
      pluginAddress,
      pluginSetupRepo: event.params.pluginSetupRepo,
      helpers: event.params.preparedSetupData[0],
      release,
      build,
      permissions,
      rawPermissions: event.params.preparedSetupData[1],
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "InstallationApplied" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const daoAddress = getAddress(event.params.dao);
    const pluginAddress = getAddress(event.params.plugin);

    const dao = await context.Dao.get(daoId(chainId, daoAddress));
    if (!dao) return;

    logPluginSetupApplied(context, {
      chainId,
      event: PluginSetupEvent.InstallationApplied,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress,
      pluginAddress,
      preparedSetupId: event.params.preparedSetupId,
      appliedSetupId: event.params.appliedSetupId,
    });

    await setPluginStatus(context, {
      chainId,
      pluginAddress,
      status: PluginStatus.Installed,
      blockNumber: event.block.number,
    });
  },
);

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "UpdatePrepared" },
  async ({ event, context }) => {
    logPluginSetupPrepared(context, {
      chainId: event.chainId,
      event: PluginSetupEvent.UpdatePrepared,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress: getAddress(event.params.dao),
      pluginAddress: getAddress(event.params.setupPayload[0]),
      preparedSetupId: event.params.preparedSetupId,
      pluginSetupRepo: getAddress(event.params.pluginSetupRepo),
      sender: getAddress(event.params.sender),
      release: Number(event.params.versionTag[0]),
      build: Number(event.params.versionTag[1]),
      permissions: parsePermissions(event.params.preparedSetupData[1]),
    });
  },
);

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "UpdateApplied" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.params.plugin);

    logPluginSetupApplied(context, {
      chainId,
      event: PluginSetupEvent.UpdateApplied,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress: getAddress(event.params.dao),
      pluginAddress,
      preparedSetupId: event.params.preparedSetupId,
      appliedSetupId: event.params.appliedSetupId,
    });

    await setPluginStatus(context, {
      chainId,
      pluginAddress,
      status: PluginStatus.Updated,
      blockNumber: event.block.number,
    });
  },
);

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "UninstallationPrepared" },
  async ({ event, context }) => {
    logPluginSetupPrepared(context, {
      chainId: event.chainId,
      event: PluginSetupEvent.UninstallationPrepared,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress: getAddress(event.params.dao),
      pluginAddress: getAddress(event.params.setupPayload[0]),
      preparedSetupId: event.params.preparedSetupId,
      pluginSetupRepo: getAddress(event.params.pluginSetupRepo),
      sender: getAddress(event.params.sender),
      release: Number(event.params.versionTag[0]),
      build: Number(event.params.versionTag[1]),
      // For UninstallationPrepared the permissions array is top-level on the
      // event (not nested under a preparedSetupData struct).
      permissions: parsePermissions(event.params.permissions),
    });
  },
);

indexer.onEvent(
  { contract: "PluginSetupProcessor", event: "UninstallationApplied" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.params.plugin);

    logPluginSetupApplied(context, {
      chainId,
      event: PluginSetupEvent.UninstallationApplied,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
      daoAddress: getAddress(event.params.dao),
      pluginAddress,
      preparedSetupId: event.params.preparedSetupId,
      // OSx `UninstallationApplied` event has no `appliedSetupId` field.
    });

    await setPluginStatus(context, {
      chainId,
      pluginAddress,
      status: PluginStatus.Uninstalled,
      blockNumber: event.block.number,
    });
  },
);
