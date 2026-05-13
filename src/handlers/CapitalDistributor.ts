import { indexer } from "envio";
import { getAddress } from "viem";
import { fetchIpfsJson } from "../effects/ipfs";
import { addMember } from "../services/member";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { campaignRewardId, campaignId as makeCampaignId } from "../utils/ids";
import { extractIpfsCid, parseCampaignMetadata } from "../utils/metadata";

// Register the campaign's allocation-strategy contract so its
// `MerkleCampaignSet` / `MerkleCampaignUpdated` events route to our
// `CampaignAllocationStrategy.ts` handlers.
indexer.contractRegister(
  { contract: "CapitalDistributor", event: "CampaignCreated" },
  async ({ event, context }) => {
    context.chain.CampaignAllocationStrategy.add(event.params.allocationStrategy);
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "CampaignCreated" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const campaignId = event.params.campaignId.toString();
    const allocationStrategy = getAddress(event.params.allocationStrategy);

    const cid = extractIpfsCid(event.params.metadataUri);
    const raw = cid ? await context.effect(fetchIpfsJson, cid) : null;
    const metadata = parseCampaignMetadata(raw);

    context.Campaign.set({
      id: makeCampaignId(chainId, pluginAddress, campaignId),
      chainId,
      pluginAddress,
      campaignId,
      allocationStrategy,
      payoutEncoder: event.params.actionEncoder ? getAddress(event.params.actionEncoder) : undefined,
      metadataUri: cid ? `ipfs://${cid}` : undefined,
      title: metadata?.title,
      description: metadata?.description,
      resources: metadata?.resources,
      campaignType: metadata?.campaignType,
      token: event.params.token ? getAddress(event.params.token) : undefined,
      startTime: event.params.startTime,
      endTime: event.params.endTime,
      merkleRoot: undefined,
      isPaused: false,
      isEnded: false,
      claimCount: 0,
      totalClaimed: 0n,
      totalRewards: undefined,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    });
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "PayoutClaimed" },
  async ({ event, context }) => {
    const chainId = event.chainId;
    const pluginAddress = getAddress(event.srcAddress);
    const campaignIndex = event.params.campaignId.toString();
    const recipient = getAddress(event.params.recipient);
    const amount = event.params.amount;

    const campaign_id = makeCampaignId(chainId, pluginAddress, campaignIndex);
    const campaign = await context.Campaign.get(campaign_id);
    if (!campaign) return;

    const reward_id = campaignRewardId(chainId, pluginAddress, campaignIndex, recipient);
    const existing = await context.CampaignReward.get(reward_id);
    const prevClaims = Array.isArray(existing?.claims) ? (existing.claims as Array<Record<string, unknown>>) : [];
    if (prevClaims.some((c) => c.transactionHash === event.transaction.hash && c.logIndex === event.logIndex)) {
      return;
    }

    const newClaim = {
      amount: amount.toString(),
      transactionHash: event.transaction.hash,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      logIndex: event.logIndex,
    };

    context.CampaignReward.set({
      id: reward_id,
      chainId,
      campaign_id,
      campaignId: campaignIndex,
      pluginAddress,
      allocationStrategy: campaign.allocationStrategy,
      claimerAddress: recipient,
      totalClaimed: (existing?.totalClaimed ?? 0n) + amount,
      claims: [...prevClaims, newClaim],
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
    });

    context.Campaign.set({
      ...campaign,
      claimCount: campaign.claimCount + 1,
      totalClaimed: campaign.totalClaimed + amount,
    });

    await addMember(context, { address: recipient, blockNumber: event.block.number });
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "CampaignPaused" },
  async ({ event, context }) => {
    const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
    const campaign = await context.Campaign.get(id);
    if (campaign) {
      context.Campaign.set({ ...campaign, isPaused: true });
    }
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "CampaignResumed" },
  async ({ event, context }) => {
    const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
    const campaign = await context.Campaign.get(id);
    if (campaign) {
      context.Campaign.set({ ...campaign, isPaused: false });
    }
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "CampaignEnded" },
  async ({ event, context }) => {
    const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
    const campaign = await context.Campaign.get(id);
    if (campaign) {
      context.Campaign.set({ ...campaign, isEnded: true });
    }
  },
);

indexer.onEvent(
  { contract: "CapitalDistributor", event: "CapitalDistributorMetadataSet" },
  async ({ event, context }) => {
    await applyPluginMetadata(context, {
      chainId: event.chainId,
      pluginAddress: event.srcAddress,
      metadata: event.params.metadata,
      blockNumber: event.block.number,
      blockTimestamp: event.block.timestamp,
      transactionHash: event.transaction.hash,
      logIndex: event.logIndex,
    });
  },
);
