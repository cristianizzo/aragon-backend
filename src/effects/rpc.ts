import { createEffect, S } from "envio";
import { getClient } from "../config";
import { CLOCK_ABI, CURVE_ABI, EIP1967_IMPLEMENTATION_SLOT, ERC20_METADATA_ABI, ESCROW_ABI, LOCK_MANAGER_ABI, LOCK_NFT_ABI, PROTOCOL_VERSION_ABI, QUEUE_ABI, TOKEN_ABI } from "../constants";

/**
 * Fetch DAO implementation address (EIP-1967 proxy) and protocol version.
 */
export const fetchDaoInfo = createEffect(
  {
    name: "fetchDaoInfo",
    input: S.schema({ daoAddress: S.string, chainId: S.number }),
    output: S.union([
      S.schema({
        implementationAddress: S.optional(S.string),
        version: S.optional(S.string),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const addr = input.daoAddress as `0x${string}`;

      const [implSlot, versionResult] = await Promise.allSettled([
        client.getStorageAt({ address: addr, slot: EIP1967_IMPLEMENTATION_SLOT }),
        client.readContract({ address: addr, abi: PROTOCOL_VERSION_ABI, functionName: "protocolVersion" }),
      ]);

      // Parse implementation address from storage slot (last 20 bytes of 32-byte slot)
      let implementationAddress: string | undefined;
      if (implSlot.status === "fulfilled" && implSlot.value) {
        const raw = implSlot.value.toLowerCase();
        // Check not zero
        if (raw !== "0x" + "0".repeat(64)) {
          implementationAddress = "0x" + raw.slice(-40);
        }
      }

      // Parse version tuple [major, minor, patch] → "major.minor.patch"
      let version: string | undefined;
      if (versionResult.status === "fulfilled" && versionResult.value) {
        const [major, minor, patch] = versionResult.value as [number, number, number];
        version = `${major}.${minor}.${patch}`;
      } else {
        version = "1.0.0"; // Default for old DAOs without protocolVersion()
      }

      return { implementationAddress, version };
    } catch {
      return null;
    }
  },
);

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
        curveAddress: S.optional(S.string),
        clockAddress: S.optional(S.string),
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

      // Get sub-contracts from escrow (all 5 addresses)
      const escrow = escrowAddress as `0x${string}`;
      const [exitQueueAddress, nftLockAddress, underlyingToken, curveAddress, clockAddress] =
        await Promise.allSettled([
          client.readContract({ address: escrow, abi: QUEUE_ABI, functionName: "queue" }),
          client.readContract({ address: escrow, abi: LOCK_NFT_ABI, functionName: "lockNFT" }),
          client.readContract({ address: escrow, abi: TOKEN_ABI, functionName: "token" }),
          client.readContract({ address: escrow, abi: CURVE_ABI, functionName: "curve" }),
          client.readContract({ address: escrow, abi: CLOCK_ABI, functionName: "clock" }),
        ]);

      const settled = <T>(r: PromiseSettledResult<T>) =>
        r.status === "fulfilled" ? r.value : undefined;

      return {
        escrowAddress,
        exitQueueAddress: settled(exitQueueAddress),
        nftLockAddress: settled(nftLockAddress),
        underlyingToken: settled(underlyingToken),
        curveAddress: settled(curveAddress),
        clockAddress: settled(clockAddress),
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
        totalSupply: S.optional(S.bigint),
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

      const [name, symbol, decimals, totalSupply] = await Promise.allSettled([
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "name" }),
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "symbol" }),
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "decimals" }),
        client.readContract({ address: addr, abi: ERC20_METADATA_ABI, functionName: "totalSupply" }),
      ]);

      // biome-ignore lint/suspicious/noControlCharactersInRegex: intentionally stripping control chars from on-chain strings
      const sanitize = (s: string | undefined): string | undefined =>
        s?.replace(/[\x00-\x1f]/g, "").trim() || undefined;

      return {
        name: name.status === "fulfilled" ? sanitize(name.value) : undefined,
        symbol: symbol.status === "fulfilled" ? sanitize(symbol.value) : undefined,
        decimals: decimals.status === "fulfilled" ? Number(decimals.value) : undefined,
        totalSupply: totalSupply.status === "fulfilled" ? totalSupply.value : undefined,
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
