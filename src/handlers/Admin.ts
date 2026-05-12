import { Admin } from "generated";
import { getAddress } from "viem";
import { pluginId } from "../ids";
import { applyPluginMetadata } from "../services/pluginMetadata";
import { createProposal, executeProposal } from "../services/proposal";

/**
 * Admin plugin = single-member instant execution. `ProposalCreated` and
 * `ProposalExecuted` are typically emitted in the same transaction (the
 * Admin contract executes the proposal as part of `executeProposal`). There
 * is no Approve / VoteCast step — execution is the proposal.
 *
 * Membership lives in a separate contract announced once via
 * `MembershipContractAnnounced` at install time. We capture that address on
 * the Plugin row (`tokenAddress`-style stash via the Plugin entity) so the
 * frontend can resolve "who is the admin".
 *
 * Proposal entity shape mirrors Multisig.ts so the same query path works for
 * both. `voteCount` stays 0 (no votes), `executed` flips true in the
 * Executed handler. We snapshot `membersCount = 1` since Admin is by
 * definition single-signer.
 */

Admin.AdminProposalCreated.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const plugin_id = pluginId(chainId, pluginAddress);

  const plugin = await context.Plugin.get(plugin_id);
  if (!plugin) return;

  await createProposal(context, {
    chainId,
    pluginAddress,
    plugin_id,
    dao_id: plugin.dao_id,
    daoAddress: plugin.daoAddress,
    proposalIndex: event.params.proposalId.toString(),
    creatorAddress: getAddress(event.params.creator),
    metadata: event.params.metadata,
    actions: event.params.actions,
    allowFailureMap: event.params.allowFailureMap,
    startDate: event.params.startDate,
    endDate: event.params.endDate,
    // Admin = single-EOA executor. Snapshot is fixed at one member.
    snapshot: { membersCount: 1 },
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  });
});

Admin.AdminProposalExecuted.handler(async ({ event, context }) =>
  executeProposal(context, {
    chainId: event.chainId,
    pluginAddress: getAddress(event.srcAddress),
    proposalIndex: event.params.proposalId.toString(),
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
  }),
);

// Admin holds its membership in a separate contract (typically a single-EOA
// "owner"). The address is announced once at install via this event. We stash
// it on the Plugin row as `tokenAddress` so a single GraphQL query can
// resolve "who can execute via this plugin" — same field used by
// tokenVoting/lockToVote, just repurposed here for the admin address.
Admin.MembershipContractAnnounced.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const pluginAddress = getAddress(event.srcAddress);
  const plugin = await context.Plugin.get(pluginId(chainId, pluginAddress));
  if (!plugin) return;

  const definingContract = getAddress(event.params.definingContract);
  context.Plugin.set({ ...plugin, tokenAddress: definingContract });
});

Admin.AdminMetadataSet.handler(async ({ event, context }) => {
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
