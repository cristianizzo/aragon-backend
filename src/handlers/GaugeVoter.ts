import { GaugeVoter } from "generated";

GaugeVoter.GaugeCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = event.srcAddress;
  const gaugeAddress = event.params.gauge;
  const id = `${chainId}-${gaugeAddress}`;

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
  const id = `${event.chainId}-${event.params.gauge}`;
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: "Active" });
  }
});

GaugeVoter.GaugeDeactivated.handler(async ({ event, context }) => {
  const id = `${event.chainId}-${event.params.gauge}`;
  const gauge = await context.Gauge.get(id);
  if (gauge) {
    context.Gauge.set({ ...gauge, status: "Deactivated" });
  }
});

GaugeVoter.GaugeMetadataUpdated.handler(async ({ event, context }) => {
  const id = `${event.chainId}-${event.params.gauge}`;
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
  const epoch = event.params.epoch.toString();
  const id = `${chainId}-${event.params.gauge}-${event.params.voter}-${epoch}-${event.logIndex}`;

  context.GaugeVote.set({
    id,
    chainId,
    pluginAddress,
    gaugeAddress: event.params.gauge,
    voterAddress: event.params.voter,
    epoch,
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
  const epoch = event.params.epoch.toString();
  const id = `${chainId}-${event.params.gauge}-${event.params.voter}-${epoch}-reset-${event.logIndex}`;

  context.GaugeVote.set({
    id,
    chainId,
    pluginAddress,
    gaugeAddress: event.params.gauge,
    voterAddress: event.params.voter,
    epoch,
    votingPower: 0n,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});
