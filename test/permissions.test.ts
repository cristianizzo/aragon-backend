import { createTestIndexer } from "generated";
import { describe, expect, it } from "vitest";

describe("DAO Permissions — Granted & Revoked", () => {
  it("creates DaoPermission entities from Granted events", async () => {
    const indexer = createTestIndexer();

    // Block 16726392 has Granted events from DAO creation
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const permissions = result.changes.flatMap((b: any) => b.DaoPermission?.sets || []);
    expect(permissions.length).toBeGreaterThan(0);

    const perm = permissions[0];
    expect(perm.chainId).toBe(1);
    expect(perm.event).toBe("Granted");
    expect(perm.permissionId).toMatch(/^0x[a-fA-F0-9]{64}$/);
    expect(perm.whoAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(perm.whereAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(perm.daoAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
    expect(perm.dao_id).toBeDefined();
  });

  it("links permissions to correct DAO", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const permissions = result.changes.flatMap((b: any) => b.DaoPermission?.sets || []);
    const daos = result.changes.flatMap((b: any) => b.Dao?.sets || []);

    if (permissions.length > 0 && daos.length > 0) {
      const perm = permissions[0];
      expect(perm.dao_id).toBe(daos[0].id);
    }
  });

  it("stores conditionAddress when present in Granted event", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const permissions = result.changes.flatMap((b: any) => b.DaoPermission?.sets || []);

    // Some Granted events have conditions, some don't
    // Just verify the field exists on all permissions
    for (const perm of permissions) {
      expect(perm).toHaveProperty("conditionAddress");
    }
  });
});

describe("PluginRepoRegistry", () => {
  it("creates PluginRepo entities with subdomain and address", async () => {
    const indexer = createTestIndexer();

    // Block range covering initial Aragon deployment
    const result = await indexer.process({
      chains: { 1: { startBlock: 16721812, endBlock: 16721885 } },
    });

    const repos = result.changes.flatMap((b: any) => b.PluginRepo?.sets || []);
    expect(repos.length).toBeGreaterThan(0);

    const repo = repos[0];
    expect(repo.chainId).toBe(1);
    expect(repo.subdomain).toBeDefined();
    expect(repo.subdomain.length).toBeGreaterThan(0);
    expect(repo.address).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});
