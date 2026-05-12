import { createEffect, S } from "envio";
import { getAddress, parseAbi } from "viem";
import { erc20 } from "../abis";
import { EIP1967_IMPL_SLOT, ZERO_ADDRESS } from "../constants";
import { parseClockMode } from "../enums";
import { getClient } from "../helpers/rpcProvider";
import { tryAsync } from "../utils/async";
import { detectTokenInterface } from "../utils/tokenInterface";

// Common wrapper-token interfaces. `underlying()` covers Compound cTokens,
// many ERC-4626 vaults, and a chunk of yield-bearing tokens. `token()` covers
// Aave aTokens, Aragon escrow adapters, and the rest of ERC-4626. Both
// best-effort — most plain tokens fail both calls.
const wrapperAbi = parseAbi([
  "function underlying() view returns (address)",
  "function token() view returns (address)",
]);

const totalSupplyAbi = parseAbi(["function totalSupply() view returns (uint256)"]);
const clockModeAbi = parseAbi(["function CLOCK_MODE() view returns (string)"]);

/**
 * Fetch ERC-20 token metadata + on-chain extras via RPC. Parallel batched
 * RPC calls, single round-trip per token (plus one extra `getCode` for the
 * impl bytecode if the token is a proxy).
 *
 * Returns:
 *   - name / symbol / decimals — standard ERC-20 metadata (best-effort)
 *   - totalSupply — current supply if exposed
 *   - underlying — wrapper-token's underlying via `underlying()` or `token()`,
 *     null for plain tokens
 *   - implementationAddress — EIP-1967 proxy slot, null for non-proxies
 *   - type — `erc20` / `erc721` from bytecode selector match (impl bytecode
 *     when proxy), undefined if neither matches
 *   - isGovernance — true if bytecode has ERC20Votes selectors
 *   - isEscrowAdapter — true if bytecode has Aragon escrow-adapter selectors
 *   - clockMode — IERC6372 mode, parsed into ClockMode enum
 */
export const fetchTokenMetadata = createEffect(
  {
    name: "fetchTokenMetadata",
    input: S.schema({ tokenAddress: S.string, chainId: S.number }),
    // IMPORTANT: do NOT name any output field `type`. postgres-js's
    // arraySerializer treats array elements with a truthy `.type` property
    // as typed-value envelopes (`{type, value}`) and tries to extract
    // `.value`, which is undefined on our plain object. The serializer
    // returns undefined → `arrayEscape(undefined).replace(...)` → crash
    // during the unnest+jsonb[] cache INSERT. We expose the bytecode
    // detection as `interfaceType` instead and remap to `Token.type` in
    // `addToken`. See `scripts/repro-fetch-token.ts` for the repro.
    //
    // totalSupply is stored as STRING (decimal repr of the bigint) since
    // S.bigint round-trips poorly through the JSON cache; addToken does
    // `BigInt(metadata.totalSupply)` when writing the Token entity.
    output: S.union([
      S.schema({
        name: S.union([S.string, null]),
        symbol: S.union([S.string, null]),
        decimals: S.union([S.number, null]),
        totalSupply: S.union([S.string, null]),
        underlying: S.union([S.string, null]),
        implementationAddress: S.union([S.string, null]),
        interfaceType: S.union([S.string, null]),
        isGovernance: S.boolean,
        isEscrowAdapter: S.boolean,
        clockMode: S.union([S.string, null]),
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

      const [name, symbol, decimals, totalSupply, underlying, token, implSlot, ownBytecode, clockMode] =
        await Promise.all([
          tryAsync(client.readContract({ address: addr, abi: erc20.metadata, functionName: "name" })),
          tryAsync(client.readContract({ address: addr, abi: erc20.metadata, functionName: "symbol" })),
          tryAsync(client.readContract({ address: addr, abi: erc20.metadata, functionName: "decimals" })),
          tryAsync(client.readContract({ address: addr, abi: totalSupplyAbi, functionName: "totalSupply" })),
          tryAsync(client.readContract({ address: addr, abi: wrapperAbi, functionName: "underlying" })),
          tryAsync(client.readContract({ address: addr, abi: wrapperAbi, functionName: "token" })),
          tryAsync(client.getStorageAt({ address: addr, slot: EIP1967_IMPL_SLOT })),
          tryAsync(client.getCode({ address: addr })),
          tryAsync(client.readContract({ address: addr, abi: clockModeAbi, functionName: "CLOCK_MODE" })),
        ]);

      const sanitize = (s: string | undefined): string | null => {
        const cleaned = s?.replace(/[\x00-\x1f]/g, "").trim();
        return cleaned || null;
      };

      const pickAddress = (s: string | undefined): string | null => {
        if (!s) return null;
        const v = getAddress(s);
        return v === ZERO_ADDRESS ? null : v;
      };

      const implementationAddress = (() => {
        if (!implSlot || implSlot === "0x" || implSlot.length < 42) return null;
        const impl = getAddress(`0x${implSlot.slice(-40)}`);
        return impl === ZERO_ADDRESS ? null : impl;
      })();

      // For interface detection, selectors live on the IMPLEMENTATION not the
      // proxy shim. If we detected a proxy, fetch the impl's bytecode; else
      // run detection on the address's own bytecode.
      const detectionBytecode = implementationAddress
        ? await tryAsync(client.getCode({ address: implementationAddress as `0x${string}` }))
        : ownBytecode;
      const interfaceFlags = detectTokenInterface(detectionBytecode);

      return {
        name: sanitize(name),
        symbol: sanitize(symbol),
        decimals: decimals !== undefined ? Number(decimals) : null,
        totalSupply: totalSupply !== undefined ? totalSupply.toString() : null,
        underlying: pickAddress(underlying) ?? pickAddress(token),
        implementationAddress,
        interfaceType: interfaceFlags.type ?? null,
        isGovernance: interfaceFlags.isGovernance,
        isEscrowAdapter: interfaceFlags.isEscrowAdapter,
        clockMode: parseClockMode(clockMode) ?? null,
      };
    } catch {
      return null;
    }
  },
);

/**
 * Snapshot a token's `totalSupply()` at a SPECIFIC historical block. Used by
 * token-weighted proposal handlers (TokenVoting, LockToVote) to capture the
 * voting-power denominator at proposal creation time, since that's what the
 * on-chain quorum calculation uses — not the (possibly mutated) current
 * totalSupply.
 *
 * Returned as a string (decimal repr of the bigint) for the same
 * cache-table-serialization reason as `fetchTokenMetadata.totalSupply`. The
 * caller `JSON.stringify`s the snapshot object, so consumers querying via
 * GraphQL get the value as a string in JSON.
 *
 * Cache key includes `blockNumber`, so the same (token, block) pair is
 * resolved exactly once across all proposals at that block.
 */
export const fetchTokenTotalSupplyAtBlock = createEffect(
  {
    name: "fetchTokenTotalSupplyAtBlock",
    input: S.schema({ tokenAddress: S.string, chainId: S.number, blockNumber: S.number }),
    output: S.union([S.string, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const supply = await client.readContract({
        address: input.tokenAddress as `0x${string}`,
        abi: totalSupplyAbi,
        functionName: "totalSupply",
        blockNumber: BigInt(input.blockNumber),
      });
      return supply.toString();
    } catch {
      return null;
    }
  },
);
