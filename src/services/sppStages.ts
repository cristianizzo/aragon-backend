import type { HandlerContext } from "generated";
import { getAddress } from "viem";
import { type AddressBrand, detectAddressBrand } from "../effects/addressBrand";
import logger from "../helpers/logger";
import { pluginId, pluginParentLinkId, proposalId, settingId, subProposalLinkId } from "../utils/ids";

const llo = logger.logMeta.bind(null, { service: "services:sppStages" });

/**
 * Body within a stage as decoded from `StagesUpdated`.
 * Tuple shape: `(address addr, bool isManual, bool tryAdvance, uint8 resultType)`.
 */
export type StageBody = readonly [string, boolean, boolean, bigint | number];

/**
 * Stage tuple from `StagesUpdated`:
 * `(Body[] bodies, uint64 maxAdvance, uint64 minAdvance, uint64 voteDuration,
 *   uint16 approvalThreshold, uint16 vetoThreshold, bool cancelable, bool editable)`
 */
export type StageTuple = readonly [
  ReadonlyArray<StageBody>,
  bigint,
  bigint,
  bigint,
  bigint | number,
  bigint | number,
  boolean,
  boolean,
];

/**
 * Apply a `StagesUpdated` event from an SPP plugin.
 *
 * Replaces the parent SPP's `PluginParentLink` rows with fresh links derived
 * from the new stage structure. Also writes a `PluginSetting` row carrying
 * the normalized stage config (mirrors the legacy `Setting.stages` blob).
 *
 * Stale-link cleanup: every link previously rooted at this parent is wiped
 * before the new ones are written, so a stage reorder / body removal is
 * reflected immediately. Children that no longer have any link become
 * orphans and are picked up by the uninstall cascade if their parent is
 * later uninstalled.
 */
export async function applyStagesUpdated(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: string;
    stages: ReadonlyArray<StageTuple>;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
  },
): Promise<void> {
  const parentAddress = getAddress(args.pluginAddress);
  const parent_id = pluginId(args.chainId, parentAddress);
  const parent = await context.Plugin.get(parent_id);
  if (!parent) {
    logger.warn(
      "StagesUpdated received before SPP Plugin row exists — skipped",
      llo({ parentAddress, chainId: args.chainId }),
    );
    return;
  }

  // Cross-merge stage names from the parent SPP's metadata blob (set via
  // `MetadataSet` on the SPP plugin). Legacy attaches them as `stage.name`
  // when array length matches; we mirror that. Fallback is undefined.
  const stageNames = Array.isArray(parent.stageNames) ? (parent.stageNames as unknown[]) : [];

  // Resolve `brandId` per body via the cached `detectAddressBrand` Effect
  // (one RPC `getCode` per unique address, then disk-cached). Done up
  // front so the stage builder below stays synchronous.
  const uniqueBodyAddresses = new Set<string>();
  for (const stage of args.stages) {
    for (const body of stage[0]) uniqueBodyAddresses.add(getAddress(body[0]));
  }
  const brandLookup = new Map<string, AddressBrand>();
  await Promise.all(
    Array.from(uniqueBodyAddresses).map(async (address) => {
      // Effect output is typed as `string` because rescript-schema can't
      // express literal unions; narrow at this boundary.
      const brand = (await context.effect(detectAddressBrand, { chainId: args.chainId, address })) as AddressBrand;
      brandLookup.set(address, brand);
    }),
  );

  const formattedStages = args.stages.map((stage, stageIndex) => {
    const [bodies, maxAdvance, minAdvance, voteDuration, approvalThreshold, vetoThreshold, cancelable, editable] =
      stage;
    const stageName = typeof stageNames[stageIndex] === "string" ? (stageNames[stageIndex] as string) : undefined;
    return {
      stageIndex,
      // Mirrors legacy `Setting.stages[].name` — only set when the SPP's
      // `stageNames` metadata array length matches the stage count.
      name: stageNames.length === args.stages.length ? stageName : undefined,
      minAdvance: Number(minAdvance),
      maxAdvance: Number(maxAdvance),
      voteDuration: Number(voteDuration),
      approvalThreshold: Number(approvalThreshold),
      vetoThreshold: Number(vetoThreshold),
      cancelable,
      editable,
      // Per-body shape: keep both naming conventions for parity with legacy
      // `Setting.stages[].plugins[]` (`allowedBody` / `proposalType`) AND
      // our existing `tryAdvance` / `resultType`. Both are projections of
      // the same on-chain tuple components.
      bodies: bodies.map(([addr, isManual, tryAdvance, resultType]) => {
        const address = getAddress(addr);
        return {
          address,
          isManual,
          tryAdvance,
          allowedBody: tryAdvance,
          resultType: Number(resultType),
          proposalType: Number(resultType),
          brandId: brandLookup.get(address) ?? "other",
        };
      }),
    };
  });

  // Persist the stage structure as a PluginSetting row keyed by tx hash —
  // mirrors how Multisig/TokenVoting settings handlers write their config.
  context.PluginSetting.set({
    id: settingId(args.chainId, parentAddress, args.transactionHash),
    chainId: args.chainId,
    plugin_id: parent_id,
    pluginAddress: parentAddress,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    onlyListed: undefined,
    minApprovals: undefined,
    votingMode: undefined,
    supportThreshold: undefined,
    minParticipation: undefined,
    minDuration: undefined,
    minProposerVotingPower: undefined,
    minApprovalRatio: undefined,
    stages: formattedStages,
    policy: undefined,
    votingEscrow: undefined,
    inactiveAtBlockNumber: undefined,
  });

  // Wipe existing links for this parent so a stage reorder / body removal
  // is reflected. Per-DAO scope is enforced by the parent's daoAddress.
  const existingLinks = await context.PluginParentLink.getWhere({
    parentPluginAddress: { _eq: parentAddress },
  });
  for (const link of existingLinks) {
    if (link.daoAddress === parent.daoAddress) {
      context.PluginParentLink.deleteUnsafe(link.id);
    }
  }

  // Re-emit one link per (parent, stageIndex, child).
  for (const stage of formattedStages) {
    for (const body of stage.bodies) {
      const child_id = pluginId(args.chainId, body.address);
      const child = await context.Plugin.get(child_id);
      if (!child) {
        logger.warn(
          "Sub-plugin referenced by SPP stage not found — link skipped",
          llo({
            parentAddress,
            childAddress: body.address,
            stageIndex: stage.stageIndex,
            chainId: args.chainId,
          }),
        );
        continue;
      }

      // Cross-DAO references shouldn't happen but guard anyway. Skip
      // silently rather than corrupt the link table.
      if (child.daoAddress !== parent.daoAddress) {
        logger.warn(
          "Cross-DAO sub-plugin reference — link skipped",
          llo({
            parentAddress,
            parentDao: parent.daoAddress,
            childAddress: body.address,
            childDao: child.daoAddress,
          }),
        );
        continue;
      }

      context.PluginParentLink.set({
        id: pluginParentLinkId(args.chainId, parent.daoAddress, parentAddress, stage.stageIndex, body.address),
        chainId: args.chainId,
        dao_id: parent.dao_id,
        daoAddress: parent.daoAddress,
        parentPlugin_id: parent_id,
        parentPluginAddress: parentAddress,
        childPlugin_id: child_id,
        childPluginAddress: body.address,
        stageIndex: stage.stageIndex,
        blockNumber: args.blockNumber,
        blockTimestamp: args.blockTimestamp,
        transactionHash: args.transactionHash,
      });
    }
  }
}

/**
 * Append-only helper for the SPP parent's Json array fields. Reads the
 * current array, appends one entry, writes back. Called from
 * `applySubProposalCreated`, `applyProposalAdvanced`, and
 * `applyProposalResultReported`.
 *
 * The Json field arrives untyped from the schema (`unknown`) — we guard
 * with `Array.isArray` before spreading so a malformed prior state can't
 * crash the handler. Worst case: we silently re-initialise to a fresh
 * `[entry]` array, losing prior history.
 */
function appendToParentArray<T>(
  parent: { subProposals?: unknown; stageExecutions?: unknown; results?: unknown },
  key: "subProposals" | "stageExecutions" | "results",
  entry: T,
): T[] {
  const existing = parent[key];
  return Array.isArray(existing) ? [...(existing as T[]), entry] : [entry];
}

/**
 * Apply a `SubProposalCreated` event from an SPP plugin.
 *
 * Writes a `SubProposalLink` keyed by `(chainId, body, bodyProposalId)`
 * so the body's later `ProposalCreated` handler can backfill its own
 * `parentProposalId / stageIndex / isSubProposal` fields. Also appends
 * a stub entry to the parent SPP Proposal's `subProposals` array.
 */
export async function applySubProposalCreated(
  context: HandlerContext,
  args: {
    chainId: number;
    parentPluginAddress: string;
    parentProposalIndex: string;
    body: string;
    bodyProposalIndex: string;
    stageIndex: number;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
  },
): Promise<void> {
  const parentPluginAddress = getAddress(args.parentPluginAddress);
  const body = getAddress(args.body);
  const parentProposal_id = proposalId(args.chainId, parentPluginAddress, args.parentProposalIndex);
  const childProposal_id = proposalId(args.chainId, body, args.bodyProposalIndex);

  context.SubProposalLink.set({
    id: subProposalLinkId(args.chainId, body, args.bodyProposalIndex),
    chainId: args.chainId,
    parentPluginAddress,
    parentProposalIndex: args.parentProposalIndex,
    parentProposalId: parentProposal_id,
    childPluginAddress: body,
    childProposalIndex: args.bodyProposalIndex,
    childProposalId: childProposal_id,
    stageIndex: args.stageIndex,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
  });

  const parent = await context.Proposal.get(parentProposal_id);
  if (!parent) {
    logger.warn(
      "SubProposalCreated received before parent SPP Proposal exists — link saved, parent array unchanged",
      llo({ parentPluginAddress, parentProposalIndex: args.parentProposalIndex }),
    );
    return;
  }
  context.Proposal.set({
    ...parent,
    subProposals: appendToParentArray(parent, "subProposals", {
      stageIndex: args.stageIndex,
      body,
      bodyProposalIndex: args.bodyProposalIndex,
      transactionHash: args.transactionHash,
    }),
  });
}

/**
 * Apply a `ProposalAdvanced` event from an SPP plugin. Appends to the
 * parent's `stageExecutions` array and stamps `lastStageTransition`.
 */
export async function applyProposalAdvanced(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: string;
    proposalIndex: string;
    stageIndex: number;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
  },
): Promise<void> {
  const pluginAddress = getAddress(args.pluginAddress);
  const parent_id = proposalId(args.chainId, pluginAddress, args.proposalIndex);
  const parent = await context.Proposal.get(parent_id);
  if (!parent) return;

  context.Proposal.set({
    ...parent,
    stageExecutions: appendToParentArray(parent, "stageExecutions", {
      stageIndex: args.stageIndex,
      status: true,
      transactionHash: args.transactionHash,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
    }),
    lastStageTransition: args.blockTimestamp,
  });
}

/**
 * Apply a `ProposalResultReported` event from an SPP plugin. Appends to
 * the parent's `results` array.
 */
export async function applyProposalResultReported(
  context: HandlerContext,
  args: {
    chainId: number;
    pluginAddress: string;
    proposalIndex: string;
    stageIndex: number;
    body: string;
    blockNumber: number;
    transactionHash: string;
  },
): Promise<void> {
  const pluginAddress = getAddress(args.pluginAddress);
  const body = getAddress(args.body);
  const parent_id = proposalId(args.chainId, pluginAddress, args.proposalIndex);
  const parent = await context.Proposal.get(parent_id);
  if (!parent) return;

  context.Proposal.set({
    ...parent,
    results: appendToParentArray(parent, "results", {
      stageIndex: args.stageIndex,
      body,
      transactionHash: args.transactionHash,
      blockNumber: args.blockNumber,
    }),
  });
}
