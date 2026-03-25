import { CapitalDistributor } from "generated";
import { campaignId as makeCampaignId } from "../utils/ids";

CapitalDistributor.CampaignCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  context.Campaign.set({
    id,
    chainId,
    pluginAddress,
    campaignId: campaignIndex,
    metadataUri: event.params.metadataUri || undefined,
    token: event.params.token || undefined,
    startTime: event.params.startTime,
    endTime: event.params.endTime,
    merkleRoot: undefined,
    isPaused: false,
    isEnded: false,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

CapitalDistributor.MerkleCampaignSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({
      ...campaign,
      merkleRoot: event.params.merkleRoot,
    });
  }
});

CapitalDistributor.MerkleCampaignUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({
      ...campaign,
      merkleRoot: event.params.newMerkleRoot,
    });
  }
});

CapitalDistributor.CampaignPaused.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isPaused: true });
  }
});

CapitalDistributor.CampaignResumed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isPaused: false });
  }
});

CapitalDistributor.CampaignEnded.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const campaignIndex = event.params.campaignId.toString();
  const id = makeCampaignId({ chainId, pluginAddress, campaignId: campaignIndex });

  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isEnded: true });
  }
});
