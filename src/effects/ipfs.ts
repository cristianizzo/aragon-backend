import { createEffect, S } from "envio";
import { fetchFromIpfs } from "../helpers/ipfs";

/**
 * Fetch arbitrary JSON from IPFS by CID and return the raw payload as a
 * string. Parsing into entity-specific shapes (DAO / Plugin / Proposal /
 * ...) is done synchronously by callers via `utils/metadata` parsers.
 *
 * Why one effect instead of per-entity effects: every `MetadataSet`-style
 * event ultimately hits the same gateway with the same CID. Keying the
 * cache on CID alone means that if the same CID is referenced by multiple
 * entity types (e.g., a template DAO whose plugin metadata reuses the
 * same file) we hit the cache instead of re-fetching. It also keeps the
 * IPFS schema concern in one place — no more `S.optional` vs `S.union`
 * drift across per-entity effect outputs.
 */
export const fetchIpfsJson = createEffect(
  {
    name: "fetchIpfsJson",
    input: S.string,
    output: S.union([S.string, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input: cid }) => {
    const data = await fetchFromIpfs<unknown>(cid);
    return data ? JSON.stringify(data) : null;
  },
);
