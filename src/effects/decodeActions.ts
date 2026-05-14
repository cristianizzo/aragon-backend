import { createEffect, S } from "envio";
import { decodeActions } from "../helpers/actionDecoder";

/**
 * Decode proposal actions through a multi-stage pipeline (Known ABIs →
 * Proxy Detection → Etherscan → 4bytes → Unknown).
 *
 * Output is **stringified JSON** rather than the raw array — `S.unknown`
 * + `cache: true` does not round-trip through Envio's effect cache
 * table in v3.0.0-alpha.18 (the cache writer's schema converter rejects
 * non-scalar shapes with `Expected undefined | null, received [...]`).
 * Storing as a string avoids the converter entirely. Caller must
 * `JSON.parse` the result; consumers that put the value straight into a
 * `Json` schema column should pass the string through `safeJsonParse`
 * first.
 *
 * Caching is **disabled** here. The Envio effect cache puts a B-tree
 * index on the input column, and Postgres's hard 8191-byte limit per
 * index row crashes the indexer on any proposal whose serialized
 * actions exceed that (encountered in production around event 790M when
 * a proposal carried >13KB of calldata across its actions). Sub-call
 * caches inside `actionDecoder.ts` (Etherscan source map, 4byte
 * directory map, EIP-1967 proxy map — all in-memory `Map`s) still dedupe
 * within the process so the per-proposal cost is bounded by the unique
 * targets / selectors, not the full pipeline.
 */
export const decodeProposalActions = createEffect(
  {
    name: "decodeProposalActions",
    input: S.schema({
      actions: S.array(
        S.schema({
          to: S.string,
          value: S.string,
          data: S.string,
        }),
      ),
      chainId: S.number,
      daoAddress: S.string,
    }),
    output: S.union([S.string, null]),
    cache: false,
    rateLimit: false,
  },
  async ({ input }) => {
    if (!input.actions || input.actions.length === 0) return null;
    try {
      const decoded = await decodeActions(input.actions, input.chainId, input.daoAddress);
      return JSON.stringify(decoded);
    } catch {
      return null;
    }
  },
);
