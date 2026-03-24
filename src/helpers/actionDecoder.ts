/**
 * Multi-stage action decoder for Aragon proposal actions.
 *
 * Pipeline:
 *   1. Known ABIs (instant, no external calls)
 *   2. Proxy detection via EIP-1967 (1 RPC call)
 *   3. Etherscan source + ABI + NatSpec (1 API call)
 *   4. 4bytes directory fallback (1 API call)
 *   5. Unknown fallback
 */

import { type Abi, decodeFunctionData, getAddress, type Hex, parseAbi } from "viem";
import { etherscanConfig, fourByteConfig, getClient } from "../config";
import { classifyAction, KNOWN_ABIS } from "./knownAbis";
import { type ParsedNatSpec, parseNatSpec } from "./natspecParser";

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

// --- In-memory caches for external lookups ---

const etherscanCache = new Map<string, { abi: any[] | null; source: string | null; contractName: string | null }>();
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

async function decodeSingleAction(action: RawAction, chainId: number, daoAddress: string): Promise<DecodedAction> {
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

  // Stage 3: Etherscan ABI + NatSpec
  const etherscanResult = await tryEtherscan(action, chainId, implAddress);
  if (etherscanResult) return etherscanResult;

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

      // Build text signature from ABI
      const abiItem = (abi as any[]).find((item: any) => item.type === "function" && item.name === functionName);
      const textSignature = abiItem
        ? `${functionName}(${(abiItem.inputs || []).map((i: any) => i.type).join(",")})`
        : functionName;

      const parameters = formatParameters(abiItem?.inputs || [], args || []);

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

const EIP1967_IMPL_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2a6d3fe4c5d95e6c1fef0a2b9c85" as Hex;

async function detectProxy(address: string, chainId: number): Promise<string | null> {
  const cacheKey = `${chainId}-${address}`;
  if (proxyCache.has(cacheKey)) return proxyCache.get(cacheKey)!;

  try {
    const client = getClient(chainId);
    const storageValue = await client.getStorageAt({
      address: address as `0x${string}`,
      slot: EIP1967_IMPL_SLOT,
    });

    if (!storageValue || storageValue === "0x" || BigInt(storageValue) === 0n) {
      proxyCache.set(cacheKey, null);
      return null;
    }

    // Extract address from storage (last 20 bytes of 32-byte slot)
    const implAddress = getAddress("0x" + storageValue.slice(-40));
    proxyCache.set(cacheKey, implAddress);
    return implAddress;
  } catch {
    proxyCache.set(cacheKey, null);
    return null;
  }
}

// --- Stage 3: Etherscan ---

interface EtherscanSourceResult {
  abi: any[] | null;
  source: string | null;
  contractName: string | null;
}

async function fetchEtherscanSource(address: string, chainId: number): Promise<EtherscanSourceResult> {
  const cacheKey = `${chainId}-${address}`;
  if (etherscanCache.has(cacheKey)) return etherscanCache.get(cacheKey)!;

  const empty: EtherscanSourceResult = { abi: null, source: null, contractName: null };

  if (!etherscanConfig.apiKey) {
    etherscanCache.set(cacheKey, empty);
    return empty;
  }

  try {
    const url = `${etherscanConfig.baseUrl}?module=contract&action=getsourcecode&address=${address}&chainid=${chainId}&apikey=${etherscanConfig.apiKey}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      etherscanCache.set(cacheKey, empty);
      return empty;
    }

    const json: any = await response.json();
    const result = json?.result?.[0];

    if (!result || result.ABI === "Contract source code not verified") {
      etherscanCache.set(cacheKey, empty);
      return empty;
    }

    let abi: any[] | null = null;
    try {
      abi = JSON.parse(result.ABI);
    } catch {}

    const output: EtherscanSourceResult = {
      abi,
      source: result.SourceCode || null,
      contractName: result.ContractName || null,
    };

    etherscanCache.set(cacheKey, output);
    return output;
  } catch {
    etherscanCache.set(cacheKey, empty);
    return empty;
  }
}

async function tryEtherscan(
  action: RawAction,
  chainId: number,
  implAddress: string | null,
): Promise<DecodedAction | null> {
  const { to, value, data } = action;

  // Try implementation address first (for proxies), then target address
  const addresses = implAddress ? [implAddress, to] : [to];

  for (const addr of addresses) {
    const etherscan = await fetchEtherscanSource(addr, chainId);
    if (!etherscan.abi) continue;

    try {
      const { functionName, args } = decodeFunctionData({
        abi: etherscan.abi as Abi,
        data: data as Hex,
      });

      // Find matching ABI item for parameter names
      const abiItem = etherscan.abi.find((item: any) => item.type === "function" && item.name === functionName);

      const textSignature = abiItem
        ? `${functionName}(${(abiItem.inputs || []).map((i: any) => i.type).join(",")})`
        : functionName;

      // Parse NatSpec from source
      let natspec: ParsedNatSpec | null = null;
      if (etherscan.source) {
        natspec = parseNatSpec(etherscan.source, etherscan.contractName || undefined);
      }

      const funcNatSpec = natspec?.functions[functionName];
      const parameters = formatParametersWithNatSpec(abiItem?.inputs || [], args || [], funcNatSpec?.params || {});

      return {
        to,
        value,
        data,
        type: classifyAction(functionName),
        functionName,
        contractName: etherscan.contractName,
        textSignature,
        notice: funcNatSpec?.notice || null,
        implementationAddress: implAddress,
        parameters,
      };
    } catch {
      // ABI doesn't match this function
    }
  }

  return null;
}

// --- Stage 4: 4bytes Directory ---

async function fetch4ByteSignature(selector: string): Promise<string | null> {
  if (fourByteCache.has(selector)) return fourByteCache.get(selector)!;

  try {
    const url = `${fourByteConfig.uri}/signatures/?format=json&hex_signature=${selector}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      fourByteCache.set(selector, null);
      return null;
    }

    const json: any = await response.json();
    const sig = json?.results?.[0]?.text_signature || null;
    fourByteCache.set(selector, sig);
    return sig;
  } catch {
    fourByteCache.set(selector, null);
    return null;
  }
}

async function tryFourBytes(action: RawAction): Promise<DecodedAction | null> {
  const { to, value, data } = action;
  const selector = data.slice(0, 10);

  const textSignature = await fetch4ByteSignature(selector);
  if (!textSignature) return null;

  const functionName = textSignature.split("(")[0] ?? textSignature;

  // Try to decode params using the recovered signature
  let parameters: DecodedParameter[] = [];
  try {
    const abi = parseAbi([`function ${textSignature}`] as readonly [string] as any);
    const { args } = decodeFunctionData({ abi, data: data as Hex });
    const abiItem = (abi as any[]).find((item: any) => item.type === "function");
    parameters = formatParameters(abiItem?.inputs || [], args || []);
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

function formatParameters(inputs: any[], args: readonly any[] | any[]): DecodedParameter[] {
  if (!inputs || !args) return [];

  return inputs.map((input: any, idx: number) => ({
    name: input.name || null,
    type: input.type || "unknown",
    value: stringifyValue(args[idx]),
    notice: null,
  }));
}

function formatParametersWithNatSpec(
  inputs: any[],
  args: readonly any[] | any[],
  paramNotices: Record<string, string>,
): DecodedParameter[] {
  if (!inputs || !args) return [];

  return inputs.map((input: any, idx: number) => ({
    name: input.name || null,
    type: input.type || "unknown",
    value: stringifyValue(args[idx]),
    notice: input.name ? paramNotices[input.name] || null : null,
  }));
}

function stringifyValue(val: any): string {
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
