import type { EvmOnEventContext as HandlerContext } from "envio";
import { getAddress } from "viem";
import { ZERO_ADDRESS } from "../constants";
import { fetchDaoVersion } from "../effects/dao";
import { fetchIpfsJson } from "../effects/ipfs";
import logger from "../helpers/logger";
import { daoId, eventLogId } from "../utils/ids";
import { extractIpfsCid, parseDaoMetadata } from "../utils/metadata";

const llo = logger.logMeta.bind(null, { service: "services:dao" });

/**
 * Apply a `MetadataSet(bytes metadata)` event to the Dao entity, mirror to
 * `DaoMetadataLog`, and handle the stub-then-merge race with `DAORegistered`.
 *
 * In the DAOFactory creation tx, MetadataSet is emitted BEFORE DAORegistered
 * (lower logIndex). Envio dispatches in logIndex order, so this service runs
 * first and the Dao row doesn't exist yet — we write a stub with metadata +
 * placeholders. The DAORegistered handler will overwrite the placeholders
 * with real values while preserving the metadata we set here.
 */
export async function applyDaoMetadata(
  context: HandlerContext,
  args: {
    chainId: number;
    daoAddress: string;
    metadata: string;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
    logIndex: number;
  },
): Promise<void> {
  const daoAddress = getAddress(args.daoAddress);
  const id = daoId(args.chainId, daoAddress);

  const cid = extractIpfsCid(args.metadata);
  if (!cid) return;

  const raw = await context.effect(fetchIpfsJson, cid);
  const metadata = parseDaoMetadata(raw);
  const metadataUri = `ipfs://${cid}`;

  // Audit-log every MetadataSet event so consumers can reconstruct historical
  // DAO names/descriptions and detect IPFS-rot. Latest values still live on
  // the Dao entity below; this row preserves prior versions.
  context.DaoMetadataLog.set({
    id: eventLogId(args.chainId, args.transactionHash, args.logIndex),
    chainId: args.chainId,
    dao_id: id,
    daoAddress,
    metadataUri,
    rawMetadata: args.metadata,
    name: metadata?.name,
    description: metadata?.description,
    avatar: metadata?.avatar,
    links: metadata?.links,
    blockedCountries: metadata?.blockedCountries,
    enableOfacCheck: metadata?.enableOfacCheck,
    termsConditionsUrl: metadata?.termsConditionsUrl,
    fetchSucceeded: metadata !== null,
    blockNumber: args.blockNumber,
    blockTimestamp: args.blockTimestamp,
    transactionHash: args.transactionHash,
    logIndex: args.logIndex,
  });

  const dao = await context.Dao.get(id);

  if (!dao) {
    context.Dao.set({
      id,
      chainId: args.chainId,
      address: daoAddress,
      blockNumber: args.blockNumber,
      blockTimestamp: args.blockTimestamp,
      transactionHash: args.transactionHash,
      creatorAddress: ZERO_ADDRESS,
      subdomain: undefined,
      implementationAddress: undefined,
      ens: undefined,
      version: undefined,
      metadataUri,
      name: metadata?.name,
      description: metadata?.description,
      avatar: metadata?.avatar,
      links: metadata?.links,
      blockedCountries: metadata?.blockedCountries,
      enableOfacCheck: metadata?.enableOfacCheck,
      termsConditionsUrl: metadata?.termsConditionsUrl,
      proposalCount: 0,
      proposalsExecuted: 0,
      uniqueVoters: 0,
      voteCount: 0,
      memberCount: 0,
      isActive: true,
      isHidden: false,
    });
    logger.debug(
      "Dao stub created from MetadataSet",
      llo({ id, metadataUri, name: metadata?.name, transactionHash: args.transactionHash }),
    );
    return;
  }

  context.Dao.set({
    ...dao,
    metadataUri,
    name: metadata?.name ?? dao.name,
    description: metadata?.description ?? dao.description,
    avatar: metadata?.avatar ?? dao.avatar,
    links: metadata?.links ?? dao.links,
    blockedCountries: metadata?.blockedCountries ?? dao.blockedCountries,
    enableOfacCheck: metadata?.enableOfacCheck ?? dao.enableOfacCheck,
    termsConditionsUrl: metadata?.termsConditionsUrl ?? dao.termsConditionsUrl,
  });

  logger.debug(
    "Dao updated (metadata)",
    llo({ id, metadataUri, name: metadata?.name, transactionHash: args.transactionHash }),
  );
}

/**
 * Apply an OZ-style proxy upgrade — refresh `implementationAddress` and
 * `version` on the Dao row. Fires AFTER `DAORegistered` (always, since
 * upgrades happen via later governance), so Dao should always exist by the
 * time this runs.
 */
export async function applyDaoUpgrade(
  context: HandlerContext,
  args: {
    chainId: number;
    daoAddress: string;
    implementationAddress: string;
    transactionHash: string;
  },
): Promise<void> {
  const daoAddress = getAddress(args.daoAddress);
  const id = daoId(args.chainId, daoAddress);

  const dao = await context.Dao.get(id);
  if (!dao) return;

  const newImplementationAddress = getAddress(args.implementationAddress);
  if (newImplementationAddress === dao.implementationAddress) return;

  // `protocolVersion()` reads from the proxy and returns whatever the new
  // impl exposes — calling against daoAddress is correct here.
  const newVersion = await context.effect(fetchDaoVersion, { daoAddress, chainId: args.chainId });

  context.Dao.set({
    ...dao,
    implementationAddress: newImplementationAddress,
    version: newVersion,
  });

  logger.debug(
    "Dao upgraded",
    llo({
      id,
      oldImpl: dao.implementationAddress,
      newImpl: newImplementationAddress,
      oldVersion: dao.version,
      newVersion,
      transactionHash: args.transactionHash,
    }),
  );
}
