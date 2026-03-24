import { createEffect, S } from "envio";
import { getClient } from "../config";
import { ERC20_METADATA_ABI, ESCROW_ABI, LOCK_MANAGER_ABI, LOCK_NFT_ABI, QUEUE_ABI, TOKEN_ABI } from "../constants";

/**
 * Discover VotingEscrow addresses from a token's adapter contract.
 * Chain: tokenAddress.escrow() → escrowAddress.queue() → exitQueueAddress
 */
export const discoverVotingEscrow = createEffect(
  {
    name: "discoverVotingEscrow",
    input: S.schema({ tokenAddress: S.string, chainId: S.number }),
    output: S.union([
      S.schema({
        escrowAddress: S.string,
        exitQueueAddress: S.optional(S.string),
        nftLockAddress: S.optional(S.string),
        underlyingToken: S.optional(S.string),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const addr = input.tokenAddress as `0x${string}`;

      // Try to get escrow address from token adapter
      let escrowAddress: string;
      try {
        escrowAddress = await client.readContract({
          address: addr,
          abi: ESCROW_ABI,
          functionName: "escrow",
        });
      } catch {
        return null; // Not a VE token
      }

      // Get sub-contracts from escrow
      const [exitQueueAddress, nftLockAddress, underlyingToken] = await Promise.allSettled([
        client.readContract({ address: escrowAddress as `0x${string}`, abi: QUEUE_ABI, functionName: "queue" }),
        client.readContract({ address: escrowAddress as `0x${string}`, abi: LOCK_NFT_ABI, functionName: "lockNFT" }),
        client.readContract({ address: escrowAddress as `0x${string}`, abi: TOKEN_ABI, functionName: "token" }),
      ]);

      return {
        escrowAddress,
        exitQueueAddress: exitQueueAddress.status === "fulfilled" ? exitQueueAddress.value : undefined,
        nftLockAddress: nftLockAddress.status === "fulfilled" ? nftLockAddress.value : undefined,
        underlyingToken: underlyingToken.status === "fulfilled" ? underlyingToken.value : undefined,
      };
    } catch {
      return null;
    }
  },
);

/**
 * Fetch ERC20 token metadata (name, symbol, decimals) via RPC.
 */
export const fetchTokenMetadata = createEffect(
  {
    name: "fetchTokenMetadata",
    input: S.schema({ tokenAddress: S.string, chainId: S.number }),
    output: S.union([
      S.schema({
        name: S.optional(S.string),
        symbol: S.optional(S.string),
        decimals: S.optional(S.number),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const addr = input.tokenAddress as `0x${string}`;

      const [name, symbol, decimals] = await Promise.allSettled([
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "name" }),
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
      ]);

      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from on-chain strings
      const sanitize = (s: string | undefined): string | undefined =>
        s?.replace(/[\x00-\x1f]/g, "").trim() || undefined;

      return {
        name: name.status === "fulfilled" ? sanitize(name.value) : undefined,
        symbol: symbol.status === "fulfilled" ? sanitize(symbol.value) : undefined,
        decimals: decimals.status === "fulfilled" ? Number(decimals.value) : undefined,
      };
    } catch {
      return null;
    }
  },
);

/**
 * Discover LockManager address from a LockToVote plugin.
 */
export const discoverLockManager = createEffect(
  {
    name: "discoverLockManager",
    input: S.schema({ pluginAddress: S.string, chainId: S.number }),
    output: S.union([S.string, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      return await client.readContract({
        address: input.pluginAddress as `0x${string}`,
        abi: LOCK_MANAGER_ABI,
        functionName: "lockManager",
      });
    } catch {
      return null;
    }
  },
);
