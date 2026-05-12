import { createEffect, S } from "envio";
import { getClient } from "../helpers/rpcProvider";

/**
 * Fetch a transaction's receipt logs as a stringified JSON blob.
 *
 * Why this exists: Envio's HyperSync streams logs filtered by the contracts
 * it knows about. When a contract is registered dynamically via
 * `contractRegister` mid-block, events from that contract emitted earlier in
 * the SAME block aren't streamed (HyperSync had already pre-fetched). We
 * need a backfill path to catch those missed events — most commonly:
 *   - `MembersAdded` from a Multisig/AddresslistVoting plugin's `initialize`
 *   - `SettingsUpdated` (per-plugin variant) from the same `initialize`
 *   - `MetadataSet` if the plugin's `initialize` sets metadata
 *
 * Cached per `(chainId, txHash)` because the same install tx is processed
 * once but consumed multiple times (Members + Settings + Metadata
 * decoders all read the same receipt). One RPC call per install.
 *
 * Output is stringified JSON (mirrors `decodeProposalActions`) — the
 * envio cache layer can't round-trip nested log objects via `S.unknown`.
 */
export const fetchTxReceiptLogs = createEffect(
  {
    name: "fetchTxReceiptLogs",
    input: S.schema({ chainId: S.number, txHash: S.string }),
    output: S.union([S.string, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const receipt = await client.getTransactionReceipt({ hash: input.txHash as `0x${string}` });
      // Slim the log shape to what consumers need — keeps the cache
      // payload small and avoids serializing irrelevant viem fields.
      const slim = receipt.logs.map((l) => ({
        address: l.address,
        topics: l.topics,
        data: l.data,
        logIndex: l.logIndex,
      }));
      return JSON.stringify(slim);
    } catch {
      return null;
    }
  },
);
