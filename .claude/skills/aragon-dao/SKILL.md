---
name: aragon-dao
description: >-
  Use when working on DAO registration, metadata, permissions, linking, or
  treasury. Covers DAORegistered → Dao entity, MetadataSet → IPFS fetch,
  Granted/Revoked → DaoPermission, NativeTokenDeposited, Executed events,
  DAO linking (parent/child), and treasury/asset tracking.
---

# DAO Flow

## Registration (DAORegistry.DAORegistered)

Single transaction creates DAO + installs plugins. Entry point: `DAOFactory.createDAO()`.

**contractRegister**: `context.addDAO(dao)` — starts tracking DAO contract events.
**handler**: Creates `Dao` entity (ID: `${chainId}-${daoAddress}`) with zeroed metrics, no metadata.

Files: `src/handlers/DAORegistry.ts`

## Metadata (DAO.MetadataSet)

Extracts IPFS CID from `bytes metadata`, fetches JSON via gateway chain (Pinata → ipfs.io → dweb.link → cloudflare). Updates Dao: name, description, avatar, links. Can fire multiple times. Missing fields preserve previous values.

Legacy also stores: `processKey`, `stageNames`, `blockedCountries`, `termsConditionsUrl`, `enableOfacCheck`.

Files: `src/handlers/DAO.ts`, `src/effects/ipfs.ts`, `src/utils/metadata.ts`

## Permissions (DAO.Granted / DAO.Revoked)

Each event creates a `DaoPermission` entity (audit trail). On Granted with non-zero condition: `context.addExecuteSelectorCondition(condition)`.

Legacy also does: DAO linking via bidirectional acknowledgement permissions, admin member creation, plugin reinstall/uninstall via permission changes.

## DAO Linking (Legacy — not yet in Envio)

Two permission IDs: `PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID` and `SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID`. When both granted bidirectionally, DAOs are linked. Constraints: no role inversion, child can only have one parent. Stores `parentAccount` and `linkedAccounts[]`.

## NativeTokenDeposited / Executed (Legacy — empty handlers in Envio)

- `NativeTokenDeposited`: Creates Transaction entity (deposit)
- `Executed`: Detects DAO upgrades (`upgradeToAndCall`), extracts native transfers from actions, triggers asset recalculation

## Treasury (Legacy — not in Envio)

Tracks native + ERC20 balances per DAO via Asset entity. USD values via CoinGecko. TVL = sum of assets. Triggered by transaction/execution events.

## Schema

```graphql
type Dao {
  id: ID!  # ${chainId}-${daoAddress}
  chainId: Int!
  address: String!
  creatorAddress: String!
  subdomain: String
  implementationAddress: String  # TODO: RPC EIP-1967
  ens: String                    # TODO: ${subdomain}.dao.eth
  version: String                # TODO: RPC protocolVersion()
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
```
