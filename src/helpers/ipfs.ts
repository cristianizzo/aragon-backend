/**
 * IPFS metadata fetcher. Tries each gateway in order with a per-request
 * timeout; returns the first successful JSON payload or `null` if every
 * gateway fails. Gateway URLs and timeout come from `config.IPFS`.
 */

import { config } from "../config";

const trim = (url: string): string => url.replace(/\/+$/, "");

const GATEWAYS: readonly string[] = [
  `${trim(config.IPFS.PINATA_GATEWAY)}/`,
  ...(config.IPFS.DEDICATED_GATEWAY ? [`${trim(config.IPFS.DEDICATED_GATEWAY)}/ipfs/`] : []),
  ...config.IPFS.PUBLIC_GATEWAYS,
];

export async function fetchFromIpfs<T>(cid: string): Promise<T | null> {
  if (!cid) return null;
  for (const gateway of GATEWAYS) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.IPFS.TIMEOUT_MS);
    try {
      const res = await fetch(`${gateway}${cid}`, { signal: controller.signal });
      clearTimeout(timer);
      if (res.ok) return (await res.json()) as T;
    } catch {
      clearTimeout(timer);
    }
  }
  return null;
}
