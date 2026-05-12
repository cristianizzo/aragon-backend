/**
 * Extract IPFS CID from metadata bytes.
 * Aragon metadata is typically hex-encoded with a prefix indicating IPFS.
 */
export function extractIpfsCid(metadataBytes: string): string | undefined {
  if (!metadataBytes || metadataBytes === "0x") return undefined;

  try {
    const hex = metadataBytes.startsWith("0x") ? metadataBytes.slice(2) : metadataBytes;
    // Postgres rejects 0x00 in text — strip nulls before any string check.
    const decoded = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");
    if (!decoded) return undefined;
    if (decoded.startsWith("ipfs://")) return decoded.slice(7);
    if (decoded.startsWith("Qm") || decoded.startsWith("bafy")) return decoded;
    return undefined;
  } catch {
    return undefined;
  }
}

export function ipfsUrl(cid: string): string {
  return `https://ipfs.io/ipfs/${cid}`;
}

/* ------------------------------------------------------------------ *
 * IPFS payload parsers
 *
 * `fetchIpfsJson` (see `effects/ipfs.ts`) returns the raw payload as a
 * stringified JSON blob. Parsers below extract entity-specific fields
 * defensively — IPFS payloads are user-uploaded and may be malformed,
 * truncated, or wrong-shaped. Unknown / wrong-type fields become
 * `undefined` so callers can fall back to existing entity values.
 * ------------------------------------------------------------------ */

function safeJsonObject(raw: string | null | undefined): Record<string, unknown> | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function pickString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

// Pass arrays through untouched — schema fields are `Json`, so we don't
// re-stringify. Reject non-arrays to keep downstream consumers honest.
function pickArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export interface DaoMetadata {
  name?: string;
  description?: string;
  avatar?: string;
  links?: unknown[];
  // Compliance / legal extensions surfaced by the Aragon app metadata
  // schema. Optional — older DAO metadata payloads predate them.
  blockedCountries?: unknown[];
  enableOfacCheck?: boolean;
  termsConditionsUrl?: string;
}

function pickBoolean(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

export function parseDaoMetadata(raw: string | null | undefined): DaoMetadata | null {
  const o = safeJsonObject(raw);
  if (!o) return null;
  return {
    name: pickString(o.name),
    description: pickString(o.description),
    avatar: pickString(o.avatar),
    links: pickArray(o.links),
    blockedCountries: pickArray(o.blockedCountries),
    enableOfacCheck: pickBoolean(o.enableOfacCheck),
    termsConditionsUrl: pickString(o.termsConditionsUrl),
  };
}

// Plugin payloads share the DAO shape minus `avatar`. Keeping a separate
// type makes intent explicit at call sites and lets the shapes diverge
// later without rippling through every plugin handler.
export interface PluginMetadata {
  name?: string;
  description?: string;
  links?: unknown[];
  // SPP-specific extensions surfaced by the Aragon app metadata schema.
  // `processKey` is a human-friendly handle used by legacy as a slug
  // override (we keep our own deterministic slug regardless — this is
  // additive metadata, not a slug input). `stageNames` parallels the
  // SPP `stages` array, giving each stage a display name.
  processKey?: string;
  stageNames?: unknown[];
}

export function parsePluginMetadata(raw: string | null | undefined): PluginMetadata | null {
  const o = safeJsonObject(raw);
  if (!o) return null;
  return {
    name: pickString(o.name),
    description: pickString(o.description),
    links: pickArray(o.links),
    processKey: pickString(o.processKey),
    stageNames: pickArray(o.stageNames),
  };
}

export interface ProposalMetadata {
  title?: string;
  summary?: string;
  description?: string;
  resources?: unknown[];
  // Optional banner artwork (header / logo). Mirrors legacy `Media`
  // — both fields are `string | null`. Older payloads omit `media`
  // entirely; new ones may include it.
  media?: { header?: string; logo?: string };
}

export function parseProposalMetadata(raw: string | null | undefined): ProposalMetadata | null {
  const o = safeJsonObject(raw);
  if (!o) return null;
  const mediaRaw =
    o.media && typeof o.media === "object" && !Array.isArray(o.media) ? (o.media as Record<string, unknown>) : null;
  const media = mediaRaw ? { header: pickString(mediaRaw.header), logo: pickString(mediaRaw.logo) } : undefined;
  return {
    title: pickString(o.title),
    summary: pickString(o.summary),
    description: pickString(o.description),
    resources: pickArray(o.resources),
    media,
  };
}

// Capital-distribution campaigns ship a slimmer payload than proposals —
// no `summary`, no per-stage info — but a `type` discriminator (e.g.
// "merkle", "streaming") that we expose as `campaignType` to avoid clashing
// with the Token entity's `type` column.
export interface CampaignMetadata {
  title?: string;
  description?: string;
  resources?: unknown[];
  campaignType?: string;
}

export function parseCampaignMetadata(raw: string | null | undefined): CampaignMetadata | null {
  const o = safeJsonObject(raw);
  if (!o) return null;
  return {
    title: pickString(o.title),
    description: pickString(o.description),
    resources: pickArray(o.resources),
    campaignType: pickString(o.type),
  };
}
