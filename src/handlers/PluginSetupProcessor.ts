import { PluginSetupProcessor } from "generated";
import { fetchDaoInfo, fetchTokenMetadata, discoverVotingEscrow } from "../effects/rpc";
import { EIP1967_IMPLEMENTATION_SLOT } from "../constants";
import { detectPluginByBytecode } from "../utils/bytecodeDetector";
import { daoId as makeDaoId, eventId, pluginId as makePluginId, tokenId as makeTokenId } from "../utils/ids";
import { getPluginTypeFromRepo } from "../utils/pluginRepos";
import { discoverLockManagerAddress, discoverVeContracts } from "../utils/veDiscovery";

// =============================================
// Helpers
// =============================================

type InterfaceType =
  | "tokenVoting"
  | "multisig"
  | "admin"
  | "addresslistVoting"
  | "spp"
  | "lockToVote"
  | "gauge"
  | "capitalDistributor"
  | "router"
  | "claimer"
  | "unknown";

// Plugin types that are "supported" (have dedicated handler tracking)
const SUPPORTED_TYPES = new Set<string>([
  "multisig", "tokenVoting", "addresslistVoting", "spp",
  "lockToVote", "gauge", "capitalDistributor", "admin",
]);

// Permission operation enum from Aragon OSx
const PERMISSION_OPERATION = { Grant: 0, Revoke: 1, GrantWithCondition: 2 } as const;

// Known permission IDs
const PROPOSAL_CREATION_PERMISSION_ID =
  "0x40687f2d1df5de68ca16ab98aa3a24fa2842e8f7cff7d04950a86c3d04267bce"; // keccak256("PROPOSAL_CREATION_PERMISSION")

/**
 * Parse permissions from preparedSetupData[1] (PermissionLib.MultiTargetPermission[])
 * Each permission: (operation, where, who, condition, permissionId)
 */
function parsePermissions(rawPermissions: readonly (readonly [bigint | number, string, string, string, string])[]) {
  return rawPermissions.map((p) => ({
    operation: Number(p[0]),
    where: p[1],
    who: p[2],
    condition: p[3],
    permissionId: p[4],
  }));
}

/**
 * Extract proposalCreationConditionAddress from permissions array.
 * Looks for GrantWithCondition on PROPOSAL_CREATION_PERMISSION.
 */
function extractProposalCreationCondition(
  permissions: { operation: number; condition: string; permissionId: string }[],
): string | undefined {
  const match = permissions.find(
    (p) =>
      p.permissionId.toLowerCase() === PROPOSAL_CREATION_PERMISSION_ID &&
      p.operation === PERMISSION_OPERATION.GrantWithCondition &&
      p.condition !== "0x0000000000000000000000000000000000000000",
  );
  return match?.condition;
}

function detectInterfaceType(repoAddress: string): InterfaceType {
  return (getPluginTypeFromRepo(repoAddress) ?? "unknown") as InterfaceType;
}

async function detectWithBytecodeIfUnknown(
  interfaceType: InterfaceType,
  pluginAddress: string,
  chainId: number,
): Promise<InterfaceType> {
  if (interfaceType !== "unknown") return interfaceType;
  try {
    return (await detectPluginByBytecode(pluginAddress, chainId)) as InterfaceType;
  } catch {
    return "unknown";
  }
}

// Token types that extract token from helpers
const TOKEN_PLUGIN_TYPES = new Set(["tokenVoting", "addresslistVoting", "lockToVote"]);

function getTokenFromHelpers(helpers: readonly `0x${string}`[]): `0x${string}` | undefined {
  if (helpers.length === 1 && helpers[0]) return helpers[0];
  if (helpers.length >= 2 && helpers[helpers.length - 1]) return helpers[helpers.length - 1]!;
  return undefined;
}

// =============================================
// Contract Registration — register plugin addresses for dynamic indexing
// Must be defined BEFORE handlers.
// =============================================

PluginSetupProcessor.InstallationPrepared.contractRegister(async ({ event, context }) => {
  const pluginAddress = event.params.plugin;
  const repoAddress = event.params.pluginSetupRepo;
  const pluginType = getPluginTypeFromRepo(repoAddress);
  const helpers = event.params.preparedSetupData[0]; // address[] helpers

  const getToken = (): `0x${string}` | undefined => getTokenFromHelpers(helpers);

  switch (pluginType) {
    case "multisig":
      context.addMultisig(pluginAddress);
      break;
    case "tokenVoting": {
      context.addTokenVoting(pluginAddress);
      const tokenAddress = getToken();
      if (tokenAddress) {
        context.addGovernanceERC20(tokenAddress);
        try {
          const ve = await discoverVeContracts(tokenAddress, event.chainId);
          if (ve) {
            context.addVotingEscrow(ve.escrowAddress as `0x${string}`);
            if (ve.exitQueueAddress) context.addExitQueue(ve.exitQueueAddress as `0x${string}`);
          }
        } catch { /* best-effort */ }
      }
      break;
    }
    case "spp":
      context.addStagedProposalProcessor(pluginAddress);
      break;
    case "admin":
      break;
    case "addresslistVoting":
      context.addTokenVoting(pluginAddress);
      break;
    case "lockToVote": {
      context.addLockToVote(pluginAddress);
      try {
        const lockManagerAddr = await discoverLockManagerAddress(pluginAddress, event.chainId);
        if (lockManagerAddr) context.addLockManager(lockManagerAddr as `0x${string}`);
      } catch { /* best-effort */ }
      const ltToken = getToken();
      if (ltToken) {
        context.addGovernanceERC20(ltToken);
        try {
          const ve = await discoverVeContracts(ltToken, event.chainId);
          if (ve) {
            context.addVotingEscrow(ve.escrowAddress as `0x${string}`);
            if (ve.exitQueueAddress) context.addExitQueue(ve.exitQueueAddress as `0x${string}`);
          }
        } catch { /* best-effort */ }
      }
      break;
    }
    case "gauge":
      context.addGaugeVoter(pluginAddress);
      break;
    case "capitalDistributor":
      context.addCapitalDistributor(pluginAddress);
      break;
    case "router":
    case "claimer":
      break;
    default: {
      try {
        const detected = await detectPluginByBytecode(pluginAddress, event.chainId);
        switch (detected) {
          case "multisig":
            context.addMultisig(pluginAddress);
            break;
          case "tokenVoting": {
            context.addTokenVoting(pluginAddress);
            const tk = getToken();
            if (tk) context.addGovernanceERC20(tk);
            break;
          }
          case "spp":
            context.addStagedProposalProcessor(pluginAddress);
            break;
          case "lockToVote": {
            context.addLockToVote(pluginAddress);
            try {
              const lm = await discoverLockManagerAddress(pluginAddress, event.chainId);
              if (lm) context.addLockManager(lm as `0x${string}`);
            } catch {}
            break;
          }
          case "gauge":
            context.addGaugeVoter(pluginAddress);
            break;
          case "capitalDistributor":
            context.addCapitalDistributor(pluginAddress);
            break;
        }
      } catch { /* bytecode detection failed */ }
      break;
    }
  }
});

// =============================================
// Handlers
// =============================================

PluginSetupProcessor.InstallationPrepared.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  const daoAddress = event.params.dao;
  const pluginAddress = event.params.plugin;

  const dId = makeDaoId({ chainId, daoAddress });
  const dao = await context.Dao.get(dId);
  if (!dao) return;

  // Parse permissions from preparedSetupData
  const rawPermissions = event.params.preparedSetupData[1];
  const permissions = parsePermissions(rawPermissions);
  const proposalCreationConditionAddress = extractProposalCreationCondition(permissions);

  // Create setup log with permissions
  context.PluginSetupLog.set({
    id,
    chainId,
    event: "InstallationPrepared",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress,
    pluginAddress,
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: undefined,
    pluginSetupRepo: event.params.pluginSetupRepo,
    sender: event.params.sender,
    release: Number(event.params.versionTag[0]),
    build: Number(event.params.versionTag[1]),
    permissions: permissions.length > 0 ? permissions : undefined,
  });

  // Detect plugin type
  let interfaceType = detectInterfaceType(event.params.pluginSetupRepo);
  interfaceType = await detectWithBytecodeIfUnknown(interfaceType, pluginAddress, chainId);

  // Extract token address from helpers
  const helpers = event.params.preparedSetupData[0];
  let tokenAddress: string | undefined;
  if (TOKEN_PLUGIN_TYPES.has(interfaceType)) {
    tokenAddress = getTokenFromHelpers(helpers);
  }

  // Discover VE contracts for token plugins
  let votingEscrow: Record<string, string> | undefined;
  if (tokenAddress) {
    const ve = await context.effect(discoverVotingEscrow, { tokenAddress, chainId });
    if (ve) {
      votingEscrow = {
        escrowAddress: ve.escrowAddress,
        ...(ve.exitQueueAddress && { exitQueueAddress: ve.exitQueueAddress }),
        ...(ve.nftLockAddress && { nftLockAddress: ve.nftLockAddress }),
        ...(ve.underlyingToken && { underlyingToken: ve.underlyingToken }),
        ...(ve.curveAddress && { curveAddress: ve.curveAddress }),
        ...(ve.clockAddress && { clockAddress: ve.clockAddress }),
      };
    }
  }

  // Discover LockManager for lockToVote
  let lockManagerAddress: string | undefined;
  if (interfaceType === "lockToVote") {
    try {
      lockManagerAddress = (await discoverLockManagerAddress(pluginAddress, chainId)) ?? undefined;
    } catch { /* best-effort */ }
  }

  // Fetch plugin implementation address
  const pluginInfo = await context.effect(fetchDaoInfo, { daoAddress: pluginAddress, chainId });

  const isSupported = SUPPORTED_TYPES.has(interfaceType);

  // Create plugin in preInstall status
  const pId = makePluginId({ chainId, txHash: event.transaction.hash, pluginAddress });
  // Determine plugin flags based on type
  const isProcess = ["spp", "tokenVoting", "multisig", "lockToVote", "addresslistVoting", "admin"].includes(interfaceType);
  const isBody = ["tokenVoting", "multisig", "lockToVote", "addresslistVoting", "admin"].includes(interfaceType);

  context.Plugin.set({
    id: pId,
    chainId,
    address: pluginAddress,
    dao_id: dId,
    daoAddress,
    interfaceType,
    status: "preInstall",
    isSupported,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    implementationAddress: pluginInfo?.implementationAddress,
    pluginSetupRepo: event.params.pluginSetupRepo,
    release: Number(event.params.versionTag[0]),
    build: Number(event.params.versionTag[1]),
    subdomain: undefined,
    tokenAddress,
    votingEscrow: votingEscrow ?? undefined,
    conditionAddress: undefined,
    proposalCreationConditionAddress,
    lockManagerAddress,
    permissions: permissions.length > 0 ? permissions : undefined,
    subPlugins: undefined,
    totalStages: undefined,
    parentPlugin: undefined,
    stageIndex: undefined,
    isSubPlugin: false,
    isBody,
    isProcess,
  });

  // Create Token entity if we have a token address
  if (tokenAddress) {
    const tId = makeTokenId({ chainId, tokenAddress });
    const existingToken = await context.Token.get(tId);
    if (!existingToken) {
      const metadata = await context.effect(fetchTokenMetadata, { tokenAddress, chainId });
      context.Token.set({
        id: tId,
        chainId,
        address: tokenAddress,
        name: metadata?.name,
        symbol: metadata?.symbol,
        decimals: metadata?.decimals,
        totalSupply: metadata?.totalSupply,
        type: "ERC20",
        isGovernance: true,
      });
    }
  }
});

PluginSetupProcessor.InstallationApplied.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  const daoAddress = event.params.dao;
  const pluginAddress = event.params.plugin;

  const dId = makeDaoId({ chainId, daoAddress });
  const dao = await context.Dao.get(dId);
  if (!dao) return;

  context.PluginSetupLog.set({
    id,
    chainId,
    event: "InstallationApplied",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress,
    pluginAddress,
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: event.params.appliedSetupId,
    pluginSetupRepo: undefined,
    sender: undefined,
    release: undefined,
    build: undefined,
    permissions: undefined,
  });

  // Update plugin status to installed — find by address since Plugin ID now includes txHash
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "preInstall");
  if (plugin) {
    context.Plugin.set({
      ...plugin,
      status: "installed",
    });
  }
});

PluginSetupProcessor.UpdatePrepared.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  // Parse permissions from preparedSetupData
  const rawPermissions = event.params.preparedSetupData[1];
  const permissions = parsePermissions(rawPermissions);

  context.PluginSetupLog.set({
    id,
    chainId,
    event: "UpdatePrepared",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress: event.params.dao,
    pluginAddress: event.params.setupPayload[0],
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: undefined,
    pluginSetupRepo: event.params.pluginSetupRepo,
    sender: event.params.sender,
    release: Number(event.params.versionTag[0]),
    build: Number(event.params.versionTag[1]),
    permissions: permissions.length > 0 ? permissions : undefined,
  });
});

PluginSetupProcessor.UpdateApplied.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  const pluginAddress = event.params.plugin;

  context.PluginSetupLog.set({
    id,
    chainId,
    event: "UpdateApplied",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress: event.params.dao,
    pluginAddress,
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: event.params.appliedSetupId,
    pluginSetupRepo: undefined,
    sender: undefined,
    release: undefined,
    build: undefined,
    permissions: undefined,
  });

  // Find existing installed plugin by address, mark as deprecated, create new versioned plugin
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const oldPlugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (oldPlugin) {
    // Mark old plugin as deprecated
    context.Plugin.set({
      ...oldPlugin,
      status: "deprecated",
    });

    // Create new plugin record with new txHash-based ID, inheriting key fields
    const newPId = makePluginId({ chainId, txHash: event.transaction.hash, pluginAddress });
    context.Plugin.set({
      ...oldPlugin,
      id: newPId,
      status: "installed",
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });
  }
});

PluginSetupProcessor.UninstallationPrepared.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.PluginSetupLog.set({
    id,
    chainId,
    event: "UninstallationPrepared",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress: event.params.dao,
    pluginAddress: event.params.setupPayload[0],
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: undefined,
    pluginSetupRepo: event.params.pluginSetupRepo,
    sender: event.params.sender,
    release: Number(event.params.versionTag[0]),
    build: Number(event.params.versionTag[1]),
    permissions: undefined,
  });
});

PluginSetupProcessor.UninstallationApplied.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  const pluginAddress = event.params.plugin;

  context.PluginSetupLog.set({
    id,
    chainId,
    event: "UninstallationApplied",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    daoAddress: event.params.dao,
    pluginAddress,
    preparedSetupId: event.params.preparedSetupId,
    appliedSetupId: undefined,
    pluginSetupRepo: undefined,
    sender: undefined,
    release: undefined,
    build: undefined,
    permissions: undefined,
  });

  // Find installed plugin by address, mark as uninstalled
  const plugins = await context.Plugin.getWhere({ address: { _eq: pluginAddress } });
  const plugin = plugins.find((p: any) => p.chainId === chainId && p.status === "installed");
  if (plugin) {
    context.Plugin.set({
      ...plugin,
      status: "uninstalled",
      isSupported: false,
    });
  }
});
