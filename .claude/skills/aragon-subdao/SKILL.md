---
name: aragon-subdao
description: >-
  Use when working on DAO linking, parent/child DAOs, subdao hierarchy, or
  acknowledgement permissions. Covers bidirectional permission flow
  (PARENT_TO_SUB + SUB_TO_PARENT), linking/unlinking logic, hierarchy
  constraints (max 2 levels), TVL aggregation, and implementation plan
  for Envio. Full reference: docs/subdao-linking.md
---

# SubDAO / DAO Linking

## Mechanism

Two DAOs link via **bidirectional permission acknowledgement**. Both must grant. One revoke unlinks.

### Permission IDs

```typescript
const PARENT_TO_SUB = keccak256(toBytes("PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID"));
// Granted on parent: where=parent, who=child

const SUB_TO_PARENT = keccak256(toBytes("SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID"));
// Granted on child: where=child, who=parent
```

### Link Flow

1. Parent grants `PARENT_TO_SUB` (where=parent, who=child) → check counterpart → pending
2. Child grants `SUB_TO_PARENT` (where=child, who=parent) → check counterpart → found → validate → link

**Counterpart check**: Query DaoPermission for the opposite permissionId with swapped where/who. Most recent event must be `Granted` (not `Revoked`).

### Validation (before linking)

1. Parent's `parentAccount` must be null (parent can't be someone's child)
2. Child's `linkedAccounts` must be empty (child can't have children — max depth 2)
3. Child's `parentAccount` must be null or same parent (single parent only)

### On Link

```
child.parentAccount = parent.address
parent.linkedAccounts.push(child.address)
```

### Unlink Flow

Single `Revoked` event on either permission ID:
```
child.parentAccount = null
parent.linkedAccounts.remove(child.address)
```

## Hierarchy Rules

- Max depth: **2 levels** (parent → children)
- Parent cardinality: 1 child → 1 parent max
- Child cardinality: 1 parent → many children
- No circular deps (child can't have children)
- Link: bidirectional (both grant). Unlink: unidirectional (one revoke)

## Data Model

On Dao entity (no separate SubDao entity):
```graphql
parentAccount: String        # address of parent (null for parents/standalone)
linkedAccounts: [String!]    # child addresses (empty for children/standalone)
```

## TVL Aggregation

At query time (not stored): `parent.tvlUSD = own + sum(children.tvlUSD)`
Controlled by `onlyParent` query param.

## Implementation Plan for Envio

1. Add `parentAccount` and `linkedAccounts` to schema.graphql + codegen
2. Add constants for both permission ID hashes in `src/constants.ts`
3. In `DAO.Granted` handler:
   - Match permissionId against both acknowledgement IDs
   - Determine parent/child from which ID matched
   - Query counterpart: `context.DaoPermission.getWhere(...)` for opposite permissionId
   - Validate constraints (load both Dao entities)
   - Update both Dao entities if valid
4. In `DAO.Revoked` handler:
   - Same permissionId matching
   - Verify `child.parentAccount == parent.address`
   - Clear both sides

## Full Reference

See `docs/subdao-linking.md` for complete flow with edge cases, API behavior, and legacy implementation details.
