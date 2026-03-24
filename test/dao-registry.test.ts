import { createTestIndexer } from "generated";
import { describe, expect, it } from "vitest";

// Block 16726392: First Multisig DAO creation on Ethereum mainnet
// Block 16726558: First TokenVoting DAO creation
// Block 16721812-16721885: Aragon initial deployment (PluginRepos)

describe("DAORegistry — DAO Creation", () => {
  it("creates a DAO entity with correct fields from DAORegistered", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const daoSets = result.changes.flatMap((b: any) => b.Dao?.sets || []);
    expect(daoSets.length).toBeGreaterThan(0);

    const dao = daoSets[0];
    expect(dao.chainId).toBe(1);
    expect(dao.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(dao.creatorAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(dao.blockNumber).toBe(16726392);
    expect(dao.transactionHash).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(dao.proposalCount).toBe(0);
    expect(dao.proposalsExecuted).toBe(0);
    expect(dao.uniqueVoters).toBe(0);
    expect(dao.voteCount).toBe(0);
    expect(dao.memberCount).toBe(0);
  });

  it("registers DAO address for dynamic event tracking", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    expect(indexer.chains[1].DAO.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].DAO.addresses[0]).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });

  it("DAO entity can be looked up after creation", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    // Verify entity persists and is retrievable
    const daoAddress = indexer.chains[1].DAO.addresses[0];
    const dao = await indexer.Dao.get(`1-${daoAddress}`);
    expect(dao).toBeDefined();
    expect(dao?.proposalCount).toBe(0);
    expect(dao?.memberCount).toBeGreaterThanOrEqual(0);
  });

  it("handles multiple DAO creations in a block range", async () => {
    const indexer = createTestIndexer();

    // Block range 16726392-16726575 has multiple DAOs created
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726575 } },
    });

    const daoSets = result.changes.flatMap((b: any) => b.Dao?.sets || []);
    expect(daoSets.length).toBeGreaterThanOrEqual(3);

    // All should have unique IDs
    const ids = daoSets.map((d: any) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("DAORegistry — DAO Entity Lookup", () => {
  it("can retrieve created DAO by ID", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const daoAddress = indexer.chains[1].DAO.addresses[0];
    const daoId = `1-${daoAddress}`;
    const dao = await indexer.Dao.get(daoId);

    expect(dao).toBeDefined();
    expect(dao?.chainId).toBe(1);
    expect(dao?.address).toBe(daoAddress);
  });
});
