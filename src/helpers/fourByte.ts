import { config } from "../config";
import { schedule } from "./rateLimiter";

/**
 * Transport-only client for the 4byte directory. Returns the first
 * `text_signature` for a given 4-byte selector, or `null` on miss / error.
 *
 * Caching is handled at the Effect layer (see `effects/decodeSelector.ts`).
 * Per-process Bottleneck queue lives in `helpers/rateLimiter.ts` (the
 * `fourByte` provider key uses pseudo chainId 0 — the directory is
 * chain-agnostic).
 */
const FOUR_BYTE_TIMEOUT_MS = 10_000;
const FOUR_BYTE_PSEUDO_CHAIN = 0;

interface FourByteResponse {
  results?: Array<{ text_signature?: string }>;
}

export async function fetchFourByteSignature(selector: string): Promise<string | null> {
  if (!selector) return null;
  return schedule("fourByte", FOUR_BYTE_PSEUDO_CHAIN, async () => {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FOUR_BYTE_TIMEOUT_MS);
    try {
      const response = await fetch(`${config.FOUR_BYTE.URI}/signatures/?format=json&hex_signature=${selector}`, {
        signal: controller.signal,
      });
      if (!response.ok) return null;
      const json = (await response.json()) as FourByteResponse;
      return json?.results?.[0]?.text_signature ?? null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeout);
    }
  });
}
