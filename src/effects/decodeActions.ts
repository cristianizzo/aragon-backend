import { createEffect, S } from "envio";
import { type DecodedAction, decodeActions } from "../helpers/actionDecoder";

/**
 * Effect to decode proposal actions.
 * Uses a multi-stage pipeline: Known ABIs → Proxy Detection → Etherscan → 4bytes → Unknown
 * Results are cached per unique input (same actions array = cache hit).
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
    output: S.union([S.unknown, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      if (!input.actions || input.actions.length === 0) return null;

      const decoded = await decodeActions(input.actions, input.chainId, input.daoAddress);

      return decoded as any;
    } catch {
      return null;
    }
  },
);
