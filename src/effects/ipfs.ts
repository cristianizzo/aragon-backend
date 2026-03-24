import { createEffect, S } from "envio";
import { ipfsConfig } from "../config";

export interface IpfsMetadata {
  name?: string;
  description?: string;
  avatar?: string;
  links?: Array<{ name: string; url: string }>;
}

export interface ProposalMetadata {
  title?: string;
  summary?: string;
  description?: string;
  resources?: Array<{ name: string; url: string }>;
}

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
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input: cid }) => {
    if (!cid) return null;
    const data = (await fetchFromIpfs(cid)) as IpfsMetadata | null;
    if (!data) return null;
    return {
      name: data.name,
      description: data.description,
      avatar: data.avatar,
      linksJson: data.links ? JSON.stringify(data.links) : undefined,
    };
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
    const data = (await fetchFromIpfs(cid)) as ProposalMetadata | null;
    if (!data) return null;
    return {
      title: data.title,
      summary: data.summary,
      description: data.description,
      resourcesJson: data.resources ? JSON.stringify(data.resources) : undefined,
    };
  },
);
