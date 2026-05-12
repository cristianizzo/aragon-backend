import { createEffect, S } from "envio";
import { getAddress } from "viem";
import { dao } from "../abis";
import { EIP1967_IMPL_SLOT, ZERO_ADDRESS } from "../constants";
import { getClient } from "../helpers/rpcProvider";

/**
 * Read EIP-1967 implementation slot. Returns null for non-proxy or zero-slot.
 * Beacon-proxy and minimal-proxy fallbacks are intentionally not handled here —
 * Aragon DAOs use the standard transparent proxy.
 */
export const fetchImplementationAddress = createEffect(
  {
    name: "fetchImplementationAddress",
    input: S.schema({ proxyAddress: S.string, chainId: S.number }),
    output: S.union([S.string, null]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const slotValue = await client.getStorageAt({
        address: input.proxyAddress as `0x${string}`,
        slot: EIP1967_IMPL_SLOT,
      });
      if (!slotValue || slotValue === "0x" || slotValue.length < 42) return null;
      const impl = getAddress(`0x${slotValue.slice(-40)}`);
      return impl === ZERO_ADDRESS ? null : impl;
    } catch {
      return null;
    }
  },
);

/**
 * Read OSx `protocolVersion()` from a DAO contract — returns "major.minor.patch"
 * (e.g., "1.3.0"). Defaults to "1.0.0" since v1.0.0 contracts predate the call.
 */
export const fetchDaoVersion = createEffect(
  {
    name: "fetchDaoVersion",
    input: S.schema({ daoAddress: S.string, chainId: S.number }),
    output: S.string,
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    try {
      const client = getClient(input.chainId);
      const version = await client.readContract({
        address: input.daoAddress as `0x${string}`,
        abi: dao.protocolVersion,
        functionName: "protocolVersion",
      });
      return (version as readonly [number, number, number]).join(".");
    } catch {
      return "1.0.0";
    }
  },
);
