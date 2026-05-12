import type { HandlerContext } from "generated";
import { getAddress } from "viem";
import { MINT_PERMISSION_ID, ZERO_ADDRESS } from "../constants";
import { fetchTokenMetadata } from "../effects/token";
import { type ClockMode, PermissionEvent, TokenType } from "../enums";
import logger from "../helpers/logger";
import { tokenId } from "../ids";
import { shouldMarkAsSpam } from "../utils/spam";

const llo = logger.logMeta.bind(null, { service: "services:token" });

/**
 * Find-or-create a Token row for an ERC-20/721 contract. Idempotent —
 * subsequent calls for the same `(chainId, tokenAddress)` are no-ops, except
 * the `isGovernance` flag can be flipped from false → true if a Plugin later
 * attaches to a previously-discovered token.
 *
 * On first sight, fetches all chain-readable metadata (name, symbol, decimals,
 * totalSupply, underlying-if-wrapper, implementation-if-proxy) plus a
 * bytecode-driven interface detection (type + isGovernance + isEscrowAdapter)
 * via the cached `fetchTokenMetadata` effect.
 *
 * `isGovernance` is the OR of:
 *   - bytecode detection (ERC20Votes interface present)
 *   - caller-supplied flag — true when a Plugin's `tokenAddress` references
 *     this token, even if the contract uses non-standard governance interfaces
 *
 * Skips `ZERO_ADDRESS` (native — no contract to read).
 *
 * Mirrors legacy `ProxyToken.saveAndGetToken` minus the price/spam/holders
 * layers — those belong in the future enrichment service.
 */
export async function addToken(
  context: HandlerContext,
  params: {
    chainId: number;
    tokenAddress: string;
    blockNumber: number;
    blockTimestamp: number;
    transactionHash: string;
    isGovernance?: boolean;
  },
): Promise<void> {
  const tokenAddress = getAddress(params.tokenAddress);
  if (tokenAddress === ZERO_ADDRESS) return;

  const id = tokenId(params.chainId, tokenAddress);
  const existing = await context.Token.get(id);

  // Plugin attachment after first discovery — flip isGovernance on if needed.
  // Governance tokens are never spam (per legacy rule), so also clear isSpam
  // when the flag flips on.
  if (existing) {
    if (params.isGovernance && !existing.isGovernance) {
      context.Token.set({ ...existing, isGovernance: true, isSpam: false });
      logger.debug("Token isGovernance flipped on", llo({ id, reason: "plugin attachment" }));
    }
    return;
  }

  const metadata = await context.effect(fetchTokenMetadata, {
    tokenAddress,
    chainId: params.chainId,
  });

  // Default to erc20 when bytecode detection fails — addToken is currently
  // only called from ERC20-flavoured paths (wildcard Transfer handler +
  // PluginSetupProcessor token-voting plugins), so erc20 is the right
  // fallback. Effect's `interfaceType` is renamed from `type` to dodge a
  // postgres-js arraySerializer collision (see effect comment). Compared
  // to the `TokenType` enum value (single source of truth for token kinds).
  const detectedType = metadata?.interfaceType === TokenType.Erc721 ? TokenType.Erc721 : TokenType.Erc20;
  const isGovernance = (metadata?.isGovernance ?? false) || (params.isGovernance ?? false);
  const isEscrowAdapter = metadata?.isEscrowAdapter ?? false;

  // Backward-lookup: a DAO may have been granted MINT_PERMISSION on this token
  // BEFORE we discovered the token via Transfer events. Envio's getWhere only
  // allows ONE filter field, so query by `whereAddress` (very selective —
  // most tokens never appear as a permission `where`) and filter the rest in
  // memory. Forward-flip in DAO.Granted handler covers grants that arrive
  // after the Token row exists.
  const permsAtAddress = await context.DaoPermission.getWhere({
    whereAddress: { _eq: tokenAddress },
  });
  const mintableByDao = permsAtAddress.some(
    (p) => p.permissionId === MINT_PERMISSION_ID && p.event === PermissionEvent.Granted,
  );
  const { isSpam, spamScore } = shouldMarkAsSpam({
    chainId: params.chainId,
    name: metadata?.name ?? undefined,
    symbol: metadata?.symbol ?? undefined,
    type: detectedType,
    isGovernance,
    isEscrowAdapter,
  });

  context.Token.set({
    id,
    chainId: params.chainId,
    address: tokenAddress,
    blockNumber: params.blockNumber,
    blockTimestamp: params.blockTimestamp,
    transactionHash: params.transactionHash,
    type: detectedType,
    isGovernance,
    isEscrowAdapter,
    isSpam,
    spamScore,
    name: metadata?.name ?? undefined,
    symbol: metadata?.symbol ?? undefined,
    decimals: metadata?.decimals ?? undefined,
    totalSupply: metadata?.totalSupply ? BigInt(metadata.totalSupply) : undefined,
    underlying: metadata?.underlying ?? undefined,
    implementationAddress: metadata?.implementationAddress ?? undefined,
    clockMode: (metadata?.clockMode ?? undefined) as ClockMode | undefined,
    mintableByDao,
    // Price fields are owned by the external enrichment service
    // (CoinGecko / Alchemy Prices). Indexer leaves them null on first
    // sight and never updates them.
    priceUsd: undefined,
    priceUpdatedAt: undefined,
  });

  logger.debug(
    "Token created",
    llo({
      id,
      type: detectedType,
      isGovernance,
      isEscrowAdapter,
      isSpam,
      spamScore,
      mintableByDao,
      clockMode: metadata?.clockMode,
      name: metadata?.name,
      symbol: metadata?.symbol,
    }),
  );
}
