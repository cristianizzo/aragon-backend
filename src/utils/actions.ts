import type { RawAction } from "../helpers/actionDecoder";

// V3 codegen represents Solidity tuples as object-keyed records, not
// positional arrays. Runtime payloads are still JS arrays (indexable by 0,
// 1, 2), but TS types are object-form, so signatures must match.
export type EvmAction = { readonly 0: string; readonly 1: bigint; readonly 2: string };

/**
 * Convert OSx-style on-chain action tuples `(target, value, data)` into the
 * indexer's `RawAction` shape. The bigint `value` is stringified for storage
 * in JSON-typed entity fields.
 */
export function toRawActions(actions: readonly EvmAction[]): RawAction[] {
  return actions.map((a) => ({ to: a[0], value: String(a[1]), data: a[2] }));
}
