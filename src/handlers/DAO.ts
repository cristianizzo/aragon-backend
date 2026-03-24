import { DAO } from "generated";
import { safeJsonParse, ZERO_ADDRESS } from "../constants";
import { fetchDaoMetadata } from "../effects/ipfs";
import { extractIpfsCid } from "../utils/metadata";

DAO.MetadataSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = `${chainId}-${daoAddress}`;

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const cid = extractIpfsCid(event.params.metadata);
  if (!cid) return;

  const metadata = await context.effect(fetchDaoMetadata, cid);

  context.Dao.set({
    ...dao,
    metadataUri: `ipfs://${cid}`,
    name: metadata?.name ?? dao.name,
    description: metadata?.description ?? dao.description,
    avatar: metadata?.avatar ?? dao.avatar,
    links: safeJsonParse(metadata?.linksJson) ?? dao.links,
  });
});

DAO.NativeTokenDeposited.handler(async ({ event, context }) => {
  // Log native token deposits — can be used for TVL tracking
  // The DAO entity already exists from DAORegistered
  // No entity update needed for basic indexing
});

// Register condition addresses for ExecuteSelectorCondition events
DAO.Granted.contractRegister(({ event, context }) => {
  const condition = event.params.condition;
  if (condition && condition !== ZERO_ADDRESS) {
    context.addExecuteSelectorCondition(condition);
  }
});

DAO.Granted.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = `${chainId}-${daoAddress}`;

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const id = `${chainId}-${event.transaction.hash}-${event.logIndex}`;

  context.DaoPermission.set({
    id,
    chainId,
    dao_id: daoId,
    daoAddress,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    permissionId: event.params.permissionId,
    whoAddress: event.params.who,
    whereAddress: event.params.where,
    event: "Granted",
    conditionAddress: event.params.condition || undefined,
  });
});

DAO.Revoked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = `${chainId}-${daoAddress}`;

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const id = `${chainId}-${event.transaction.hash}-${event.logIndex}`;

  context.DaoPermission.set({
    id,
    chainId,
    dao_id: daoId,
    daoAddress,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    permissionId: event.params.permissionId,
    whoAddress: event.params.who,
    whereAddress: event.params.where,
    event: "Revoked",
    conditionAddress: undefined,
  });
});

DAO.Executed.handler(async ({ event, context }) => {
  // Log execution events — tracks on-chain actions executed by DAOs
  // Can be extended to decode action data in the future
});
