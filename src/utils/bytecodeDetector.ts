import { type Address, getAddress, keccak256, toBytes } from "viem";
import { EIP1967_IMPL_SLOT, ZERO_ADDRESS } from "../constants";
import { PluginInterfaceType } from "../enums";
import { getClientSafe } from "../helpers/rpcProvider";

/**
 * Bytecode-based plugin type detection.
 * Mirrors the legacy PluginDetector — checks if deployed bytecode contains
 * specific function selector hashes. Returns one of the values from the
 * `PluginInterfaceType` enum (single source of truth — used everywhere a
 * plugin type is named, including the GraphQL schema and entity rows).
 */

// Function signature sets per plugin type (from legacy PluginDetector)

// Function signature sets per plugin type (from legacy PluginDetector)
const LOCK_TO_VOTE_FUNCTIONS = [
  "usedVotingPower(uint256,address)",
  "currentTokenSupply()",
  "clearVote(uint256,address)",
  "lockManager()",
];

const TOKEN_VOTING_FUNCTIONS = ["getVotingToken()", "totalVotingPower(uint256)"];

const SPP_FUNCTIONS = ["getStages(uint256)"];

const MULTISIG_FUNCTIONS = ["isMember(address)", "isListed(address)", "multisigSettings()"];

const CAPITAL_DISTRIBUTION_FUNCTIONS = [
  "getCampaign(uint256)",
  "getCampaignStrategyId(uint256)",
  "getCampaignPayout(uint256,address,bytes)",
];

const ADMIN_FUNCTIONS = ["isMember(address)"];

const GAUGE_VOTER_FUNCTIONS = [
  "createGauge(address,string)",
  "deactivateGauge(address)",
  "activateGauge(address)",
  "updateGaugeMetadata(address,string)",
  "votingActive()",
  "epochStart()",
  "epochVoteStart()",
  "epochVoteEnd()",
];

const ROUTER_PLUGIN_FUNCTIONS = ["dispatch()", "isStreamingSource()", "actions()"];

const CLAIMER_PLUGIN_FUNCTIONS = ["claim(bytes)", "actions(bytes)"];

function getFunctionSelector(signature: string): string {
  return keccak256(toBytes(signature)).slice(0, 10).slice(2); // remove 0x, get 4-byte selector hex
}

/**
 * Detect plugin type by fetching bytecode and checking function selectors.
 * Falls back to "unknown" if no pattern matches or RPC fails.
 *
 * Aragon plugins are EIP-1967 transparent proxies — the proxy bytecode
 * is a tiny shim that doesn't expose the function selectors we look for.
 * We resolve the implementation address from slot 0xeip1967 and run
 * detection against the implementation's bytecode. Mirrors legacy
 * `pluginDetector` behaviour. Non-proxies just use their own bytecode.
 *
 * Each `getCode` retries once on transport error — RPC providers
 * occasionally hiccup mid-batch and a single retry catches the most
 * common case (rate-limit / 502 / connection reset).
 */
export async function detectPluginByBytecode(address: string, chainId: number): Promise<PluginInterfaceType> {
  const client = getClientSafe(chainId);
  if (!client) return PluginInterfaceType.Unknown;

  // Resolve EIP-1967 implementation if this is a proxy.
  let codeAddress: Address = address as Address;
  try {
    const slot = await client.getStorageAt({ address: address as Address, slot: EIP1967_IMPL_SLOT });
    if (slot && slot !== "0x" && slot.length >= 42) {
      const impl = getAddress(`0x${slot.slice(-40)}`);
      if (impl !== ZERO_ADDRESS) codeAddress = impl as Address;
    }
  } catch {
    /* Not a proxy or RPC blip — fall through with the original address. */
  }

  const fetchCode = async (): Promise<string | undefined> => {
    try {
      return await client.getCode({ address: codeAddress });
    } catch {
      try {
        return await client.getCode({ address: codeAddress });
      } catch {
        return undefined;
      }
    }
  };

  const bytecode = await fetchCode();

  try {
    if (!bytecode || bytecode === "0x") return PluginInterfaceType.Unknown;

    const code = bytecode.slice(2); // remove 0x

    function hasFunction(signature: string): boolean {
      return code.includes(getFunctionSelector(signature));
    }

    function hasFunctions(functions: string[]): boolean {
      return functions.every(hasFunction);
    }

    // Order matters — more specific checks first (same as legacy)
    if (hasFunctions(LOCK_TO_VOTE_FUNCTIONS)) return PluginInterfaceType.LockToVote;
    if (hasFunctions(TOKEN_VOTING_FUNCTIONS)) return PluginInterfaceType.TokenVoting;
    if (hasFunctions(SPP_FUNCTIONS)) return PluginInterfaceType.Spp;
    if (hasFunctions(MULTISIG_FUNCTIONS)) return PluginInterfaceType.Multisig;
    if (hasFunctions(CAPITAL_DISTRIBUTION_FUNCTIONS)) return PluginInterfaceType.CapitalDistributor;
    if (hasFunctions(ADMIN_FUNCTIONS)) return PluginInterfaceType.Admin;
    if (hasFunctions(GAUGE_VOTER_FUNCTIONS)) return PluginInterfaceType.Gauge;
    if (hasFunctions(ROUTER_PLUGIN_FUNCTIONS)) return PluginInterfaceType.Router;
    if (hasFunctions(CLAIMER_PLUGIN_FUNCTIONS)) return PluginInterfaceType.Claimer;

    return PluginInterfaceType.Unknown;
  } catch {
    return PluginInterfaceType.Unknown;
  }
}
