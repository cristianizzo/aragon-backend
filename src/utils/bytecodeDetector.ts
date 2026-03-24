import { keccak256, toBytes } from "viem";
import { getClientSafe } from "../config";

/**
 * Bytecode-based plugin type detection.
 * Mirrors the legacy PluginDetector — checks if deployed bytecode contains
 * specific function selector hashes.
 */

type DetectedPluginType =
  | "multisig"
  | "tokenVoting"
  | "admin"
  | "addresslistVoting"
  | "spp"
  | "lockToVote"
  | "gauge"
  | "capitalDistributor"
  | "router"
  | "claimer"
  | "unknown";

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
 */
export async function detectPluginByBytecode(address: string, chainId: number): Promise<DetectedPluginType> {
  const client = getClientSafe(chainId);
  if (!client) return "unknown";

  try {
    const bytecode = await client.getCode({ address: address as `0x${string}` });
    if (!bytecode || bytecode === "0x") return "unknown";

    const code = bytecode.slice(2); // remove 0x

    function hasFunction(signature: string): boolean {
      return code.includes(getFunctionSelector(signature));
    }

    function hasFunctions(functions: string[]): boolean {
      return functions.every(hasFunction);
    }

    // Order matters — more specific checks first (same as legacy)
    if (hasFunctions(LOCK_TO_VOTE_FUNCTIONS)) return "lockToVote";
    if (hasFunctions(TOKEN_VOTING_FUNCTIONS)) return "tokenVoting";
    if (hasFunctions(SPP_FUNCTIONS)) return "spp";
    if (hasFunctions(MULTISIG_FUNCTIONS)) return "multisig";
    if (hasFunctions(CAPITAL_DISTRIBUTION_FUNCTIONS)) return "capitalDistributor";
    if (hasFunctions(ADMIN_FUNCTIONS)) return "admin";
    if (hasFunctions(GAUGE_VOTER_FUNCTIONS)) return "gauge";
    if (hasFunctions(ROUTER_PLUGIN_FUNCTIONS)) return "router";
    if (hasFunctions(CLAIMER_PLUGIN_FUNCTIONS)) return "claimer";

    return "unknown";
  } catch {
    return "unknown";
  }
}
