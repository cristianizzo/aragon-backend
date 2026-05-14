import { indexer } from "envio";
import { getAddress } from "viem";
import { fetchDaoVersion, fetchImplementationAddress } from "../effects/dao";
import logger from "../helpers/logger";
import { addMember } from "../services/member";
import { buildDaoEnsName } from "../utils/ens";
import { daoId } from "../utils/ids";
import { validateString } from "../utils/validate";

const llo = logger.logMeta.bind(null, { service: "handlers:DAORegistry" });

// Tell Envio to start indexing events from the new DAO address. Runs in a
// pre-handler phase: no async, no DB writes, only address registration so
// subsequent DAO events (MetadataSet, Granted, ...) get routed to our DAO
// handlers from this block forward.
indexer.contractRegister({ contract: "DAORegistry", event: "DAORegistered" }, async ({ event, context }) => {
  context.chain.DAO.add(event.params.dao);
});

indexer.onEvent({ contract: "DAORegistry", event: "DAORegistered" }, async ({ event, context }) => {
  const { chainId } = event;
  const daoAddress = getAddress(event.params.dao);
  const creatorAddress = getAddress(event.params.creator);
  const id = daoId(chainId, daoAddress);
  const subdomain = validateString(event.params.subdomain);

  const ens = subdomain ? buildDaoEnsName(subdomain) : null;
  const [implementationAddress, version, existing] = await Promise.all([
    context.effect(fetchImplementationAddress, { proxyAddress: daoAddress, chainId }),
    context.effect(fetchDaoVersion, { daoAddress, chainId }),
    // Stub-then-merge: in the DAOFactory creation tx, MetadataSet fires first
    // (lower logIndex) and writes a stub Dao with metadata only. We preserve
    // those metadata fields here while filling in the registration-time fields.
    context.Dao.get(id),
  ]);

  context.Dao.set({
    id,
    chainId,
    address: daoAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    creatorAddress,
    subdomain,
    implementationAddress: implementationAddress ?? undefined,
    ens: ens ?? undefined,
    version,
    metadataUri: existing?.metadataUri,
    name: existing?.name,
    description: existing?.description,
    avatar: existing?.avatar,
    links: existing?.links,
    blockedCountries: existing?.blockedCountries,
    enableOfacCheck: existing?.enableOfacCheck,
    termsConditionsUrl: existing?.termsConditionsUrl,
    proposalCount: existing?.proposalCount ?? 0,
    proposalsExecuted: existing?.proposalsExecuted ?? 0,
    uniqueVoters: existing?.uniqueVoters ?? 0,
    voteCount: existing?.voteCount ?? 0,
    memberCount: existing?.memberCount ?? 0,
    isActive: existing?.isActive ?? true,
    isHidden: existing?.isHidden ?? false,
  });

  logger.debug(
    "Dao created",
    llo({
      id,
      chainId,
      daoAddress,
      subdomain,
      version,
      hadMetadataStub: existing !== undefined,
      blockNumber: event.block.number,
      transactionHash: event.transaction.hash,
    }),
  );

  await addMember(context, { address: creatorAddress, blockNumber: event.block.number });
});
