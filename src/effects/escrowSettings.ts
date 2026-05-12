import { createEffect, S } from "envio";
import { curveSettings, escrow, exitQueueSettings } from "../abis";
import { getClient } from "../helpers/rpcProvider";
import { tryAsync } from "../utils/async";

/**
 * Read the VE escrow's full settings — split across three contracts:
 *   - escrow:     `minDeposit()`
 *   - exitQueue:  `minLock`, `cooldown`, `feePercent`, `minFeePercent`, `minCooldown`
 *   - curve:      `maxTime`, `getCoefficients(1e18)` → [bias, slope]
 *
 * Mirrors legacy `pluginSettingHandler.votingEscrowSettings`. Every field
 * is BigInt on chain — serialized to decimal strings for the Json column
 * so it round-trips through the cache without precision loss.
 *
 * All sub-calls run in parallel via `tryAsync` so a single missing
 * accessor (older escrow variants without `getCoefficients`, for
 * instance) doesn't drop the whole result.
 *
 * Inputs are nullable to mirror `Plugin.votingEscrow` shape — when an
 * address is missing, the effect skips the calls that need it and
 * returns null for those fields.
 */
export const fetchEscrowSettings = createEffect(
  {
    name: "fetchEscrowSettings",
    input: S.schema({
      chainId: S.number,
      escrowAddress: S.union([S.string, null]),
      exitQueueAddress: S.union([S.string, null]),
      curveAddress: S.union([S.string, null]),
    }),
    output: S.union([
      S.schema({
        minDeposit: S.union([S.string, null]),
        minLockTime: S.union([S.string, null]),
        cooldown: S.union([S.string, null]),
        feePercent: S.union([S.string, null]),
        minFeePercent: S.union([S.string, null]),
        minCooldown: S.union([S.string, null]),
        maxTime: S.union([S.string, null]),
        bias: S.union([S.string, null]),
        slope: S.union([S.string, null]),
      }),
      null,
    ]),
    cache: true,
    rateLimit: false,
  },
  async ({ input }) => {
    const client = getClient(input.chainId);
    const escrowAddr = input.escrowAddress as `0x${string}` | null;
    const exitAddr = input.exitQueueAddress as `0x${string}` | null;
    const curveAddr = input.curveAddress as `0x${string}` | null;

    if (!escrowAddr && !exitAddr && !curveAddr) return null;

    const [minDeposit, minLock, cooldown, feePercent, minFeePercent, minCooldown, maxTime, coefficients] =
      await Promise.all([
        escrowAddr
          ? tryAsync(client.readContract({ address: escrowAddr, abi: escrow.minDeposit, functionName: "minDeposit" }))
          : Promise.resolve(undefined),
        exitAddr
          ? tryAsync(
              client.readContract({ address: exitAddr, abi: exitQueueSettings.minLock, functionName: "minLock" }),
            )
          : Promise.resolve(undefined),
        exitAddr
          ? tryAsync(
              client.readContract({ address: exitAddr, abi: exitQueueSettings.cooldown, functionName: "cooldown" }),
            )
          : Promise.resolve(undefined),
        exitAddr
          ? tryAsync(
              client.readContract({
                address: exitAddr,
                abi: exitQueueSettings.feePercent,
                functionName: "feePercent",
              }),
            )
          : Promise.resolve(undefined),
        exitAddr
          ? tryAsync(
              client.readContract({
                address: exitAddr,
                abi: exitQueueSettings.minFeePercent,
                functionName: "minFeePercent",
              }),
            )
          : Promise.resolve(undefined),
        exitAddr
          ? tryAsync(
              client.readContract({
                address: exitAddr,
                abi: exitQueueSettings.minCooldown,
                functionName: "minCooldown",
              }),
            )
          : Promise.resolve(undefined),
        curveAddr
          ? tryAsync(client.readContract({ address: curveAddr, abi: curveSettings.maxTime, functionName: "maxTime" }))
          : Promise.resolve(undefined),
        curveAddr
          ? tryAsync(
              client.readContract({
                address: curveAddr,
                abi: curveSettings.getCoefficients,
                functionName: "getCoefficients",
                args: [1_000_000_000_000_000_000n],
              }),
            )
          : Promise.resolve(undefined),
      ]);

    const asString = (v: bigint | undefined): string | null => (v !== undefined ? v.toString() : null);
    const bias = coefficients?.[0];
    const slope = coefficients?.[1];

    return {
      minDeposit: asString(minDeposit),
      minLockTime: asString(minLock),
      cooldown: asString(cooldown),
      feePercent: asString(feePercent),
      minFeePercent: asString(minFeePercent),
      minCooldown: asString(minCooldown),
      maxTime: asString(maxTime),
      bias: asString(bias),
      slope: asString(slope),
    };
  },
);
