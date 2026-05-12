import { CapitalDistributor } from "generated";
import { getAddress } from "viem";
import { fetchIpfsJson } from "../effects/ipfs";
import { campaignId as makeCampaignId } from "../ids";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { extractIpfsCid, parseCampaignMetadata } from "../utils/metadata";

// Register the campaign's allocation-strategy contract so its
// `MerkleCampaignSet` / `MerkleCampaignUpdated` events route to our
// `CampaignAllocationStrategy.ts` handlers. Mirrors legacy
// `LogCampaignStrategy.start(allocationStrategy, ...)`.
CapitalDistributor.CampaignCreated.contractRegister(({ event, context }) => {
  context.addCampaignAllocationStrategy(event.params.allocationStrategy);
});

CapitalDistributor.CampaignCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const campaignId = event.params.campaignId.toString();
  const allocationStrategy = getAddress(event.params.allocationStrategy);

  // Parse campaign metadata from IPFS (best-effort — the indexer keeps the
  // raw URI either way; null parse just leaves the title/description fields
  // null until an enrichment retry).
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
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

CapitalDistributor.CampaignPaused.handler(async ({ event, context }) => {
  const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isPaused: true });
  }
});

CapitalDistributor.CampaignResumed.handler(async ({ event, context }) => {
  const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isPaused: false });
  }
});

CapitalDistributor.CampaignEnded.handler(async ({ event, context }) => {
  const id = makeCampaignId(event.chainId, event.srcAddress, event.params.campaignId.toString());
  const campaign = await context.Campaign.get(id);
  if (campaign) {
    context.Campaign.set({ ...campaign, isEnded: true });
  }
});

CapitalDistributor.CapitalDistributorMetadataSet.handler(async ({ event, context }) => {
  await applyPluginMetadata(context, {
    chainId: event.chainId,
    pluginAddress: event.srcAddress,
    metadata: event.params.metadata,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
  });
});
