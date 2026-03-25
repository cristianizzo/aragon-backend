// --- IPFS metadata parsing ---

/** Normalize a string field from raw IPFS JSON (handles null, undefined, non-string). */
function asString(value: unknown): string | undefined {
  if (typeof value === "string" && value.length > 0) return value;
  // Legacy format: {path: "ipfs://..."} for avatar fields
  if (value && typeof value === "object" && "path" in value) return asString((value as Record<string, unknown>).path);
  return undefined;
}

/** Normalize a boolean field from raw IPFS JSON. */
function asBool(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  return undefined;
}

/** Normalize an array field from raw IPFS JSON. Returns JSON string or undefined. */
function asJsonArray(value: unknown): string | undefined {
  if (Array.isArray(value) && value.length > 0) return JSON.stringify(value);
  return undefined;
}

/** Parse raw DAO metadata from IPFS into a clean, normalized structure. */
export function parseDaoMetadata(raw: Record<string, unknown>) {
  return {
    name: asString(raw.name),
    description: asString(raw.description),
    avatar: asString(raw.avatar),
    linksJson: asJsonArray(raw.links),
    processKey: asString(raw.processKey),
    stageNamesJson: asJsonArray(raw.stageNames),
    blockedCountriesJson: asJsonArray(raw.blockedCountries),
    termsConditionsUrl: asString(raw.termsConditionsUrl),
    enableOfacCheck: asBool(raw.enableOfacCheck),
  };
}

/** Parse raw proposal metadata from IPFS into a clean, normalized structure. */
export function parseProposalMetadata(raw: Record<string, unknown>) {
  return {
    title: asString(raw.title),
    summary: asString(raw.summary),
    description: asString(raw.description),
    resourcesJson: asJsonArray(raw.resources),
  };
}

// --- Proposal action parsing ---

export interface RawAction {
  to: string;
  value: string;
  data: string;
}

/** Parse raw actions from ProposalCreated event params into clean {to, value, data} objects. */
export function parseRawActions(actions: readonly unknown[]): RawAction[] {
  return actions.map((a: any) => ({
    to: String(a[0] ?? a.to ?? ""),
    value: String(a[1] ?? a.value ?? "0"),
    data: String(a[2] ?? a.data ?? "0x"),
  }));
}

// --- SPP stage parsing ---

export interface StageBody {
  address: string;
  isManual: boolean;
  tryAdvance: boolean;
  resultType: number;
}

export interface ParsedStage {
  stageIndex: number;
  bodies: StageBody[];
  maxAdvance: number;
  minAdvance: number;
  voteDuration: number;
  approvalThreshold: number;
  vetoThreshold: number;
  cancelable: boolean;
  editable: boolean;
}

/** Parse raw stages from StagesUpdated event into clean typed objects. */
export function parseStages(rawStages: readonly unknown[]): ParsedStage[] {
  return rawStages.map((stage: any, index: number) => {
    const bodies: StageBody[] = (stage[0] as unknown[]).map((body: any) => ({
      address: String(body[0]),
      isManual: Boolean(body[1]),
      tryAdvance: Boolean(body[2]),
      resultType: Number(body[3]),
    }));

    return {
      stageIndex: index,
      bodies,
      maxAdvance: Number(stage[1]),
      minAdvance: Number(stage[2]),
      voteDuration: Number(stage[3]),
      approvalThreshold: Number(stage[4]),
      vetoThreshold: Number(stage[5]),
      cancelable: Boolean(stage[6]),
      editable: Boolean(stage[7]),
    };
  });
}

// --- JSON helpers ---

/** Safely parse a JSON string, returning undefined on failure. */
export function safeJsonParse(value: string | undefined | null): any {
  if (!value) return undefined;
  try {
    return JSON.parse(value);
  } catch {
    return undefined;
  }
}

// --- IPFS CID extraction ---

/**
 * Extract IPFS CID from metadata bytes.
 * Aragon metadata is typically hex-encoded with a prefix indicating IPFS.
 */
export function extractIpfsCid(metadataBytes: string): string | undefined {
  if (!metadataBytes || metadataBytes === "0x") return undefined;

  try {
    // Remove 0x prefix if present
    const hex = metadataBytes.startsWith("0x") ? metadataBytes.slice(2) : metadataBytes;

    // Decode hex to UTF-8 and strip null bytes (Postgres rejects 0x00 in text)
    const decoded = Buffer.from(hex, "hex").toString("utf8").replace(/\0/g, "");

    if (!decoded) return undefined;

    // Check if it starts with ipfs:// prefix
    if (decoded.startsWith("ipfs://")) {
      return decoded.slice(7);
    }

    // Check if it's a raw CID (starts with Qm or bafy)
    if (decoded.startsWith("Qm") || decoded.startsWith("bafy")) {
      return decoded;
    }

    // Not a recognizable IPFS CID format
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Build full IPFS gateway URL from CID.
 */
export function ipfsUrl(cid: string): string {
  return `https://ipfs.io/ipfs/${cid}`;
}
