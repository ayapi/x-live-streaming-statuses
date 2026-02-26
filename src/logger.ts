export interface Logger {
  info(message: string, data?: Record<string, unknown>): void;
  warn(message: string, data?: Record<string, unknown>): void;
  error(message: string, data?: Record<string, unknown>): void;
  debug(message: string, data?: Record<string, unknown>): void;
}

type LogLevel = "INFO" | "WARN" | "ERROR" | "DEBUG";

function formatLog(
  level: LogLevel,
  component: string,
  message: string,
  data?: Record<string, unknown>,
): string {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level}] [${component}] ${message}`;
  if (data !== undefined) {
    return `${base} ${JSON.stringify(data)}`;
  }
  return base;
}

/** コンポーネント名付き構造化ロガーを生成する */
export function createLogger(component: string): Logger {
  return {
    info(message: string, data?: Record<string, unknown>): void {
      console.log(formatLog("INFO", component, message, data));
    },
    warn(message: string, data?: Record<string, unknown>): void {
      console.warn(formatLog("WARN", component, message, data));
    },
    error(message: string, data?: Record<string, unknown>): void {
      console.error(formatLog("ERROR", component, message, data));
    },
    debug(message: string, data?: Record<string, unknown>): void {
      console.log(formatLog("DEBUG", component, message, data));
    },
  };
}
