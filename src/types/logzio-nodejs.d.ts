declare module "logzio-nodejs" {
  export interface LogzioConfig {
    token: string;
    host?: string;
    type?: string;
    protocol?: "http" | "https";
  }

  export interface LogzioLogger {
    log(payload: object): void;
    sendAndClose(): void;
  }

  export function createLogger(config: LogzioConfig): LogzioLogger;

  const _default: { createLogger: typeof createLogger };
  export default _default;
}
