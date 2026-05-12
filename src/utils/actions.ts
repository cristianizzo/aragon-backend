import type { RawAction } from "../helpers/actionDecoder";

type EvmAction = readonly [string, bigint, string];

/**
 * Convert OSx-style on-chain action tuples `(target, value, data)` into the
 * indexer's `RawAction` shape. The bigint `value` is stringified for storage
 * in JSON-typed entity fields.
 */
export function toRawActions(actions: readonly EvmAction[]): RawAction[] {
  return actions.map((a) => ({ to: a[0], value: String(a[1]), data: a[2] }));
}
