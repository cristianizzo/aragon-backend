/**
 * Application logger. Console transport is always on; logz.io transport is
 * activated only when `LOGZIO_KEY` is set in the environment. URL API keys
 * (Alchemy / dRPC / Ankr) are scrubbed before any payload leaves the process.
 *
 * Mirrors the API of the legacy `app-backend/src/logger`:
 *
 *   const llo = logger.logMeta.bind(null, { service: "handlers:DAO" });
 *   logger.info("DAO registered", llo({ daoAddress, chainId }));
 *   logger.error("RPC failed", llo({ chainId, error }));
 */

import os from "node:os";
import process from "node:process";
import logzio from "logzio-nodejs";
import * as winston from "winston";
import Transport from "winston-transport";
import { config } from "../config";
import { redactPayload, redactUrlKeys } from "./loggerRedact";

const MACHINE = {
  hostname: os.hostname(),
  platform: process.platform,
  pid: process.pid,
};

interface LogInfo {
  level: string;
  message: unknown;
  timestamp?: string;
  error?: unknown;
  [key: string]: unknown;
}

/**
 * JSON.stringify with circular-reference safety. Returns the serialised string;
 * any field that would have caused a cycle is replaced with `"[Circular]"`.
 */
function stringifyCircular(value: unknown): string {
  const seen = new WeakSet<object>();
  return JSON.stringify(value, (_key, val) => {
    if (val instanceof Error) {
      return {
        name: val.name,
        message: val.message,
        stack: val.stack,
        ...(val as unknown as Record<string, unknown>),
      };
    }
    if (typeof val === "bigint") return val.toString();
    if (val !== null && typeof val === "object") {
      if (seen.has(val as object)) return "[Circular]";
      seen.add(val as object);
    }
    return val;
  });
}

/**
 * Recursively unwrap nested `error` chains into flat `errorCode`/`errorStack`/
 * `errorMessage` fields so logz.io receives consistent shape regardless of
 * how deep the cause chain runs.
 */
function flattenError(info: LogInfo): LogInfo {
  if (!(info.error instanceof Error)) return info;
  const err = info.error as Error & { code?: unknown; error?: unknown };
  info.errorCode = err.code;
  info.errorStack = err.stack;
  info.errorMessage = err.message;
  if (err.error instanceof Error) {
    info.errorDeep = flattenError({ level: info.level, message: "", error: err.error });
  }
  return info;
}

// --- logz.io transport -------------------------------------------------------

class LogzioTransport extends Transport {
  private readonly client: ReturnType<typeof logzio.createLogger>;

  constructor(opts: Transport.TransportStreamOptions) {
    super(opts);
    this.client = logzio.createLogger({
      token: config.LOG.LOGZIO_KEY,
      host: config.LOG.LOGZIO_HOST,
      type: config.LOG.LOGZIO_TYPE,
      protocol: "https",
    });
  }

  override log(info: LogInfo, callback: () => void): void {
    try {
      const payload = {
        ...flattenError({ ...info }),
        machine: MACHINE,
        environment: config.LOG.ENVIRONMENT,
        tags: [config.LOG.LOGZIO_TYPE],
      };
      const serialised = JSON.parse(stringifyCircular(payload)) as object;
      redactPayload(serialised);
      this.client.log(serialised);
    } catch {
      // Never let a logging failure propagate.
    } finally {
      callback();
    }
  }
}

// --- Console transport -------------------------------------------------------

const consoleFormat = winston.format.printf((info) => {
  const { level, message, timestamp, ...rest } = info as LogInfo;
  const detail = Object.keys(rest).length > 0 ? `\nDetail: ${redactUrlKeys(stringifyCircular(rest))}` : "";
  return `${timestamp} [${level}] ${message as string}${detail}`;
});

const consoleTransport = new winston.transports.Console({
  level: config.LOG.LEVEL,
  format: winston.format.combine(winston.format.timestamp(), winston.format.colorize({ all: true }), consoleFormat),
});

// --- Logger ------------------------------------------------------------------

const transports: Transport[] = [consoleTransport];
if (config.LOG.LOGZIO_KEY) {
  transports.push(new LogzioTransport({ level: config.LOG.LEVEL }));
}

interface AppLogger extends winston.Logger {
  logMeta: (...metas: object[]) => object;
}

const winstonLogger = winston.createLogger({
  level: config.LOG.LEVEL,
  transports,
}) as AppLogger;

/**
 * Merge multiple metadata objects into one. Used to layer scoped metadata —
 * typically `bind(null, { service: "..." })` at module top, then per-call
 * context inside handlers.
 */
winstonLogger.logMeta = (...metas: object[]): object => Object.assign({}, ...metas);

export default winstonLogger;
