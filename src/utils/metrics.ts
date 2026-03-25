/**
 * Helper to update DAO-level and plugin-level activity metrics.
 * Called from proposal, vote, and member handlers.
 */

import { pluginActivityMetricId } from "./ids";

type Context = {
  Dao: { get: (id: string) => Promise<any>; set: (e: any) => void };
  PluginActivityMetric: {
    get: (id: string) => Promise<any>;
    set: (e: any) => void;
  };
};

export async function incrementDaoProposalCount(context: Context, daoId: string) {
  const dao = await context.Dao.get(daoId);
  if (dao) {
    context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
  }
}

export async function incrementDaoProposalsExecuted(context: Context, daoId: string) {
  const dao = await context.Dao.get(daoId);
  if (dao) {
    context.Dao.set({
      ...dao,
      proposalsExecuted: dao.proposalsExecuted + 1,
    });
  }
}

export async function incrementDaoVoteCount(context: Context, daoId: string, voterAddress: string) {
  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  // Increment vote count
  const newVoteCount = dao.voteCount + 1;

  // For unique voters: we can't efficiently check uniqueness inline without
  // a separate lookup. We increment uniqueVoters optimistically — the count
  // may slightly overcount if the same voter votes on multiple proposals.
  // A more accurate approach would use getWhere but that's expensive per vote.
  context.Dao.set({ ...dao, voteCount: newVoteCount });
}

export async function trackPluginActivity(
  context: any,
  params: {
    chainId: number;
    pluginId: string;
    pluginAddress: string;
    memberAddress: string;
    daoAddress: string;
    blockNumber: number;
    type: "vote" | "proposal";
  },
) {
  const id = pluginActivityMetricId({
    chainId: params.chainId,
    pluginAddress: params.pluginAddress,
    memberAddress: params.memberAddress,
  });
  const existing = await context.PluginActivityMetric.get(id);

  if (existing) {
    context.PluginActivityMetric.set({
      ...existing,
      voteCount: existing.voteCount + (params.type === "vote" ? 1 : 0),
      proposalCount: existing.proposalCount + (params.type === "proposal" ? 1 : 0),
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
      voteCount: params.type === "vote" ? 1 : 0,
      proposalCount: params.type === "proposal" ? 1 : 0,
      firstActivityBlock: params.blockNumber,
      lastActivityBlock: params.blockNumber,
    });
  }
}
