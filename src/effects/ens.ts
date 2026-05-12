import { createEffect, S } from "envio";
import { keccak256, parseAbi, toHex } from "viem";
import { getClient } from "../helpers/rpcProvider";

// ENS lives on Ethereum mainnet only — even for DAOs on other chains, we
// resolve names against mainnet. Mirrors the legacy `EnsHelper` behaviour.
const ENS_CHAIN_ID = 1;
const BASE_REGISTRAR = "0x57f1887a8BF19b14fC0dF6Fd9B2acc9Af147eA85" as const;

const baseRegistrarAbi = parseAbi(["function nameExpires(uint256 id) view returns (uint256)"]);

/**
 * Reverse-lookup an address to its primary ENS name + avatar on mainnet,
 * with forward verification (viem's `getEnsName` already does reverse +
 * forward via the Universal Resolver). For `.eth` second-level domains we
 * additionally fetch the BaseRegistrar expiration timestamp so consumers
 * can decide whether to trust the name. `.dao.eth` subdomains and non-
 * `.eth` names have no expiration.
 *
 * Returns `{ name, avatar, expiresAt }`. `expiresAt` is the on-chain
 * BaseRegistrar timestamp in seconds (null when not applicable). Time-
 * dependent comparison (`expiresAt * 1000 <= Date.now()`) is the
 * caller's job — it can't live inside this effect because the result is
 * cached and a `Date.now()` check would freeze in the cached output.
 */
export const fetchEnsForAddress = createEffect(
  {
    name: "fetchEnsForAddress",
    input: S.schema({ address: S.string }),
    output: S.union([
      S.schema({
        name: S.union([S.string, null]),
        avatar: S.union([S.string, null]),
        expiresAt: S.union([S.number, null]),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(ENS_CHAIN_ID);
      const name = await client.getEnsName({ address: input.address as `0x${string}` });
      if (!name) return { name: null, avatar: null, expiresAt: null };

      // Aragon-managed dao.eth subdomains aren't on the public registry — no
      // expiration to fetch. Same for non-.eth names.
      const isExempt = !name.endsWith(".eth") || name.endsWith(".dao.eth");

      // Only fetch expiration for second-level .eth (e.g., "vitalik.eth").
      // Deeper subdomains (e.g., "wallet.vitalik.eth") inherit lifetime from
      // the parent and aren't tracked by BaseRegistrar.
      const [label, tld, ...rest] = name.split(".");
      const fetchExpiry = !isExempt && label && tld === "eth" && rest.length === 0;

      let expiresAt: number | null = null;
      if (fetchExpiry && label) {
        const labelHash = keccak256(toHex(label));
        const onchain = await client.readContract({
          address: BASE_REGISTRAR,
          abi: baseRegistrarAbi,
          functionName: "nameExpires",
          args: [BigInt(labelHash)],
        });
        expiresAt = Number(onchain);
      }

      // Avatar lookup is best-effort — failures (no record, IPFS gateway
      // down, malformed text record) shouldn't drop the name resolution.
      let avatar: string | null = null;
      try {
        avatar = await client.getEnsAvatar({ name });
      } catch {
        /* ignore */
      }

      return { name, avatar, expiresAt };
    } catch {
      return null;
    }
  },
);

/**
 * Convenience wrapper: returns `{ name, avatar }` with `name` nulled out
 * when the name has expired against the current wall clock. Use this from
 * handlers/services that want the time-checked answer; the underlying
 * Effect stays cache-safe because the comparison happens outside it.
 */
export function ensIsExpired(expiresAt: number | null | undefined, nowMs = Date.now()): boolean {
  return expiresAt !== null && expiresAt !== undefined && expiresAt * 1000 <= nowMs;
}
