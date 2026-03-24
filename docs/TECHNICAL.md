# Aragon Indexer — Technical Architecture

## Overview

The Aragon Indexer is built on [Envio HyperIndex](https://docs.envio.dev), an event-driven EVM indexer that uses HyperSync for high-throughput historical sync and RPC fallback for real-time blocks. It indexes the full Aragon OSx protocol across 11 chains.

The indexer follows a **factory pattern**: only three contracts have known addresses per chain (DAORegistry, PluginRepoRegistry, PluginSetupProcessor). All other contracts (DAOs, plugins, tokens, VE contracts) are discovered dynamically at runtime as events fire.

---

## Flow 1: DAO Deployment

When a user creates a DAO through the Aragon app, they call `DAOFactory.createDAO()`. This single transaction triggers a cascade of events. This document covers only the DAO-level events — plugin installation is a separate flow.

### What gets indexed

The DAO deployment flow produces one `Dao` entity with:
- On-chain data: address, creator, subdomain, block/tx info
- Off-chain metadata from IPFS: name, description, avatar, links
- Aggregate metrics: proposalCount, proposalsExecuted, voteCount, uniqueVoters, memberCount
- Permissions: individual `DaoPermission` entities for each grant/revoke

### Contracts involved

| Contract | Type | Events |
|---|---|---|
| **DAORegistry** | Known address (per chain) | `DAORegistered` |
| **DAO** | Dynamic (registered when DAORegistered fires) | `MetadataSet`, `Granted`, `Revoked`, `Executed`, `NativeTokenDeposited` |

---

### Step 1: DAO Registration

**Contract**: DAORegistry
**Event**: `DAORegistered(address indexed dao, address indexed creator, string subdomain)`

This is the entry point. The DAORegistry has a known, hardcoded address per chain in `config.yaml`. When it emits `DAORegistered`, two things happen:

#### 1a. contractRegister — start tracking the new DAO contract

```typescript
// src/handlers/DAORegistry.ts
DAORegistry.DAORegistered.contractRegister(({ event, context }) => {
  context.addDAO(event.params.dao);
});
```

This tells HyperIndex: "start listening for events on this DAO address". From this point forward, the indexer will capture `MetadataSet`, `Granted`, `Revoked`, `Executed`, and `NativeTokenDeposited` events from this specific DAO contract.

**This runs BEFORE the handler** — it's the factory pattern that enables dynamic contract discovery.

#### 1b. handler — create the Dao entity

```typescript
// src/handlers/DAORegistry.ts
DAORegistry.DAORegistered.handler(async ({ event, context }) => {
  const chainId = event.chainId;
  const daoAddress = event.params.dao;
  const id = `${chainId}-${daoAddress}`;

  const existing = await context.Dao.get(id);
  if (existing) return;  // idempotent — skip if already exists

  context.Dao.set({
    id,
    chainId,
    address: daoAddress,
    blockNumber: event.block.number,
    blockTimestamp: event.block.timestamp,
    transactionHash: event.transaction.hash,
    creatorAddress: event.params.creator,
    subdomain: event.params.subdomain || undefined,

    // Metadata — empty until MetadataSet fires
    metadataUri: undefined,
    name: undefined,
    description: undefined,
    avatar: undefined,
    links: undefined,

    // Metrics — zeroed, updated by governance handlers
    proposalCount: 0,
    proposalsExecuted: 0,
    uniqueVoters: 0,
    voteCount: 0,
    memberCount: 0,

    // Other fields
    implementationAddress: undefined,
    ens: undefined,
    version: undefined,
  });
});
```

**Entity ID**: `${chainId}-${daoAddress}` — ensures uniqueness across chains.

At this point the Dao entity exists but has no name, description, or avatar. Those come from the next event.

---

### Step 2: Metadata from IPFS

**Contract**: DAO (now being tracked from Step 1a)
**Event**: `MetadataSet(bytes metadata)`

In the same DAO creation transaction, the DAO contract emits `MetadataSet`. The `metadata` bytes contain a UTF-8 encoded IPFS URI (e.g., `ipfs://QmXyz...`).

#### 2a. Extract the IPFS CID

```typescript
// src/utils/metadata.ts — extractIpfsCid()
// 1. Decode bytes from hex to UTF-8 string
// 2. Strip "ipfs://" prefix
// 3. Return the raw CID (e.g., "QmXyz..." or "bafyrei...")
```

#### 2b. Fetch metadata from IPFS

```typescript
// src/handlers/DAO.ts
DAO.MetadataSet.handler(async ({ event, context }) => {
  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  const cid = extractIpfsCid(event.params.metadata);
  if (!cid) return;

  const metadata = await context.effect(fetchDaoMetadata, cid);

  context.Dao.set({
    ...dao,
    metadataUri: `ipfs://${cid}`,
    name: metadata?.name ?? dao.name,
    description: metadata?.description ?? dao.description,
    avatar: metadata?.avatar ?? dao.avatar,
    links: safeJsonParse(metadata?.linksJson) ?? dao.links,
  });
});
```

The `fetchDaoMetadata` effect (`src/effects/ipfs.ts`) tries IPFS gateways in order until one returns HTTP 200:

| Priority | Gateway | Notes |
|---|---|---|
| 1 | `aragon-1.mypinata.cloud/ipfs/` | Pinata dedicated gateway (configurable via `PINATA_GATEWAY_URI`) |
| 2 | `ipfs.io/ipfs/` | Public gateway |
| 3 | `dweb.link/ipfs/` | Public gateway |
| 4 | `cloudflare-ipfs.com/ipfs/` | Public gateway |

Each gateway attempt has a **10 second timeout**. On failure it moves to the next gateway. If all fail, metadata fields remain `undefined`.

**IPFS JSON structure** (what the gateway returns):
```json
{
  "name": "My DAO",
  "description": "A community DAO for...",
  "avatar": "ipfs://QmAvatar...",
  "links": [
    { "name": "Website", "url": "https://mydao.org" },
    { "name": "Discord", "url": "https://discord.gg/..." }
  ]
}
```

**Important behaviors**:
- `MetadataSet` can fire **multiple times** over a DAO's lifetime (any metadata update triggers it)
- New values overwrite old ones; missing fields in new metadata **preserve** old values via the `?? dao.existingValue` fallback
- The effect has `cache: true` — if the same CID is requested again (e.g., during reindex), it returns the cached result without re-fetching
- `links` is stored as a JSON array on the entity (serialized via `JSON.stringify`, parsed back via `safeJsonParse`)

---

### Step 3: Permissions

**Contract**: DAO
**Events**: `Granted(permissionId, here, where, who, condition)`, `Revoked(permissionId, here, where, who)`

In the DAO creation transaction, several `Granted` events fire to set up initial permissions (e.g., granting the plugin `EXECUTE_PERMISSION` on the DAO).

#### 3a. Granted — contractRegister for conditions

```typescript
// src/handlers/DAO.ts
DAO.Granted.contractRegister(({ event, context }) => {
  const condition = event.params.condition;
  if (condition && condition !== ZERO_ADDRESS) {
    context.addExecuteSelectorCondition(condition);
  }
});
```

If a permission has a non-zero `condition` address, the indexer starts tracking that condition contract for `SelectorAllowed`/`SelectorDisallowed` events (covered in a separate flow).

#### 3b. Granted/Revoked — create DaoPermission entities

```typescript
// src/handlers/DAO.ts
DAO.Granted.handler(async ({ event, context }) => {
  const dao = await context.Dao.get(daoId);
  if (!dao) return;

  context.DaoPermission.set({
    id: `${chainId}-${event.transaction.hash}-${event.logIndex}`,
    chainId,
    dao_id: daoId,
    daoAddress,
    blockNumber: event.block.number,
    transactionHash: event.transaction.hash,
    logIndex: event.logIndex,
    permissionId: event.params.permissionId,    // bytes32 identifier
    whoAddress: event.params.who,                // who is granted
    whereAddress: event.params.where,            // on which contract
    event: "Granted",
    conditionAddress: event.params.condition || undefined,
  });
});
```

`Revoked` follows the same pattern with `event: "Revoked"` and no `conditionAddress`.

**Each Granted/Revoked event creates a separate DaoPermission entity** — they are not upserted. This gives a full audit trail of all permission changes over the DAO's lifetime.

---

### Step 4: Other DAO Events (Ongoing)

These events fire throughout the DAO's lifetime, not just at creation:

| Event | Handler Behavior |
|---|---|
| `NativeTokenDeposited(sender, amount)` | Handler exists but **no entity update** — placeholder for future TVL tracking |
| `Executed(actor, callId, actions[], allowFailureMap, failureMap, execResults)` | Handler exists but **no entity update** — placeholder for future execution tracking |
| `MetadataSet(bytes metadata)` | Re-fetches IPFS metadata and updates Dao entity (same logic as Step 2) |
| `Granted(...)` / `Revoked(...)` | Creates new DaoPermission entities (same logic as Step 3) |

---

### Step 5: Metrics (Updated by Other Flows)

The Dao entity carries aggregate metrics that are **not updated in this flow** but by governance plugin handlers (covered in separate flows):

| Metric | Field | Updated When |
|---|---|---|
| Total proposals | `proposalCount` | Any `ProposalCreated` event from any plugin of this DAO |
| Executed proposals | `proposalsExecuted` | Any `ProposalExecuted` event from any plugin of this DAO |
| Total votes | `voteCount` | Any `VoteCast` / `Approved` event from any plugin of this DAO |
| Unique voters | `uniqueVoters` | When a voter address is seen for the first time on this DAO |
| Member count | `memberCount` | Multisig `MembersAdded` (+N) / `MembersRemoved` (-N) events |

The pattern in governance handlers is always:
```typescript
const dao = await context.Dao.get(daoId);
context.Dao.set({ ...dao, proposalCount: dao.proposalCount + 1 });
```

---

### Files

| File | Purpose |
|---|---|
| `src/handlers/DAORegistry.ts` | `DAORegistered` contractRegister + handler |
| `src/handlers/DAO.ts` | `MetadataSet`, `Granted`, `Revoked`, `Executed`, `NativeTokenDeposited` handlers |
| `src/effects/ipfs.ts` | `fetchDaoMetadata` effect — IPFS gateway chain |
| `src/utils/metadata.ts` | `extractIpfsCid` — bytes → CID extraction |
| `src/config.ts` | `ipfsConfig` — gateway URLs and timeout |
| `src/constants.ts` | `ZERO_ADDRESS`, `safeJsonParse` |

### Schema

```graphql
type Dao {
  id: ID!
  chainId: Int!
  address: String! @index
  blockNumber: Int!
  blockTimestamp: Int!
  transactionHash: String!
  creatorAddress: String!
  subdomain: String
  implementationAddress: String
  ens: String
  version: String
  metadataUri: String
  name: String
  description: String
  avatar: String
  links: Json
  proposalCount: Int!
  proposalsExecuted: Int!
  uniqueVoters: Int!
  voteCount: Int!
  memberCount: Int!
}

type DaoPermission {
  id: ID!
  chainId: Int!
  dao: Dao!
  daoAddress: String! @index
  blockNumber: Int!
  transactionHash: String!
  logIndex: Int!
  permissionId: String!
  whoAddress: String! @index
  whereAddress: String! @index
  event: String!
  conditionAddress: String
}
```
