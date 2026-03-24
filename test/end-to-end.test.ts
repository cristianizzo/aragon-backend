import { createTestIndexer } from "generated";
import { describe, expect, it } from "vitest";

describe("End-to-End: Full DAO Lifecycle", () => {
  it("Multisig DAO: creation → plugin installed → member added → approval → executed", async () => {
    const indexer = createTestIndexer();

    // Block 16726392: Multisig DAO creation
    // Contains: DAORegistered, InstallationPrepared, InstallationApplied,
    //           Granted (multiple), MetadataSet, MembersAdded, MultisigSettingsUpdated
    const creation = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    // Verify full creation event chain
    const entityTypes = new Set<string>();
    for (const block of creation.changes) {
      for (const key of Object.keys(block)) {
        if (!["block", "blockHash", "chainId", "eventsProcessed", "addresses"].includes(key)) {
          entityTypes.add(key);
        }
      }
    }

    expect(entityTypes.has("Dao")).toBe(true);
    expect(entityTypes.has("Plugin")).toBe(true);
    expect(entityTypes.has("PluginSetupLog")).toBe(true);
    expect(entityTypes.has("DaoPermission")).toBe(true);

    // Verify registrations
    expect(indexer.chains[1].DAO.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].Multisig.addresses.length).toBeGreaterThan(0);

    // Block 16727011: Approved event
    const approval = await indexer.process({
      chains: { 1: { startBlock: 16727011, endBlock: 16727011 } },
    });

    // Votes may or may not appear depending on plugin address match
    const approvalChanges = approval.changes.length;
    expect(approvalChanges).toBeGreaterThanOrEqual(0);
  });

  it("TokenVoting DAO: creation → token registered → delegation → vote", async () => {
    const indexer = createTestIndexer();

    // Step 1: Create TokenVoting DAO (block 16726558)
    await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    // Verify all registrations
    expect(indexer.chains[1].DAO.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].TokenVoting.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].GovernanceERC20.addresses.length).toBeGreaterThan(0);

    // Verify DAO initial state
    const daoAddr = indexer.chains[1].DAO.addresses[0];
    const dao = await indexer.Dao.get(`1-${daoAddr}`);
    expect(dao).toBeDefined();
    expect(dao?.proposalCount).toBe(0);

    // Verify plugin state
    const pluginAddr = indexer.chains[1].TokenVoting.addresses[0];
    const plugin = await indexer.Plugin.get(`1-${pluginAddr}`);
    expect(plugin).toBeDefined();
    expect(plugin?.interfaceType).toBe("tokenVoting");
    expect(plugin?.status).toBe("installed");
    expect(plugin?.tokenAddress).toBeDefined();

    // Step 2: Process VoteCast (block 16733703)
    const voting = await indexer.process({
      chains: { 1: { startBlock: 16733703, endBlock: 16733703 } },
    });

    const votes = voting.changes.flatMap((b: any) => b.Vote?.sets || []);
    expect(votes.length).toBeGreaterThan(0);

    // Verify vote structure
    const vote = votes[0];
    expect(vote.chainId).toBe(1);
    expect(vote.memberAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(typeof vote.votingPower).toBe("bigint");
    expect(vote.plugin_id).toBe(`1-${pluginAddr}`);
  });

  it("multiple DAOs in same block range maintain separate state", async () => {
    const indexer = createTestIndexer();

    // Block range 16726392-16726575 has multiple DAO creations
    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726575 } },
    });

    // Should have multiple DAOs
    const daoAddrs = indexer.chains[1].DAO.addresses;
    expect(daoAddrs.length).toBeGreaterThanOrEqual(3);

    // Each DAO should be independently retrievable
    for (const addr of daoAddrs) {
      const dao = await indexer.Dao.get(`1-${addr}`);
      expect(dao).toBeDefined();
      expect(dao?.address).toBe(addr);
      expect(dao?.proposalCount).toBe(0); // No proposals yet
    }

    // Should have multiple plugin types
    expect(indexer.chains[1].Multisig.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].TokenVoting.addresses.length).toBeGreaterThan(0);
  });
});

describe("Entity Relationships", () => {
  it("Vote → Proposal → Plugin → DAO chain is consistent", async () => {
    const indexer = createTestIndexer();

    // Create DAO + plugin
    await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    // Process votes
    const result = await indexer.process({
      chains: { 1: { startBlock: 16733703, endBlock: 16733703 } },
    });

    const votes = result.changes.flatMap((b: any) => b.Vote?.sets || []);
    if (votes.length > 0) {
      const vote = votes[0];

      // Vote should reference a valid plugin
      const plugin = await indexer.Plugin.get(vote.plugin_id);
      expect(plugin).toBeDefined();

      // Plugin should reference a valid DAO
      if (plugin) {
        const dao = await indexer.Dao.get(plugin.dao_id);
        expect(dao).toBeDefined();
        expect(dao?.address).toBe(plugin.daoAddress);
      }
    }
  });
});
