import { DAO } from "generated";
import { PermissionEvent, TransferSide, TransferType, UPGRADE_TO_AND_CALL_SELECTOR, ZERO_ADDRESS } from "../constants";
import { fetchDaoInfo } from "../effects/rpc";
import { fetchDaoMetadata } from "../effects/ipfs";
import { daoId as makeDaoId, eventId, transferId } from "../utils/ids";
import { extractIpfsCid, safeJsonParse } from "../utils/metadata";

DAO.MetadataSet.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = makeDaoId({ chainId, daoAddress });

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
    processKey: metadata?.processKey ?? dao.processKey,
    stageNames: safeJsonParse(metadata?.stageNamesJson) ?? dao.stageNames,
    blockedCountries: safeJsonParse(metadata?.blockedCountriesJson) ?? dao.blockedCountries,
    termsConditionsUrl: metadata?.termsConditionsUrl ?? dao.termsConditionsUrl,
    enableOfacCheck: metadata?.enableOfacCheck ?? dao.enableOfacCheck,
  });
});

DAO.NativeTokenDeposited.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = makeDaoId({ chainId, daoAddress });

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  // Skip zero-amount deposits
  if (event.params.amount === 0n) return;

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = transferId({
    chainId,
    daoAddress,
    txHash: event.transaction.hash,
    type: "native",
    logIndex: event.logIndex,
  });

  context.Transfer.set({
    id,
    chainId,
    dao_id: daoId,
    daoAddress,
    type: TransferType.Native,
    side: TransferSide.Deposit,
    fromAddress: event.params.sender,
    toAddress: daoAddress,
    value: event.params.amount,
    tokenAddress: ZERO_ADDRESS,
    tokenId: undefined,
    actionIndex: undefined,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    txIndex,
    logIndex: event.logIndex,
  });
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
  const daoId = makeDaoId({ chainId, daoAddress });

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.DaoPermission.set({
    id,
    chainId,
    dao_id: daoId,
    daoAddress,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    permissionId: event.params.permissionId,
    whoAddress: event.params.who,
    whereAddress: event.params.where,
    event: PermissionEvent.Granted,
    conditionAddress: event.params.condition || undefined,
  });
});

DAO.Revoked.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = makeDaoId({ chainId, daoAddress });

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const id = eventId({ chainId, txHash: event.transaction.hash, txIndex, logIndex: event.logIndex });

  context.DaoPermission.set({
    id,
    chainId,
    dao_id: daoId,
    daoAddress,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    txIndex,
    permissionId: event.params.permissionId,
    whoAddress: event.params.who,
    whereAddress: event.params.where,
    event: PermissionEvent.Revoked,
    conditionAddress: undefined,
  });
});

DAO.Executed.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.srcAddress;
  const daoId = makeDaoId({ chainId, daoAddress });

  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const txIndex = Number(event.transaction.transactionIndex ?? 0);
  const actions = event.params.actions;

  for (let i = 0; i < actions.length; i++) {
    const action = actions[i]!;
    const to = String(action[0] ?? "");
    const value = BigInt(action[1] ?? 0n);
    const data = String(action[2] ?? "0x");

    // 1. Track native outgoing transfers (actions with value > 0)
    if (value > 0n) {
      const id = transferId({
        chainId,
        daoAddress,
        txHash: event.transaction.hash,
        type: "native",
        actionIndex: i,
      });

      context.Transfer.set({
        id,
        chainId,
        dao_id: daoId,
        daoAddress,
        type: TransferType.Native,
        side: TransferSide.Withdraw,
        fromAddress: daoAddress,
        toAddress: to,
        value,
        tokenAddress: ZERO_ADDRESS,
        tokenId: undefined,
        actionIndex: i,
        blockNumber: event.block.number,
        blockTimestamp: event.block.timestamp,
        transactionHash: event.transaction.hash,
        txIndex,
        logIndex: event.logIndex,
      });
    }

    // 2. Detect DAO upgrade (upgradeToAndCall targeting the DAO itself)
    if (
      to.toLowerCase() === daoAddress.toLowerCase() &&
      data.startsWith(UPGRADE_TO_AND_CALL_SELECTOR)
    ) {
      // Re-fetch version after upgrade
      const daoInfo = await context.effect(fetchDaoInfo, { daoAddress, chainId });
      if (daoInfo?.version || daoInfo?.implementationAddress) {
        context.Dao.set({
          ...dao,
          version: daoInfo.version ?? dao.version,
          implementationAddress: daoInfo.implementationAddress ?? dao.implementationAddress,
        });
      }
    }
  }
});
