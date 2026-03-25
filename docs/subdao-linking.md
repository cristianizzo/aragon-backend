# SubDAO / DAO Linking Flow

## Overview

Two DAOs link via **bidirectional permission acknowledgement**. Both sides must grant a specific permission to each other. Only when BOTH are active does the link form. The hierarchy is flat — max 2 levels (parent → children), no grandchildren.

## Permission IDs

```
PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID = keccak256("PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID")
  → Granted on parent DAO: where = parent address, who = child address

SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID = keccak256("SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID")
  → Granted on child DAO: where = child address, who = parent address
```

## Linking Flow

```
Parent DAO grants PARENT_TO_SUB on itself, who=child
  → handler checks: does counterpart permission exist? (child granted SUB_TO_PARENT, who=parent)
  → NO → pending, do nothing

Child DAO grants SUB_TO_PARENT on itself, who=parent
  → handler checks: does counterpart exist? (parent granted PARENT_TO_SUB, who=child)
  → YES → validate constraints → linkDaos()
```

Order doesn't matter — whichever grant comes second triggers the link (if counterpart exists).

### Validation Constraints (all must pass before linking)

1. **No role inversion**: Parent cannot already be a child of another DAO (`parentAccount` must be null)
2. **No child demotion**: Child cannot already have children (`linkedAccounts.length` must be 0) — prevents depth > 2
3. **Single parent**: Child cannot already have a different parent
4. Both DAOs must exist in the database

### On Successful Link

- Child DAO: `parentAccount = parent.address`
- Parent DAO: `linkedAccounts.push(child.address)`
- Atomic transaction (MongoDB `DbTx.executeTxFn()` in legacy)

## Unlinking Flow

Only needs **one** permission revoked (either side):

```
Revoked(PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID)
  or
Revoked(SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID)
  │
  ▼
Determine parent/child from permissionId:
  PARENT_TO_SUB → parent = where, child = who
  SUB_TO_PARENT → parent = who, child = where
  │
  ▼
Verify child.parentAccount == parent.address
  │
  ▼
unlinkDaos():
  Child: parentAccount = null
  Parent: remove child from linkedAccounts[]
```

## Hierarchy Rules

| Rule | Constraint |
|---|---|
| Max depth | **2 levels only** (parent → children, no grandchildren) |
| Parent cardinality | 1 child has at most 1 parent |
| Child cardinality | 1 parent can have many children |
| Circular dependencies | Impossible (child can't have children, so no cycles) |
| Link trigger | Both permissions must be active (bidirectional) |
| Unlink trigger | Single revoke (one-directional) |

## Data Model

No separate SubDao entity — relationship is purely on the Dao model:

```
Dao {
  parentAccount: string | null     // address of parent DAO (for children)
  linkedAccounts: string[]         // addresses of child DAOs (for parents)
}
```

## TVL Aggregation

At **query time** (not stored on entity), parent's TVL includes children:

```
parent.metrics.tvlUSD = parent.ownTvl + sum(child.tvlUSD for each linkedAccount)
```

Controlled by `onlyParent` query parameter:
- `onlyParent=false` (default): aggregate children TVL into parent
- `onlyParent=true`: return parent's own TVL only

## API Behavior (Legacy)

Querying a parent DAO automatically includes linked accounts' data:
- **Assets**: aggregated across parent + all children
- **Policies**: includes all children's policies
- **Transactions**: includes all children's transactions
- **Response**: `linkedAccounts` contains full child DAO objects (not just addresses)

## Counterpart Permission Query

To verify the counterpart exists, the legacy code queries `DaoPermission` for:
- The opposite permission ID
- The swapped where/who addresses
- Most recent event must be `Granted` (not `Revoked`)

```typescript
// If we received PARENT_TO_SUB (where=parent, who=child):
// Check for SUB_TO_PARENT where=child, who=parent, event=Granted
const counterpart = await DaoPermission.findActiveAcknowledgementPermission({
  permissionId: SUB_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID,
  where: childAddress,
  who: parentAddress,
  network
});
```

## Implementation in Envio

To implement in the Envio indexer:

1. **Schema changes**: Add to Dao entity:
   ```graphql
   parentAccount: String
   linkedAccounts: [String!]
   ```

2. **Constants**: Compute permission ID hashes:
   ```typescript
   const PARENT_TO_SUB_PERM = keccak256(toBytes("PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID"));
   const SUB_TO_PARENT_PERM = keccak256(toBytes("SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID"));
   ```

3. **DAO.Granted handler**: Check if `event.params.permissionId` matches either acknowledgement ID. If yes:
   - Determine parent/child from permissionId
   - Query `DaoPermission` entities via `context.DaoPermission.getWhere(...)` for counterpart
   - Validate constraints
   - Update both Dao entities

4. **DAO.Revoked handler**: Check same permissionId match → determine parent/child → unlink

5. **TVL aggregation**: Not indexer responsibility — handle at API/query layer

## Edge Cases

- **Single permission only**: No link formed — waiting for counterpart
- **Both permissions revoked**: First revoke unlinks; second revoke is a no-op
- **DAO not found**: Gracefully skip (DAO may be on different chain or not yet indexed)
- **Re-linking**: After unlink, can re-link by granting both permissions again
- **Permission replacement**: If a new grant replaces a revoke, triggers re-evaluation
