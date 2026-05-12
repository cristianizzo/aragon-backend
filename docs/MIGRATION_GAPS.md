# Migration Gaps — Legacy App-Backend (`main` @ v0.23.1) vs Envio Indexer

Last refreshed by walking the legacy `main` branch (commit `ef5c65d8`,
release `0.23.1`) against the current state of `aragon-indexer`. Items
that were on previous versions of this doc but are now implemented have
been **removed** — this list is the live punch list of work remaining,
nothing more.

Severity scale:
- **P0** — feature is fully absent and needed for parity (blocks launch).
- **P1** — partial parity; downstream consumers can work around it but
  data quality suffers.
- **P2** — polish / extended fields / admin concerns.
- **Out of scope** — Phase 3/4 (Gauge analytics, Capital Distribution
  reward indexing); intentionally deferred.

For each gap: where it lives in legacy → where the fix lands → why.

---

## P0 — fully missing features

### 1. ERC-721 transfer indexing
- **Legacy:** `src/handlers/daoTransferHanlder.ts:41-120` —
  `TransferProcessorFactory.create(ITransactionType.erc721, …)` for both
  inbound and outbound NFT moves; writes `Transaction` + asset history.
- **New indexer:** no ERC-721 subscription in `config.yaml`, no handler.
- **Fix:** add `ERC721` wildcard to `config.yaml` mirroring the existing
  `ERC20`; create `src/handlers/ERC721.ts`; extend `services/asset.ts`
  to handle NFT (count, not amount) + extend `services/transaction.ts`
  for ERC-721 transfer rows.
- **Why:** NFT treasury is invisible — DAOs holding NFTs cannot be
  audited or surfaced in the UI.

### 2. SPP sub-plugin discovery & stage pairing
- **Legacy:** `pairSppPlugins()` reads `StagesUpdated` on the SPP
  plugin, parses the stage structure (voteDuration / thresholds /
  plugins per stage), and links each sub-plugin back to its parent SPP
  with `parentPlugin`, `stageIndex`, `isSubPlugin = true`. The SPP
  itself gets `totalStages` + `subPlugins[]` populated.
- **New indexer:** `Plugin.parentPluginAddress` + `Plugin.subPlugins`
  exist in schema but are never populated. `StagesUpdated` is not in
  `config.yaml`.
- **Fix:** subscribe `StagesUpdated` on `StagedProposalProcessor`; add
  `services/sppStages.ts` that persists the stage structure on the SPP
  Plugin row, sets `parentPluginAddress` / `stageIndex` on each sub-
  plugin, and populates `Plugin.subPlugins`. Cascade on uninstall (see
  P0 #3) consumes the parent link.
- **Why:** SPP queries (multi-stage governance flows) are
  non-functional; the frontend cannot render staged proposals.

### 3. Sub-plugin abandonment cascade on uninstall
- **Legacy:** when a parent plugin is uninstalled, sub-plugins it owned
  are marked `status = abandoned`.
- **New indexer:** `setPluginStatus` writes the parent only; orphans
  remain `Installed`.
- **Fix:** in `services/pluginInstall.ts:setPluginStatus`, when the
  target status is `Uninstalled`, look up children via the
  `parentPluginAddress` index (depends on P0 #2) and mark each as a new
  `PluginStatus.Abandoned` value.
- **Why:** orphaned sub-plugins keep emitting events that bind to a
  dead parent; data integrity drifts.

---

## P1 — partial parity

### 4. Selector-permission function-name decoding
- **Legacy:** `executeHandler.ts` calls `ContractInfo.parseSignature()`
  to resolve the 4-byte selector to function name + inputs + NatSpec
  notice; stored on `SelectorPermission`.
- **New indexer:** `handlers/ExecuteSelectorCondition.ts` writes only
  the raw `selector: bytes4`. No decoding.
- **Fix:** new `effects/decodeSelector.ts` (mirror the
  `decodeProposalActions` pipeline: known ABIs → 4byte → unknown);
  extend `SelectorPermission` schema with `functionName`, `functionSig`,
  `inputs?`; call from the handler's `SelectorAllowed` path.
- **Why:** selector-permission audits are unreadable without the
  function name; debugging requires manual ABI lookup per selector.

### 5. SPP proposal tree + stage execution history
- **Legacy:** `Proposal` model has `subProposals`, `stageExecutions`,
  `results`, `parentProposal`, `isSubProposal`, `totalStages`,
  `stageIndex`, `lastStageTransition` (`models/schema/proposal.ts:341-356`).
- **New indexer:** `Proposal` schema has none of these.
- **Fix:** add the fields to `schema.graphql`; extend
  `services/proposal.ts:createProposal` (and a new updater for stage
  transitions) to populate them. `StagedProposalProcessor.ProposalAdvanced`
  / `ProposalResultReported` handlers (currently placeholders) write the
  stage execution rows.
- **Why:** SPP multi-stage governance UX cannot show progress, sub-
  bodies, or per-stage results.

### 6. Proposal edit / cancel audit trail
- **Legacy:** `Proposal.editedTxInfo`, `cancelTxInfo` capture the txhash
  + block + actor of every edit / cancellation. `incrementalId` mirrors
  the contract's per-plugin proposal counter.
- **New indexer:** `editProposal` / `cancelProposal` overwrite without
  recording history; no `incrementalId`.
- **Fix:** schema additions on `Proposal`, populated by
  `services/proposal.ts:editProposal` / `cancelProposal`. Could mirror
  the `DaoMetadataLog` / `PluginMetadataLog` pattern with a separate
  `ProposalChangeLog` if richer history is needed.
- **Why:** governance forensics — "who changed this proposal and
  when" — currently impossible.

### 7. Per-proposal voting-settings snapshot
- **Legacy:** snapshots the plugin's full voting-config (support
  threshold, min participation, durations) onto each `Proposal` at
  creation, so historical proposals stay valid even if the plugin's
  current settings change.
- **New indexer:** `Proposal.snapshot: Json` only carries the token /
  member-count snapshot.
- **Fix:** in `services/proposal.ts:createProposal`, look up the
  current `PluginSetting` for the plugin and embed it into the
  `snapshot` blob. No schema change.
- **Why:** quorum / approval calculations against historical proposals
  silently break when plugin settings are updated mid-flight.

### 8. Plugin lifecycle via permission events (re-install / uninstall fallback)
- **Legacy:** treats `EXECUTE_PERMISSION` grant on an `Uninstalled`
  plugin as a re-install signal (`status` flips back to `Installed`).
  Symmetric: an `EXECUTE_PERMISSION` revoke without a paired
  `UninstallationApplied` in the same tx triggers an uninstall.
- **New indexer:** neither path exists — plugin status only changes via
  PSP events.
- **Fix:** add re-install + uninstall-fallback branches to
  `handlers/Permission.ts` (Granted / Revoked) that route through
  `setPluginStatus`.
- **Why:** plugins that bypass the standard PSP lifecycle (some legacy
  governance setups) drift out of sync with on-chain reality.

### 9. `PluginSetting` inactivation on uninstall
- **Legacy:** when a plugin is uninstalled, its `PluginSetting` rows
  flip to inactive with an `inactiveAtBlockNumber` stamp.
- **New indexer:** `setPluginStatus` flips only the `Plugin` row;
  settings remain "active".
- **Fix:** `services/pluginInstall.ts:setPluginStatus` extension —
  iterate `PluginSetting` rows for the plugin and patch.
- **Why:** consumers filtering on "active settings" see ghost configs
  for dead plugins.

### 10. `proposalCreationConditionAddress`
- **Legacy:** extracts the condition contract attached to
  `PROPOSAL_CREATION_PERMISSION` from the prepared-setup permissions
  array; surfaces as `Plugin.proposalCreationConditionAddress`.
- **New indexer:** the field exists in the schema (`conditionAddress`
  is the closest match) but is never populated from PSP events.
- **Fix:** in `services/pluginInstall.ts:stubPluginOnInstallPrepared`,
  walk the parsed permissions array, find the entry where `permissionId
  == keccak256("CREATE_PROPOSAL_PERMISSION")`, and set
  `Plugin.conditionAddress` to its `condition` field.
- **Why:** consumers cannot tell which addresses are gated for proposal
  creation without re-walking the permissions blob.

### 11. Cross-plugin metric refresh on token delegation — **decided: query-time aggregation**
- **Legacy:** on `DelegateVotesChanged` / `TokensDelegated`, recomputes
  per-plugin metrics for every plugin whose `tokenAddress` matches the
  delegated token (`governanceErc20Handler.ts:55`,
  `governanceVeHandler.ts:43-52`).
- **New indexer:** `GovernanceERC20.ts` and `VotingEscrow.ts` write the
  `TokenDelegation` / `TokenMember` rows. **No fan-out at handler time.**
- **Decision:** consumers aggregate at GraphQL query time. HyperIndex is
  column-oriented; fan-out at handler time would multiply writes by N
  (number of plugins per token) on every delegation event for very
  little ergonomic gain — clients can join `TokenMember.tokenAddress`
  → `Plugin.tokenAddress` to derive per-plugin voting-power summaries
  directly.
- **No code change required.** This item is closed by design choice.

---

## P2 — extended metadata + admin

### 12. Extended IPFS metadata fields on Dao
- **Legacy:** parses these from the DAO metadata IPFS payload:
  `processKey`, `stageNames`, `blockedCountries`, `enableOfacCheck`,
  `termsConditionsUrl`, plus the original `metadataIpfs` hash kept
  alongside the URI.
- **New indexer:** `parseDaoMetadata` in `utils/metadata.ts` only
  extracts `name / description / avatar / links`.
- **Fix:** extend `parseDaoMetadata` + add the corresponding fields to
  the `Dao` GraphQL type + write-through in `services/dao.ts`.
- **Why:** OFAC / terms / process-key are required for compliant
  product views.

### 13. `Dao.isActive` / `Dao.isHidden`
- **Legacy:** soft-delete + admin-hide flags, used in 5 compound
  indexes (`models/schema/dao.ts:68-72`).
- **New indexer:** absent.
- **Fix:** add nullable boolean columns to `Dao`. Population is
  admin-side, not indexer-driven; the schema needs the slots so the
  application layer can write them.
- **Why:** without the flags the application layer can't soft-delete
  spam DAOs or hide test deployments.

### 14. `Dao.tvlUSD` — **schema-only; aggregation belongs to enrichment service**
- **Legacy:** maintains TVL via periodic Mongo aggregation —
  `daoMetrics.update()` joins `Asset × Token.priceUsd` and sums.
  Prices are populated by a separate price-update job, not on transfer.
- **New indexer:** added `Token.priceUsd: BigInt` + `priceUpdatedAt: Int`
  schema slots. The indexer **never writes them** — the external
  enrichment service (CoinGecko / Alchemy Prices, env wiring already in
  `config/index.ts`) owns price updates.
- **TVL itself is computed at GraphQL query time**: consumers select
  `Dao { assets { amount, token { priceUsd } } }` and sum
  `amount × priceUsd` client-side. No materialised `Dao.tvlUSD` field
  needed; matches the column-oriented HyperIndex model.
- **What still needs building (out of scope for indexer):** the price
  enrichment service. See the `enrichment-service` skill.

### 15. DAO parent/child linking — **not in legacy main, closed**
- Earlier gap docs cited `PARENT_TO_SUB_DAO_ACKNOWLEDGEMENT_PERMISSION_ID`
  / `SUB_DAO_TO_PARENT_ACKNOWLEDGEMENT_PERMISSION_ID` constants in
  legacy. Verified against `app-backend/main` (commit `ef5c65d8`,
  v0.23.1) — neither constant nor any linkedAccount / parentAccount
  field exists. The feature was apparently never merged.
- **No code change required.** If sub-DAO hierarchies become a real
  product requirement, design them as a `DaoLink` entity at that point
  (mirrors the `PluginParentLink` pattern from P0 #2).

### 16. Plugin slug generation
- **Legacy:** `PluginSlug.generateSlug()` produces stable, human-
  readable URL slugs per `(daoAddress, pluginAddress)` pair.
- **New indexer:** absent.
- **Fix:** small utility in `utils/plugin.ts`; add `Plugin.slug` to
  schema; populate in `services/pluginInstall.ts`.
- **Why:** clean URLs are an application concern but the indexer is the
  natural place to compute them once.

### 17. Plugin lifecycle flags (`isProcess` / `isBody` / `isPolicy`)
- **Legacy:** classifies plugins into the SPP architecture roles
  (process, body, sub-plugin, policy).
- **New indexer:** only `interfaceType` exists. The roles are
  derivable but not stored.
- **Fix:** schema additions + derivation in
  `services/pluginInstall.ts:stubPluginOnInstallPrepared` based on
  `interfaceType` + presence of `parentPluginAddress`.
- **Why:** UI needs role classification to render plugin cards
  consistently.

### 18. VE escrow settings on `PluginSetting`
- **Legacy:** stores `minDeposit`, `minLockTime`, `cooldown`, `maxTime`,
  `slope`, `bias`, `feePercent`, `minFeePercent`, `feeType`, `minCooldown`
  on the LockToVote settings entry.
- **New indexer:** the LockToVote settings handler stores the basic
  fields; the VE-specific extras are not fetched.
- **Fix:** in `handlers/LockToVote.ts:LockToVoteSettingsUpdated`, after
  computing the base settings, call a new
  `effects/escrowSettings.ts` to read the parameters via RPC and add
  them to `PluginSetting`.
- **Why:** LockToVote frontends need the lock parameters to render
  the lock UI correctly.

### 19. LockToVote `approvalThreshold` field on `PluginSetting`
- **Legacy:** persists this LockToVote-specific extra setting.
- **New indexer:** missing from schema.
- **Fix:** add column + populate from the existing settings event.
- **Why:** LockToVote approval ratios cannot be displayed.

### 20. Policy / Router plugin settings — **not in legacy main, closed**
- Earlier gap docs cited Router/Claimer policy handlers in legacy.
  Verified against `app-backend/main` (commit `ef5c65d8`, v0.23.1) —
  no `policyHandler.ts`, no `PolicySet` / `VaultSet` /
  `SourceSettingsUpdated` event subscriptions, no `policyId` /
  `strategyType` / `subRouters` field implementations exist. The only
  hits for "router" in legacy `src/` are tRPC HTTP-API routers,
  unrelated to on-chain Router plugins.
- **No code change required.** When Router/Claimer plugins ship, design
  the settings shape at that point.

### 21. Plugin update model — **decided: in-place + PluginSetupLog audit trail**
- **Legacy:** UpdateApplied creates a NEW `Plugin` doc at the new
  (release, build), marks previous `Deprecated`, inherits tokenAddress
  etc. Two rows share the same address but differ on build.
- **New indexer:** in-place update — `Plugin.id = (chainId, address)`,
  status flips to `Updated` on UpdateApplied. Build / release fields
  on the live row reflect the latest version.
- **Decision rationale:** every other entity (`Proposal`, `Vote`,
  `PluginMember`, `PluginSetting`, `PluginParentLink`, ...) references
  `Plugin` via `plugin_id`. Legacy's "new row per version" model
  requires those references to know about versions too. In-place keeps
  references stable; full version history is preserved in
  `PluginSetupLog` (one row per Prepared/Applied event with
  release/build/permissions). Consumers reconstruct "which version
  applied at block N" by walking `PluginSetupLog` entries for that
  plugin in block order.
- **No code change required.** PluginSetupLog already records the
  versioning history we'd otherwise duplicate on the Plugin row.

---

### 22. Multi-chain action-decoder explorer router — **schema ready, code pending**
- **Legacy:** `helpers/evmExplorerClient.ts` routes `fetchContractSourceCode`
  per chain — Etherscan v2 for most, Routescan for Avalanche, zkSync's
  own block-explorer API for zkSync, Blockscout for Citrea, Subscan for
  Peaq. The proposal-action decoder calls into this per-chain router.
- **New indexer:** `helpers/actionDecoder.ts` calls Etherscan v2 only.
  Until a multi-chain router lands, action decoding on Avalanche / zkSync
  / Citrea / Peaq falls straight to the 4byte signature lookup (worse
  decoding — function name only, no parameter shapes / NatSpec).
- **Why it doesn't bite today:** only Ethereum mainnet is enabled in
  `config.yaml`. As soon as any other chain is uncommented, the
  degradation kicks in.
- **Fix:** new `helpers/explorerRouter.ts` mirroring legacy's
  `EvmExplorerClient.configs[]` map (Etherscan / Routescan / zkSync /
  Blockscout / Subscan), routed by chainId. `actionDecoder.ts:fetchEtherscanSource`
  becomes `fetchExplorerSource(address, chainId)` and dispatches via the
  router. The env vars for all five backends are already wired in
  `config/index.ts` and documented in `.env.example` — only the router
  itself needs writing.
- **Severity:** P1 once second chain is enabled; P3 today.

## Out of scope (Phase 3 / 4)

These were on prior gap docs but are deferred until Phase 3/4 ships:
- Capital Distribution: `CampaignReward`, `CampaignMerkleRoot`,
  per-campaign reward aggregation, allocation-strategy crawling.
- Gauge analytics: `GaugeMetrics` per-epoch aggregation, gauge epoch
  cycle entity.
- Async post-install enrichment queues (HyperIndex is synchronous; no
  equivalent needed).
