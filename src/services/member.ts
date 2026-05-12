import type { HandlerContext } from "generated";
import { ZERO_ADDRESS } from "../constants";
import { fetchEnsForAddress } from "../effects/ens";
import logger from "../helpers/logger";
import { memberId } from "../ids";

const llo = logger.logMeta.bind(null, { service: "services:member" });

/**
 * Add a member for an address (idempotent), tracking first/last activity
 * blocks. Mirrors legacy `BaseGovernance.ensureBaseMember`:
 *   - create on first sight, resolving mainnet ENS once
 *   - update `lastActivityBlock` if we've seen a newer block
 *   - backfill `firstActivityBlock` if it was null
 *
 * The Member row is global (no chainId) — same wallet on eth and polygon is
 * the same Member. Activity blocks are therefore "latest across any chain".
 */
export async function addMember(
  context: HandlerContext,
  params: { address: string; blockNumber: number },
): Promise<void> {
  // Skip the zero address — delegation events use it to mean "no delegate",
  // burns/mints use it as the counterparty, etc. Persisting it as a Member
  // would conflate every "no-one" reference into one global entity.
  const id = memberId(params.address);
  if (id === ZERO_ADDRESS) return;
  const existing = await context.Member.get(id);

  if (!existing) {
    const ens = await context.effect(fetchEnsForAddress, { address: id });
    context.Member.set({
      id,
      address: id,
      ens: ens?.name ?? undefined,
      avatar: ens?.avatar ?? undefined,
      firstActivityBlock: params.blockNumber,
      lastActivityBlock: params.blockNumber,
    });
    logger.debug("Member created", llo({ id, ens: ens?.name, blockNumber: params.blockNumber }));
    return;
  }

  if (params.blockNumber > (existing.lastActivityBlock ?? 0)) {
    context.Member.set({
      ...existing,
      lastActivityBlock: params.blockNumber,
      firstActivityBlock: existing.firstActivityBlock ?? params.blockNumber,
    });
    logger.debug("Member updated", llo({ id, lastActivityBlock: params.blockNumber }));
  }
}
