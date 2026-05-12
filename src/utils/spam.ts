/**
 * Spam-token heuristic. Pure function over already-fetched name/symbol — no
 * I/O. Mirrors legacy `app-backend/src/helpers/tokenUtils.ts`'s
 * `getSpamScore` + `shouldMarkAsSpam`, with two intentional differences:
 *
 *   1. The legacy "no logo → +1 score" rule is dropped. We don't fetch logos
 *      (CoinGecko enrichment lives outside the indexer), so adding +1 to
 *      every token would just shift all thresholds by 1.
 *   2. The legacy "has CoinGecko price → not spam" rescue is dropped for the
 *      same reason — no CoinGecko data to consult. When the enrichment
 *      service lands it can override `isSpam` post-hoc.
 *
 * Governance / escrow-adapter / native tokens are exempt — never marked spam
 * regardless of name. Testnets are exempt — testnet tokens often have garbage
 * names by design.
 */

import { TESTNET_CHAIN_IDS } from "../constants";
import type { TokenType } from "../enums";

const HIGH_RISK_KEYWORDS = [
  "airdrop",
  "giveaway",
  "casino",
  "mystery",
  "voucher",
  "visit",
  "ads",
  "promotion",
  "prize",
  "lucky",
  "bonus",
  "free",
];

const LOW_RISK_KEYWORDS = [
  "claim",
  "reward",
  "rewards",
  "join",
  "gift",
  "win",
  "box",
  "official",
  "link",
  "sign",
  "confirm",
];

const URL_REGEX = /(?:https?:\/\/|www\.)[^\s]+/i;
const SHORT_URL_REGEX = /\b[a-z0-9-]+\.(ly|io|co|me|link|site|click|top|win|vip|gg|app)\b/i;
const RED_FLAG_PATTERNS: readonly RegExp[] = [
  /[▷►▶→🎁💰🚀💎🔥✨🎉🏆💵💲🤑]/u,
  /\$[A-Z]+\s+.*\./,
  /use.*official.*link/i,
  /trust.*wallet.*mystery/i,
  /ads:\s*/i,
  /!\s*ads/i,
  /!\s*\$\d+/i,
  /\$\d{3,}/,
  /claim[a-z]*\.(io|com|net|org)/i,
  /(bonus|free|gift|airdrop|reward)[a-z-]*\.(net|org|com|io)/i,
];

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function getSpamScore(name: string | undefined, symbol: string | undefined): number {
  const formattedName = (name ?? "").toLowerCase();
  const formattedSymbol = (symbol ?? "").toLowerCase();
  const combined = `${formattedName} ${formattedSymbol}`;
  const normalized = combined.replace(/(\w)\s+(?=\w)/g, "$1");

  let score = 0;

  if (URL_REGEX.test(combined) || SHORT_URL_REGEX.test(combined) || SHORT_URL_REGEX.test(normalized)) {
    score += 3;
  }

  for (const keyword of HIGH_RISK_KEYWORDS) {
    const matches = combined.match(new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi"));
    if (matches) score += 2 * matches.length;
  }

  for (const keyword of LOW_RISK_KEYWORDS) {
    const matches = combined.match(new RegExp(`\\b${escapeRegExp(keyword)}\\b`, "gi"));
    if (matches) score += matches.length;
  }

  for (const pattern of RED_FLAG_PATTERNS) {
    if (pattern.test(combined) || pattern.test(normalized)) score += 2;
  }

  return score;
}

export function shouldMarkAsSpam(params: {
  chainId: number;
  name: string | undefined;
  symbol: string | undefined;
  type: TokenType;
  isGovernance: boolean;
  isEscrowAdapter: boolean;
}): { spamScore: number; isSpam: boolean } {
  const spamScore = getSpamScore(params.name, params.symbol);

  if (TESTNET_CHAIN_IDS.has(params.chainId)) return { spamScore, isSpam: false };
  if (params.type === "nativeToken" || params.isGovernance || params.isEscrowAdapter) {
    return { spamScore, isSpam: false };
  }

  if (spamScore >= 5) return { spamScore, isSpam: true };
  if (spamScore === 0) return { spamScore, isSpam: false };
  return { spamScore, isSpam: spamScore >= 2 };
}
