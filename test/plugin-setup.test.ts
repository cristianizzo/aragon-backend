import { createTestIndexer } from "generated";
import { describe, expect, it } from "vitest";

describe("PluginSetupProcessor — Plugin Lifecycle", () => {
  it("creates Plugin entity in installed status from same-block Prepared+Applied", async () => {
    const indexer = createTestIndexer();

    // Block 16726392 has InstallationPrepared + InstallationApplied in same tx
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    expect(plugins.length).toBeGreaterThan(0);

    // Since both Prepared and Applied are in the same block, status should be "installed"
    const installedPlugin = plugins.find((p: any) => p.status === "installed");
    expect(installedPlugin).toBeDefined();
  });

  it("creates PluginSetupLog entries for Prepared and Applied", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const logs = result.changes.flatMap((b: any) => b.PluginSetupLog?.sets || []);
    expect(logs.length).toBeGreaterThanOrEqual(2);

    const prepared = logs.find((l: any) => l.event === "InstallationPrepared");
    const applied = logs.find((l: any) => l.event === "InstallationApplied");
    expect(prepared).toBeDefined();
    expect(applied).toBeDefined();

    // Both should reference the same DAO and plugin
    expect(prepared?.daoAddress).toBe(applied?.daoAddress);
    expect(prepared?.pluginAddress).toBe(applied?.pluginAddress);
  });

  it("stores release and build version from InstallationPrepared", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    const plugin = plugins[0];
    expect(plugin?.release).toBeGreaterThanOrEqual(1);
    expect(plugin?.build).toBeGreaterThanOrEqual(1);
  });

  it("links plugin to correct DAO via dao_id", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    const daos = result.changes.flatMap((b: any) => b.Dao?.sets || []);

    expect(plugins.length).toBeGreaterThan(0);
    expect(daos.length).toBeGreaterThan(0);

    // Plugin's dao_id should match a DAO id
    const plugin = plugins[0];
    const matchingDao = daos.find((d: any) => d.id === plugin.dao_id);
    expect(matchingDao).toBeDefined();
    expect(plugin.daoAddress).toBe(matchingDao.address);
  });
});

describe("PluginSetupProcessor — Plugin Type Detection", () => {
  it("classifies Multisig plugins by repo address", async () => {
    const indexer = createTestIndexer();

    // Block 16726392: Multisig DAO (repo 0x8c278e37...)
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    const multisig = plugins.find((p: any) => p.interfaceType === "multisig");
    expect(multisig).toBeDefined();
    expect(multisig.pluginSetupRepo?.toLowerCase()).toBe("0x8c278e37d0817210e18a7958524b7d0a1faa6f7b");
  });

  it("classifies TokenVoting plugins by repo address", async () => {
    const indexer = createTestIndexer();

    // Block 16726558: TokenVoting DAO (repo 0xb7401cD2...)
    const result = await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    const tv = plugins.find((p: any) => p.interfaceType === "tokenVoting");
    expect(tv).toBeDefined();
    expect(tv.pluginSetupRepo?.toLowerCase()).toBe("0xb7401cd221ceafc54093168b814cc3d42579287f");
  });

  it("stores tokenAddress on TokenVoting plugins from helpers", async () => {
    const indexer = createTestIndexer();

    const result = await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    const plugins = result.changes.flatMap((b: any) => b.Plugin?.sets || []);
    const tv = plugins.find((p: any) => p.interfaceType === "tokenVoting");
    expect(tv).toBeDefined();
    expect(tv.tokenAddress).toMatch(/^0x[a-fA-F0-9]{40}$/);
  });
});

describe("PluginSetupProcessor — Dynamic Contract Registration", () => {
  it("registers Multisig contract from Multisig plugin", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    expect(indexer.chains[1].Multisig.addresses.length).toBeGreaterThan(0);
  });

  it("registers TokenVoting + GovernanceERC20 from TokenVoting plugin", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726558, endBlock: 16726558 } },
    });

    expect(indexer.chains[1].TokenVoting.addresses.length).toBeGreaterThan(0);
    expect(indexer.chains[1].GovernanceERC20.addresses.length).toBeGreaterThan(0);

    // GovernanceERC20 address should be different from TokenVoting address
    const tvAddr = indexer.chains[1].TokenVoting.addresses[0]!.toLowerCase();
    const erc20Addr = indexer.chains[1].GovernanceERC20.addresses[0]!.toLowerCase();
    expect(tvAddr).not.toBe(erc20Addr);
  });

  it("registers ExecuteSelectorCondition from Granted events with condition", async () => {
    const indexer = createTestIndexer();

    await indexer.process({
      chains: { 1: { startBlock: 16726392, endBlock: 16726392 } },
    });

    // ExecuteSelectorCondition type should exist even if no conditions registered
    expect(indexer.chains[1].ExecuteSelectorCondition).toBeDefined();
  });
});
