import { DAORegistry } from "generated";
import { fetchDaoInfo } from "../effects/rpc";
import { daoId } from "../utils/ids";

// Register DAO address for dynamic event tracking
DAORegistry.DAORegistered.contractRegister(({ event, context }) => {
  context.addDAO(event.params.dao);
});

DAORegistry.DAORegistered.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.params.dao;
  const id = daoId({ chainId, daoAddress });

  const existing = await context.Dao.get(id);
  if (existing) return;

  // Fetch implementation address (EIP-1967 proxy) and protocol version via RPC
  const daoInfo = await context.effect(fetchDaoInfo, { daoAddress, chainId });

  // Derive ENS from subdomain: ${subdomain}.dao.eth
  const subdomain = event.params.subdomain || undefined;
  const ens = subdomain ? `${subdomain}.dao.eth` : undefined;

  context.Dao.set({
    id,
    chainId,
    address: daoAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    creatorAddress: event.params.creator,
    subdomain,
    implementationAddress: daoInfo?.implementationAddress,
    ens,
    version: daoInfo?.version,
    metadataUri: undefined,
    name: undefined,
    description: undefined,
    avatar: undefined,
    links: undefined,
    processKey: undefined,
    stageNames: undefined,
    blockedCountries: undefined,
    termsConditionsUrl: undefined,
    enableOfacCheck: undefined,
    proposalCount: 0,
    proposalsExecuted: 0,
    uniqueVoters: 0,
    voteCount: 0,
    memberCount: 0,
  });
});
