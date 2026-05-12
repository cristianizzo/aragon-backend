import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "vitest/config";

/**
 * Vitest forks a worker per test file by default, and worker processes do
 * NOT inherit `process.env` mutations from this config file — they only
 * inherit the parent shell's env. So we read `.env` here and propagate
 * the keys via vitest's `test.env` option, which IS forwarded to workers.
 *
 * This makes integration tests use the real DRPC/Alchemy keys instead of
 * the public-node fallback (which throttles `getCode` and breaks the
 * bytecode-driven plugin-type detection). Tests still exercise the live
 * production code path — no mocking, no stubbing.
 */
function loadDotenv(path: string): Record<string, string> {
  const env: Record<string, string> = {};
  let raw: string;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    return env;
  }
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 0) continue;
    const key = trimmed.slice(0, eq).trim();
    if (!key) continue;
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    env[key] = value;
  }
  return env;
}

const dotenv = loadDotenv(resolve(__dirname, ".env"));

export default defineConfig({
  test: {
    testTimeout: 60_000,
    // `env` is forwarded to worker processes — `process.env` mutations are not.
    // Shell env wins (already-set vars take precedence over .env values).
    env: { ...dotenv, ...process.env },
  },
});
