/**
 * Multi-stage action decoder for Aragon proposal actions.
 *
 * Pipeline:
 *   1. Known ABIs (instant, no external calls)
 *   2. EIP-1967 proxy detection (1 RPC call)
 *   3. Explorer source + ABI + NatSpec — picks Etherscan / Routescan /
 *      ZkSync / Blockscout / Subscan per chainId via
 *      `helpers/explorers/routing.ts`. Each provider has its own
 *      Bottleneck queue (`helpers/rateLimiter.ts`).
 *   4. 4byte directory fallback (1 API call, throttled separately)
 *   5. Unknown fallback
 */

import { type Abi, decodeFunctionData, getAddress, type Hex, parseAbi } from "viem";
import { EIP1967_IMPL_SLOT } from "../constants";
import { fetchContractSourceCode, type SourceCodeResult } from "./explorers";
import { fetchFourByteSignature } from "./fourByte";
import { classifyAction, KNOWN_ABIS } from "./knownAbis";
import { type ParsedNatSpec, parseNatSpec } from "./natspecParser";
import { getClient } from "./rpcProvider";

// --- Types ---

export interface RawAction {
  to: string;
  value: string;
  data: string;
}

export interface DecodedParameter {
  name: string | null;
  type: string;
  value: string;
  notice: string | null;
}

export interface DecodedAction {
  to: string;
  value: string;
  data: string;
  type: string;
  functionName: string | null;
  contractName: string | null;
  textSignature: string | null;
  notice: string | null;
  implementationAddress: string | null;
  parameters: DecodedParameter[];
}

interface AbiInput {
  name?: string;
  type: string;
}

interface AbiItem {
  type: string;
  name?: string;
  inputs?: readonly AbiInput[];
}

// --- In-memory caches for external lookups ---
//
// `sourceCache` and `fourByteCache` short-circuit repeat lookups within a
// single batch — the per-provider Bottleneck queue throttles cold misses,
// the Effect cache (decodeActions / decodeSelector) persists across runs.
// The proxy cache covers EIP-1967 storage reads, which are RPC-bound and
// not part of the explorer/4byte queue.

const sourceCache = new Map<string, SourceCodeResult>();
const fourByteCache = new Map<string, string | null>();
const proxyCache = new Map<string, string | null>();

// --- Main decode function ---

export async function decodeActions(
  actions: RawAction[],
  chainId: number,
  daoAddress: string,
): Promise<DecodedAction[]> {
  return Promise.all(actions.map((action) => decodeSingleAction(action, chainId, daoAddress)));
}

async function decodeSingleAction(action: RawAction, chainId: number, _daoAddress: string): Promise<DecodedAction> {
  const { to, value, data } = action;

  // Native transfer (no calldata or just 0x)
  if (!data || data === "0x" || data.length < 10) {
    return {
      to,
      value,
      data: data || "0x",
      type: BigInt(value || "0") > 0n ? "transferNative" : "unknown",
      functionName: null,
      contractName: null,
      textSignature: null,
      notice: null,
      implementationAddress: null,
      parameters: [],
    };
  }

  // Stage 1: Try known ABIs
  const knownResult = tryKnownAbis(action);
  if (knownResult) return knownResult;

  // Stage 2: Proxy detection
  const implAddress = await detectProxy(to, chainId);

  // Stage 3: Explorer ABI + NatSpec (per-chain provider routing)
  const explorerResult = await tryExplorer(action, chainId, implAddress);
  if (explorerResult) return explorerResult;

  // Stage 4: 4bytes fallback
  const fourByteResult = await tryFourBytes(action);
  if (fourByteResult) return { ...fourByteResult, implementationAddress: implAddress };

  // Stage 5: Unknown
  return {
    to,
    value,
    data,
    type: "unknown",
    functionName: null,
    contractName: null,
    textSignature: null,
    notice: null,
    implementationAddress: implAddress,
    parameters: [],
  };
}

// --- Stage 1: Known ABIs ---

function tryKnownAbis(action: RawAction): DecodedAction | null {
  const { to, value, data } = action;

  for (const { name, abi } of KNOWN_ABIS) {
    try {
      const { functionName, args } = decodeFunctionData({ abi, data: data as Hex });

      const abiItem = (abi as readonly AbiItem[]).find(
        (item) => item.type === "function" && item.name === functionName,
      );
      const textSignature = abiItem
        ? `${functionName}(${(abiItem.inputs ?? []).map((i) => i.type).join(",")})`
        : functionName;

      const parameters = formatParameters(abiItem?.inputs ?? [], args ?? []);

      return {
        to,
        value,
        data,
        type: classifyAction(functionName),
        functionName,
        contractName: name,
        textSignature,
        notice: null,
        implementationAddress: null,
        parameters,
      };
    } catch {
      // ABI doesn't match, try next
    }
  }

  return null;
}

// --- Stage 2: Proxy Detection ---

async function detectProxy(address: string, chainId: number): Promise<string | null> {
  const cacheKey = `${chainId}-${address}`;
  if (proxyCache.has(cacheKey)) return proxyCache.get(cacheKey)!;

  try {
    const client = getClient(chainId);
    const storageValue = await client.getStorageAt({
      address: address as `0x${string}`,
      slot: EIP1967_IMPL_SLOT as Hex,
    });

    if (!storageValue || storageValue === "0x" || BigInt(storageValue) === 0n) {
      proxyCache.set(cacheKey, null);
      return null;
    }

    // Extract address from storage (last 20 bytes of 32-byte slot)
    const implAddress = getAddress(`0x${storageValue.slice(-40)}`);
    proxyCache.set(cacheKey, implAddress);
    return implAddress;
  } catch {
    proxyCache.set(cacheKey, null);
    return null;
  }
}

// --- Stage 3: Explorer source-code lookup (Etherscan / Routescan / ZkSync /
// Blockscout / Subscan — picked per chain by `helpers/explorers/routing.ts`) ---

async function fetchSourceWithCache(address: string, chainId: number): Promise<SourceCodeResult> {
  const cacheKey = `${chainId}-${address}`;
  const cached = sourceCache.get(cacheKey);
  if (cached) return cached;
  const result = await fetchContractSourceCode(chainId, address);
  sourceCache.set(cacheKey, result);
  return result;
}

async function tryExplorer(
  action: RawAction,
  chainId: number,
  implAddress: string | null,
): Promise<DecodedAction | null> {
  const { to, value, data } = action;

  // Try implementation address first (for proxies), then target address.
  const addresses = implAddress ? [implAddress, to] : [to];

  for (const addr of addresses) {
    const sourceResult = await fetchSourceWithCache(addr, chainId);
    if (!sourceResult.abi) continue;

    try {
      const { functionName, args } = decodeFunctionData({
        abi: sourceResult.abi as Abi,
        data: data as Hex,
      });

      const abiItem = sourceResult.abi.find((item) => item.type === "function" && item.name === functionName);

      const textSignature = abiItem
        ? `${functionName}(${(abiItem.inputs ?? []).map((i) => i.type).join(",")})`
        : functionName;

      // NatSpec lives inside `source` when the explorer returns it; for
      // ABI-only providers (no source) we skip parsing.
      let natspec: ParsedNatSpec | null = null;
      if (sourceResult.source) {
        natspec = parseNatSpec(sourceResult.source, sourceResult.contractName || undefined);
      }

      const funcNatSpec = natspec?.functions[functionName];
      const parameters = formatParametersWithNatSpec(abiItem?.inputs ?? [], args ?? [], funcNatSpec?.params || {});

      return {
        to,
        value,
        data,
        type: classifyAction(functionName),
        functionName,
        contractName: sourceResult.contractName,
        textSignature,
        notice: funcNatSpec?.notice || null,
        implementationAddress: implAddress,
        parameters,
      };
    } catch {
      // ABI doesn't match this function — keep walking the address list.
    }
  }

  return null;
}

// --- Stage 4: 4bytes Directory ---

async function tryFourBytes(action: RawAction): Promise<DecodedAction | null> {
  const { to, value, data } = action;
  const selector = data.slice(0, 10);

  let textSignature: string | null;
  if (fourByteCache.has(selector)) {
    textSignature = fourByteCache.get(selector) ?? null;
  } else {
    textSignature = await fetchFourByteSignature(selector);
    fourByteCache.set(selector, textSignature);
  }
  if (!textSignature) return null;

  const functionName = textSignature.split("(")[0] ?? textSignature;

  let parameters: DecodedParameter[] = [];
  try {
    // Dynamic ABI from a recovered signature — viem's parseAbi requires literal
    // types, so we cast via unknown at the boundary.
    const abi = (parseAbi as (sigs: readonly string[]) => Abi)([`function ${textSignature}`]);
    const { args } = decodeFunctionData({ abi, data: data as Hex });
    const abiItem = (abi as unknown as readonly AbiItem[]).find((item) => item.type === "function");
    parameters = formatParameters(abiItem?.inputs ?? [], args ?? []);
  } catch {
    // Can't decode params with 4bytes signature, that's ok
  }

  return {
    to,
    value,
    data,
    type: classifyAction(functionName),
    functionName: functionName ?? null,
    contractName: null,
    textSignature,
    notice: null,
    implementationAddress: null,
    parameters,
  };
}

// --- Parameter formatting ---

function formatParameters(inputs: readonly AbiInput[], args: readonly unknown[]): DecodedParameter[] {
  if (!inputs || !args) return [];

  return inputs.map((input, idx) => ({
    name: input.name || null,
    type: input.type || "unknown",
    value: stringifyValue(args[idx]),
    notice: null,
  }));
}

function formatParametersWithNatSpec(
  inputs: readonly AbiInput[],
  args: readonly unknown[],
  paramNotices: Record<string, string>,
): DecodedParameter[] {
  if (!inputs || !args) return [];

  return inputs.map((input, idx) => ({
    name: input.name || null,
    type: input.type || "unknown",
    value: stringifyValue(args[idx]),
    notice: input.name ? paramNotices[input.name] || null : null,
  }));
}

function stringifyValue(val: unknown): string {
  if (val === undefined || val === null) return "";
  if (typeof val === "bigint") return val.toString();
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  if (Array.isArray(val)) {
    return JSON.stringify(val.map(stringifyValue));
  }
  if (typeof val === "object") {
    // Handle tuple/struct types
    const entries: Record<string, string> = {};
    for (const [k, v] of Object.entries(val)) {
      entries[k] = stringifyValue(v);
    }
    return JSON.stringify(entries);
  }
  return String(val);
}
