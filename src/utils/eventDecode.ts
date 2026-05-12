import { type Abi, type AbiEvent, decodeEventLog, getAddress } from "viem";

/**
 * Slim log shape produced by `effects/txReceipt.ts:fetchTxReceiptLogs`
 * (viem's full Log type carries fields we don't serialize through the cache).
 */
export interface SlimLog {
  address: string;
  topics: readonly string[];
  data: string;
  logIndex: number;
}

/**
 * Parse a stringified-JSON receipt-logs payload back into typed objects.
 * Returns an empty array on null / parse failure.
 */
export function parseReceiptLogs(raw: string | null | undefined): SlimLog[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as SlimLog[]) : [];
  } catch {
    return [];
  }
}

/**
 * Decode every log in `logs` matching the given (address, eventName) pair
 * via the supplied ABI. Returns the decoded `args` arrays — caller decides
 * how to consume them. Decoding failures (wrong topic count, mismatched
 * indexed flag, etc.) are silently dropped so a single malformed log
 * doesn't break the whole iteration.
 */
export function decodeLogsForEvent<TArgs>(args: {
  logs: readonly SlimLog[];
  contractAddress: string;
  abi: Abi;
  eventName: string;
}): TArgs[] {
  const targetAddress = getAddress(args.contractAddress);
  // Resolve the event topic0 once so we can pre-filter by the cheap
  // string compare before paying decode cost.
  const eventAbi = args.abi.find((item): item is AbiEvent => item.type === "event" && item.name === args.eventName);
  if (!eventAbi) return [];

  const out: TArgs[] = [];
  for (const log of args.logs) {
    if (getAddress(log.address) !== targetAddress) continue;
    try {
      const decoded = decodeEventLog({
        abi: args.abi,
        topics: log.topics as [signature: `0x${string}`, ...args: `0x${string}`[]],
        data: log.data as `0x${string}`,
        eventName: args.eventName,
        strict: false,
      });
      out.push(decoded.args as TArgs);
    } catch {
      /* malformed log or wrong event — skip */
    }
  }
  return out;
}
