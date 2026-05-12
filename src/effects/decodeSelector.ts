import { createEffect, S } from "envio";
import { fetchFourByteSignature } from "../helpers/fourByte";
import { functionNameFromSig, lookupKnownSelector } from "../utils/selectorRegistry";

/**
 * Resolve a 4-byte function selector to its canonical signature and name.
 *
 * Pipeline:
 *   1. KNOWN_ABIS — instant, no I/O. Covers Aragon contracts + standard
 *      ERC-20/721/1155.
 *   2. 4byte directory — single HTTP call, cached per (selector) via
 *      `createEffect`.
 *
 * Returns `{ functionSig: null, functionName: null }` on total miss.
 */
export const decodeSelector = createEffect(
  {
    name: "decodeSelector",
    input: S.string,
    output: S.schema({
      functionSig: S.union([S.string, null]),
      functionName: S.union([S.string, null]),
    }),
    cache: true,
    rateLimit: false,
  },
  async ({ input: selector }) => {
    const known = lookupKnownSelector(selector);
    if (known) {
      return { functionSig: known, functionName: functionNameFromSig(known) };
    }
    const fourByte = await fetchFourByteSignature(selector);
    return { functionSig: fourByte, functionName: functionNameFromSig(fourByte) };
  },
);
