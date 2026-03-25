import { createEffect, S } from "envio";
import { ipfsConfig } from "../config";
import { parseDaoMetadata, parseProposalMetadata } from "../utils/metadata";

async function fetchFromIpfs(cid: string): Promise<unknown | null> {
  for (const gateway of ipfsConfig.gateways) {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), ipfsConfig.timeout);
      const response = await fetch(`${gateway}${cid}`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      if (response.ok) {
        return await response.json();
      }
    } catch {}
  }
  return null;
}

export const fetchDaoMetadata = createEffect(
  {
    name: "fetchDaoMetadata",
    input: S.string,
    output: S.union([
      S.schema({
        name: S.optional(S.string),
        description: S.optional(S.string),
        avatar: S.optional(S.string),
        linksJson: S.optional(S.string),
        processKey: S.optional(S.string),
        stageNamesJson: S.optional(S.string),
        blockedCountriesJson: S.optional(S.string),
        termsConditionsUrl: S.optional(S.string),
        enableOfacCheck: S.optional(S.boolean),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input: cid }) => {
    if (!cid) return null;
    const raw = await fetchFromIpfs(cid);
    if (!raw || typeof raw !== "object") return null;
    return parseDaoMetadata(raw as Record<string, unknown>);
  },
);

export const fetchProposalMetadata = createEffect(
  {
    name: "fetchProposalMetadata",
    input: S.string,
    output: S.union([
      S.schema({
        title: S.optional(S.string),
        summary: S.optional(S.string),
        description: S.optional(S.string),
        resourcesJson: S.optional(S.string),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input: cid }) => {
    if (!cid) return null;
    const raw = await fetchFromIpfs(cid);
    if (!raw || typeof raw !== "object") return null;
    return parseProposalMetadata(raw as Record<string, unknown>);
  },
);
