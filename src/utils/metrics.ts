/**
 * Helper to update DAO-level and plugin-level activity metrics.
 * Called from proposal, vote, and member handlers.
 */

import type { HandlerContext } from "generated";
import { PluginActivityType } from "../enums";
import { activityMetricId } from "../ids";

export async function incrementDaoProposalCount(context: HandlerContext, daoId: string) {
  const dao = await context.Dao.get(daoId);
  if (dao) {
    context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
  }
}

export async function incrementDaoProposalsExecuted(context: HandlerContext, daoId: string) {
  const dao = await context.Dao.get(daoId);
  if (dao) {
    context.Dao.set({
      ...dao,
      proposalsExecuted: dao.proposalsExecuted + 1,
    });
  }
}

export async function incrementDaoVoteCount(context: HandlerContext, daoId: string) {
  const dao = await context.Dao.get(daoId);
  if (!dao) return;
  context.Dao.set({ ...dao, voteCount: dao.voteCount + 1 });
}

export async function trackPluginActivity(
  context: HandlerContext,
  params: {
    chainId: number;
    pluginId: string;
    pluginAddress: string;
    memberAddress: string;
    daoAddress: string;
    blockNumber: number;
    type: PluginActivityType;
  },
) {
  const id = activityMetricId(params.chainId, params.pluginAddress, params.memberAddress);
  const existing = await context.PluginActivityMetric.get(id);

  const voteDelta = params.type === PluginActivityType.Vote ? 1 : 0;
  const proposalDelta = params.type === PluginActivityType.Proposal ? 1 : 0;

  if (existing) {
    context.PluginActivityMetric.set({
      ...existing,
      voteCount: existing.voteCount + voteDelta,
      proposalCount: existing.proposalCount + proposalDelta,
      lastActivityBlock: params.blockNumber,
    });
  } else {
    context.PluginActivityMetric.set({
      id,
      chainId: params.chainId,
      plugin_id: params.pluginId,
      pluginAddress: params.pluginAddress,
      memberAddress: params.memberAddress,
      daoAddress: params.daoAddress,
      voteCount: voteDelta,
      proposalCount: proposalDelta,
      firstActivityBlock: params.blockNumber,
      lastActivityBlock: params.blockNumber,
    });
  }
}
