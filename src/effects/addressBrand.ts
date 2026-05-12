import { createEffect, S } from "envio";
import { keccak256, toBytes } from "viem";
import { ZERO_ADDRESS } from "../constants";
import { getClient } from "../helpers/rpcProvider";

/**
 * Detect the "brand" of an address — `eoa`, `safe`, or `other` — for the
 * SPP `Setting.stages[].plugins[].brandId` field. Mirrors legacy
 * `PluginDetector.detectAddressType`:
 *
 *   - empty bytecode → `eoa` (externally-owned account)
 *   - bytecode contains the `masterCopy()` selector → `safe` (Gnosis Safe
 *     proxy and similar pattern)
 *   - everything else → `other` (an OSx plugin or arbitrary contract)
 *
 * Cached per address (`(chainId, address)`) so a recurring SPP body is
 * detected once across the whole index.
 */
const SAFE_MASTER_COPY_SELECTOR = keccak256(toBytes("masterCopy()")).slice(2, 10); // 4-byte selector, no 0x

export type AddressBrand = "eoa" | "safe" | "other";

export const detectAddressBrand = createEffect(
  {
    name: "detectAddressBrand",
    input: S.schema({ chainId: S.number, address: S.string }),
    // The schema layer doesn't expose string literals; we constrain at the
    // TypeScript type-system level via the function's return type instead.
    output: S.string,
    cache: true,
    rateLimit: false,
  },
  async ({ input }): Promise<AddressBrand> => {
    if (input.address === ZERO_ADDRESS) return "eoa";
    try {
      const client = getClient(input.chainId);
      const code = await client.getCode({ address: input.address as `0x${string}` });
      if (!code || code === "0x") return "eoa";
      // `masterCopy()` is the canonical Safe-proxy view; non-Safe contracts
      // rarely expose this selector, making it a reliable best-effort
      // discriminator. Strip the 0x prefix once before scanning.
      if (code.slice(2).includes(SAFE_MASTER_COPY_SELECTOR)) return "safe";
      return "other";
    } catch {
      return "other";
    }
  },
);
