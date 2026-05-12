import { GaugeVoter } from "generated";
import { getAddress } from "viem";
import { GaugeStatus, GaugeVoteKind } from "../enums";
import { gaugeId, gaugeVoteId } from "../ids";
import { addMember } from "../services/member";
import { applyPluginMetadata } from "../services/pluginMetadata";

GaugeVoter.GaugeCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const creatorAddress = getAddress(event.params.creator);

  context.Gauge.set({
    id: gaugeId(chainId, gaugeAddress),
    chainId,
    address: gaugeAddress,
    pluginAddress,
    creatorAddress,
    metadataUri: event.params.metadataURI || undefined,
    status: GaugeStatus.Active,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });

  await addMember(context, { address: creatorAddress, blockNumber: event.block.number });
});

GaugeVoter.GaugeActivated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: GaugeStatus.Active });
  }
});

GaugeVoter.GaugeDeactivated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: GaugeStatus.Deactivated });
  }
});

GaugeVoter.GaugeMetadataUpdated.handler(async ({ event, context }) => {
  const id = gaugeId(event.chainId, event.params.gauge);
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({
      ...gauge,
      metadataUri: event.params.metadataURI || gauge.metadataUri,
    });
  }
});

GaugeVoter.Voted.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const voterAddress = getAddress(event.params.voter);
  const epoch = event.params.epoch.toString();

  context.GaugeVote.set({
    id: gaugeVoteId(chainId, gaugeAddress, voterAddress, epoch, event.logIndex),
    chainId,
    pluginAddress,
    gaugeAddress,
    voterAddress,
    epoch,
    votingPower: event.params.votingPowerCastForGauge,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  await addMember(context, { address: voterAddress, blockNumber: event.block.number });
});

GaugeVoter.Reset.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const gaugeAddress = getAddress(event.params.gauge);
  const voterAddress = getAddress(event.params.voter);
  const epoch = event.params.epoch.toString();

  context.GaugeVote.set({
    id: gaugeVoteId(chainId, gaugeAddress, voterAddress, epoch, event.logIndex, GaugeVoteKind.Reset),
    chainId,
    pluginAddress,
    gaugeAddress,
    voterAddress,
    epoch,
    votingPower: 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });

  await addMember(context, { address: voterAddress, blockNumber: event.block.number });
});

GaugeVoter.GaugeVoterMetadataSet.handler(async ({ event, context }) => {
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
