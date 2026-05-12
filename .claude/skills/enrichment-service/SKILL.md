---
name: enrichment-service
description: >-
  Use when planning, designing, or eventually building the separate enrichment
  service that handles strictly-external concerns the indexer can't or
  shouldn't do: token pricing (CoinGecko), token logos (CoinGecko), holder
  counts (explorer APIs), periodic refresh of mutable data (price/totalSupply),
  and provider abstraction with per-chain primary + fallback routing.
  Currently a design plan only — no code yet.
---

# Enrichment Service (planned, not built)

Separate Node process that runs alongside HyperIndex and adds chain-external
data to indexed entities. Does NOT exist yet — this skill captures the design
so when we build it the architecture is locked in.

## Why a separate service

The indexer (`pnpm dev`) is event-driven and reads chain data once at
first-sight (no refresh loop). The following concerns don't fit that model:

| Concern | Why not in indexer |
|---|---|
| Pricing | needs CoinGecko HTTP API; rate-limited; refreshes every N minutes |
| Logo | same source (CoinGecko); refreshes weekly |
| Holder count | explorer-API-driven; refreshes hourly; expensive cross-event aggregation |
| Periodic refresh of price / totalSupply / holders | indexer is event-driven, not cron-driven |
| Provider abstraction with primary + fallback routing | per-chain config that doesn't fit handler model |

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│ HyperIndex (pnpm dev)                                       │
│ writes: Dao, Token, Member, Transaction, Asset, ...         │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
            ┌─────────────────┐
            │   Postgres      │
            │                 │
            │ Token           │ ← indexer-owned (read-only for enrichment)
            │ TokenEnrichment │ ← enrichment-owned (1:1 with Token)
            └────────▲────────┘
                     │ reads Token list, writes TokenEnrichment rows
                     │
┌────────────────────┴────────────────────────────────────────┐
│ Enrichment service (separate Node process)                  │
│  scheduler → jobs → providers (with throttle + fallback)    │
└─────────────────────────────────────────────────────────────┘
```

**Source-of-truth split**: Indexer NEVER writes `TokenEnrichment`. Enrichment
NEVER writes `Token`. Disjoint write sets, no row-level conflicts. Hasura
exposes the join via a relationship config (`Token { ... enrichment {...} }`).

## Schema separation

```graphql
type TokenEnrichment {
  id: ID!                  # same as Token.id — joinable
  priceUsd: BigDecimal
  priceUpdatedAt: Int
  logo: String
  logoUpdatedAt: Int
  holders: Int
  holdersUpdatedAt: Int
  fetchFailCount: Int!
  nextRefreshAt: Int
}
```

## Provider abstraction

Each capability has an interface. Each provider implements it. Per-chain registry
routes to primary + fallbacks (mirrors `docs/CHAIN_INTEGRATIONS.md`).

```ts
interface PriceProvider {
  getPrice(token: string, chainId: number): Promise<{ priceUsd: string; logo?: string } | null>;
}

interface HolderCountProvider {
  getHolderCount(token: string, chainId: number): Promise<number | null>;
}

const PRICE_PROVIDERS: Record<number, PriceProvider[]> = {
  1:    [coinGecko],                  // ethereum
  137:  [coinGecko],                  // polygon
  4114: [],                           // citrea — coingecko on-chain doesn't index it
};

const HOLDER_PROVIDERS: Record<number, HolderCountProvider[]> = {
  1:    [etherscan, routescan],       // etherscan v2 primary, routescan fallback
  88888: [routescan],                 // chiliz — etherscan doesn't support
  3338: [subscan],                    // peaq — substrate
  4114: [blockscout],                 // citrea
};

async function tryWithFallback<T>(providers: T[], call: (p: T) => Promise<U | null>): Promise<U | null> {
  for (const p of providers) {
    try { const r = await call(p); if (r !== null) return r; }
    catch (e) { /* log + continue */ }
  }
  return null;
}
```

The provider matrix already exists as data in `docs/CHAIN_INTEGRATIONS.md` —
the build is just code-ifying it.

## Refresh cadence (per field)

| Field | Default | Backoff on failure (legacy schedule) |
|---|---|---|
| `priceUsd` | every 15 min (top 100 active) / 1 hour (rest) | 1d → 3d → 7d → 14d → 30d |
| `logo` | every 7 days | same |
| `holders` | every 1 hour | same |

Per-row `nextRefreshAt` timestamp; cron loop picks rows past their deadline.

## Rate limiting

`bottleneck`-style throttle per provider:
- CoinGecko free: 30 req/min → 1 req/2s
- CoinGecko paid: 500 req/min → ~8 req/s
- Etherscan free: 5 req/s
- Configured via env (`BOTTLENECK_COINGECKO_MIN_TIME_MS` etc., same vars as legacy)

## File structure (when built)

```
enrichment-service/
├── package.json                  # own deps (pg, axios, dotenv, bottleneck)
├── src/
│   ├── index.ts                  # entry: scheduler.start()
│   ├── config.ts                 # env vars
│   ├── db.ts                     # pg pool
│   ├── scheduler.ts              # tick loop, deadline-driven
│   ├── jobs/
│   │   ├── tokenPrice.ts
│   │   ├── tokenLogo.ts
│   │   └── tokenHolders.ts
│   ├── providers/
│   │   ├── types.ts              # PriceProvider, HolderCountProvider interfaces
│   │   ├── registry.ts           # per-chain mapping (mirrors CHAIN_INTEGRATIONS.md)
│   │   ├── coingecko.ts
│   │   ├── etherscan.ts
│   │   ├── routescan.ts
│   │   ├── blockscout.ts
│   │   └── subscan.ts
│   └── utils/
│       └── tryWithFallback.ts
└── docs/
    └── ENRICHMENT.md             # operational runbook
```

## Phasing (when we build it)

| Phase | Scope | Effort |
|---|---|---|
| 1. Scaffolding + DB connect + one-shot CLI | 0.5d |
| 2. Provider interfaces + CoinGecko impl + bottleneck throttle | 1d |
| 3. TokenEnrichment table + price refresh job | 0.5d |
| 4. Scheduler (cron loop, deadline-driven, backoff) | 0.5d |
| 5. Etherscan / Routescan + holders job | 1d |
| 6. Blockscout + Subscan + per-chain routing | 1d |
| 7. Logo job + observability | 0.5d |
| 8. Hasura relationship + frontend wire | 0.5d |
| **Total** | ~5d |

## Operational model

- Both processes daemonized (Docker / pm2 / systemd) — independent restarts
- Indexer can run alone (Token rows written, just no enrichment)
- Enrichment can run alone (won't crash if no Tokens — just idles)
- Backfill mode: `pnpm enrichment:backfill --chain 1` for one-shot historical fill

## What does NOT belong here

- Anything chain-event-driven (those go in HyperIndex)
- Pure derivations like spam scoring (already inline in indexer at `src/utils/spam.ts`)
- Authoritative balance reconciliation against on-chain `balanceOf` (could go either here or in indexer; lean here so the indexer stays pure event-driven)

## When to revisit / decide to build

Triggers:
- Frontend asks for token logos or USD prices
- Spam classification needs the price-rescue rule (token has CG price → not spam)
- Treasury UI needs USD-denominated TVL
- Token list page needs holder counts

Until then: design lives here, no code.

## Related skills

- `aragon-token` — what fields the indexer DOES populate (everything chain-derivable)
- `chain-integrations` — per-chain external service mapping (the provider matrix this service implements)