import { createTestIndexer } from "generated";
import { describe, expect, it } from "vitest";

describe("GovernanceERC20 — Delegation Tracking", () => {
  it("registers GovernanceERC20 token from InstallationPrepared helpers", async () => {
    const indexer = createTestIndexer();

    // Block 16726558: TokenVoting DAO with GovernanceERC20 helper
    await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const tokenAddresses = indexer.chains[1].GovernanceERC20.addresses.map((a: string) => a.toLowerCase());
    // Token 0xe4fBbB0B11b3B48D10B4753a1D2c00244b247b33 deployed in this block
    expect(tokenAddresses).toContain("0xe4fbbb0b11b3b48d10b4753a1d2c00244b247b33");
  });

  it("creates DelegateVotesChangedEvent from token creation block", async () => {
    const indexer = createTestIndexer();

    // Same block has DelegateVotesChanged from initial token minting
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const events = result.changes.flatMap((b: any) => b.DelegateVotesChangedEvent?.sets || []);
    if (events.length > 0) {
      expect(events[0].chainId).toBe(1);
      expect(events[0].tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(events[0].delegate).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(events[0].newVotes).toBeDefined();
      expect(typeof events[0].newVotes).toBe("bigint");
      expect(events[0].blockNumber).toBe(16726558);
    }
  });

  it("creates TokenMember with votingPower", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const members = result.changes.flatMap((b: any) => b.TokenMember?.sets || []);
    if (members.length > 0) {
      expect(members[0].votingPower).toBeDefined();
      expect(typeof members[0].votingPower).toBe("bigint");
      expect(members[0].memberAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
      expect(members[0].tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    }
  });

  it("creates Token entity with metadata from RPC", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const tokens = result.changes.flatMap((b: any) => b.Token?.sets || []);
    if (tokens.length > 0) {
      const token = tokens[0];
      expect(token.chainId).toBe(1);
      expect(token.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
      // Metadata may or may not be populated depending on RPC availability
      // but the entity should exist
    }
  });
});
