import { type EvmOnEventContext, indexer } from "envio";
import { getAddress } from "viem";
import logger from "../helpers/logger";
import { campaignMerkleRootLogId } from "../utils/ids";

const llo = logger.logMeta.bind(null, { service: "handlers:CampaignAllocationStrategy" });

/**
 * Look up a campaign by its allocation-strategy address (the event source)
 * and a campaign id. Mirrors legacy
 * `Campaign.findOne({ allocationStrategy, network, campaignId })` —
 * `event.srcAddress` here is the strategy contract, NOT the
 * CapitalDistributor plugin, so we cannot derive the Campaign.id
 * directly. We index `Campaign.allocationStrategy` so this is a single
 * `getWhere` keyed on the indexed column (no full scan).
 */
async function findCampaignByStrategy(
  context: EvmOnEventContext,
  args: { allocationStrategy: string; campaignId: string },
) {
  const matches = await context.Campaign.getWhere({
    allocationStrategy: { _eq: args.allocationStrategy },
  });
  return matches.find((c) => c.campaignId === args.campaignId);
}

indexer.onEvent(
  { contract: "CampaignAllocationStrategy", event: "MerkleCampaignSet" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const allocationStrategy = getAddress(event.srcAddress);
    const campaignId = event.params.campaignId.toString();
    const merkleRoot = event.params.merkleRoot;

    const campaign = await findCampaignByStrategy(context, { allocationStrategy, campaignId });
    if (!campaign) {
      logger.warn(
        "MerkleCampaignSet received for unknown campaign — skipped",
        llo({ allocationStrategy, campaignId, transactionHash: event.transaction.hash }),
      );
      return;
    }

    context.Campaign.set({ ...campaign, merkleRoot });

    context.CampaignMerkleRootLog.set({
      id: campaignMerkleRootLogId(chainId, allocationStrategy, campaignId, event.transaction.hash, event.logIndex),
      chainId,
      campaign_id: campaign.id,
      campaignId,
      pluginAddress: campaign.pluginAddress,
      allocationStrategy,
      merkleRoot,
      previousMerkleRoot: undefined,
      totalMembers: undefined,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  },
);

indexer.onEvent(
  { contract: "CampaignAllocationStrategy", event: "MerkleCampaignUpdated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const allocationStrategy = getAddress(event.srcAddress);
    const campaignId = event.params.campaignId.toString();
    const newMerkleRoot = event.params.newMerkleRoot;
    const previousMerkleRoot = event.params.oldMerkleRoot;

    const campaign = await findCampaignByStrategy(context, { allocationStrategy, campaignId });
    if (!campaign) {
      logger.warn(
        "MerkleCampaignUpdated received for unknown campaign — skipped",
        llo({ allocationStrategy, campaignId, transactionHash: event.transaction.hash }),
      );
      return;
    }

    context.Campaign.set({ ...campaign, merkleRoot: newMerkleRoot });

    context.CampaignMerkleRootLog.set({
      id: campaignMerkleRootLogId(chainId, allocationStrategy, campaignId, event.transaction.hash, event.logIndex),
      chainId,
      campaign_id: campaign.id,
      campaignId,
      pluginAddress: campaign.pluginAddress,
      allocationStrategy,
      merkleRoot: newMerkleRoot,
      previousMerkleRoot,
      totalMembers: undefined,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  },
);
