import { GaugeVoter } from "generated";
import { eventId, gaugeId as makeGaugeId } from "../utils/ids";

GaugeVoter.GaugeCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const gaugeAddress = event.params.gauge;
  const id = makeGaugeId({ chainId, pluginAddress, gaugeAddress });

  context.Gauge.set({
    id,
    chainId,
    address: gaugeAddress,
    pluginAddress,
    creatorAddress: event.params.creator,
    metadataUri: event.params.metadataURI || undefined,
    status: "Active",
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
  });
});

GaugeVoter.GaugeActivated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const id = makeGaugeId({ chainId, pluginAddress, gaugeAddress: event.params.gauge });
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: "Active" });
  }
});

GaugeVoter.GaugeDeactivated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const id = makeGaugeId({ chainId, pluginAddress, gaugeAddress: event.params.gauge });
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: "Deactivated" });
  }
});

GaugeVoter.GaugeMetadataUpdated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const id = makeGaugeId({ chainId, pluginAddress, gaugeAddress: event.params.gauge });
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
  const pluginAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.GaugeVote.set({
    id,
    chainId,
    pluginAddress,
    gaugeAddress: event.params.gauge,
    voterAddress: event.params.voter,
    epoch: event.params.epoch.toString(),
    votingPower: event.params.votingPowerCastForGauge,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});

GaugeVoter.Reset.handler(async ({ event, context }) => {
  // Reset removes voting power from a gauge for a voter in an epoch
  // We log it as a GaugeVote with 0 voting power for tracking
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.GaugeVote.set({
    id,
    chainId,
    pluginAddress,
    gaugeAddress: event.params.gauge,
    voterAddress: event.params.voter,
    epoch: event.params.epoch.toString(),
    votingPower: 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});
