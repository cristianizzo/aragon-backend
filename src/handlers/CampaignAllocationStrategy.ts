import { CampaignAllocationStrategy } from "generated";
import { getAddress } from "viem";
import logger from "../helpers/logger";
import { campaignMerkleRootLogId } from "../ids";

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
  context: Parameters<Parameters<typeof CampaignAllocationStrategy.MerkleCampaignSet.handler>[0]>[0]["context"],
  args: { allocationStrategy: string; campaignId: string },
) {
  const matches = await context.Campaign.getWhere({
    allocationStrategy: { _eq: args.allocationStrategy },
  });
  return matches.find((c) => c.campaignId === args.campaignId);
}

CampaignAllocationStrategy.MerkleCampaignSet.handler(async ({ event, context }) => {
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

  // Audit trail mirroring legacy `CampaignMerkleRoot` collection — preserves
  // every set/update so consumers can reconstruct the merkle history.
  context.CampaignMerkleRootLog.set({
    id: campaignMerkleRootLogId(chainId, allocationStrategy, campaignId, event.transaction.hash, event.logIndex),
    chainId,
    campaign_id: campaign.id,
    campaignId,
    pluginAddress: campaign.pluginAddress,
    allocationStrategy,
    merkleRoot,
    previousMerkleRoot: undefined,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
});

CampaignAllocationStrategy.MerkleCampaignUpdated.handler(async ({ event, context }) => {
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
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
});
