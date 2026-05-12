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
 * additionally check the BaseRegistrar expiration. `.dao.eth` subdomains
 * skip expiration since Aragon's `dao.eth` manager controls them, not the
 * public ENS registry.
 *
 * Returns `{ name, avatar }` — both individually nullable. The avatar
 * lookup runs only when name resolution succeeds (no point fetching the
 * avatar for an address with no ENS).
 */
export const fetchEnsForAddress = createEffect(
  {
    name: "fetchEnsForAddress",
    input: S.schema({ address: S.string }),
    output: S.union([
      S.schema({
        name: S.union([S.string, null]),
        avatar: S.union([S.string, null]),
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
      if (!name) return { name: null, avatar: null };

      // Aragon-managed dao.eth subdomains aren't on the public registry — no
      // expiration to check. Same for non-.eth names (we don't expire those).
      const isExempt = !name.endsWith(".eth") || name.endsWith(".dao.eth");

      // Only check expiration for second-level .eth (e.g., "vitalik.eth").
      // Deeper subdomains (e.g., "wallet.vitalik.eth") inherit lifetime from
      // the parent and aren't tracked by BaseRegistrar.
      const [label, tld, ...rest] = name.split(".");
      const checkExpiry = !isExempt && label && tld === "eth" && rest.length === 0;

      if (checkExpiry && label) {
        const labelHash = keccak256(toHex(label));
        const expiresAt = await client.readContract({
          address: BASE_REGISTRAR,
          abi: baseRegistrarAbi,
          functionName: "nameExpires",
          args: [BigInt(labelHash)],
        });
        if (Number(expiresAt) * 1000 <= Date.now()) {
          return { name: null, avatar: null };
        }
      }

      // Avatar lookup is best-effort — failures (no record, IPFS gateway
      // down, malformed text record) shouldn't drop the name resolution.
      let avatar: string | null = null;
      try {
        avatar = await client.getEnsAvatar({ name });
      } catch {
        /* ignore */
      }

      return { name, avatar };
    } catch {
      return null;
    }
  },
);
