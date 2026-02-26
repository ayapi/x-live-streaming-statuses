import type { Result } from "./result.js";
import type { CLIConfig, ConfigError } from "./types.js";
import { ok, err } from "./result.js";
import { extractBroadcastId } from "./broadcast-resolver.js";
import { createLogger } from "./logger.js";

const logger = createLogger("CLI");

/**
 * process.argvをパースしてCLIConfigを返す。
 *
 * 使い方:
 *   x-live-to-wancome <broadcast-url> --service-id <id> [--host <host>] [--port <port>] [--interval <ms>]
 */
export function parseArgs(argv: string[]): Result<CLIConfig, ConfigError> {
  // node, scriptを除いた引数
  const args = argv.slice(2);

  let broadcastUrl: string | undefined;
  let serviceId: string | undefined;
  let host = "localhost";
  let port = 11180;
  let interval = 3000;

  let portRaw: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--service-id" && i + 1 < args.length) {
      serviceId = args[++i];
    } else if (arg === "--host" && i + 1 < args.length) {
      host = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      portRaw = args[++i];
    } else if (arg === "--interval" && i + 1 < args.length) {
      const val = Number(args[++i]);
      if (!Number.isNaN(val) && val > 0) {
        interval = val;
      }
    } else if (!arg.startsWith("--")) {
      // positional argument = broadcast URL or ID
      broadcastUrl = arg;
    }
  }

  // --- Validation ---

  if (broadcastUrl === undefined) {
    return err({ kind: "missing_broadcast_url" });
  }

  if (serviceId === undefined) {
    return err({ kind: "missing_service_id" });
  }

  // URL形式バリデーション（BroadcastResolverのextractBroadcastIdを再利用）
  const idResult = extractBroadcastId(broadcastUrl);
  if (!idResult.ok) {
    return err({ kind: "invalid_url", url: broadcastUrl });
  }

  // ポートバリデーション
  if (portRaw !== undefined) {
    const parsed = Number(portRaw);
    if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return err({ kind: "invalid_port", port: portRaw });
    }
    port = parsed;
  }

  const config: CLIConfig = {
    broadcastUrl,
    oneCommeHost: host,
    oneCommePort: port,
    oneCommeServiceId: serviceId,
    pollIntervalMs: interval,
  };

  return ok(config);
}

/** 起動時に設定値をログ出力する */
export function logConfig(config: CLIConfig): void {
  logger.info("設定値:", {
    broadcastUrl: config.broadcastUrl,
    oneCommeHost: config.oneCommeHost,
    oneCommePort: config.oneCommePort,
    oneCommeServiceId: config.oneCommeServiceId,
    pollIntervalMs: config.pollIntervalMs,
  });
}

/** ConfigErrorをユーザー向けエラーメッセージに変換する */
export function formatConfigError(error: ConfigError): string {
  switch (error.kind) {
    case "missing_broadcast_url":
      return "エラー: ブロードキャストURLが指定されていません。\n使い方: x-live-to-wancome <broadcast-url> --service-id <id> [--host <host>] [--port <port>] [--interval <ms>]";
    case "missing_service_id":
      return "エラー: わんコメの枠ID（--service-id）が指定されていません。\n使い方: x-live-to-wancome <broadcast-url> --service-id <id> [--host <host>] [--port <port>] [--interval <ms>]";
    case "invalid_url":
      return `エラー: 無効なブロードキャストURL形式です: ${error.url}\n対応形式: https://x.com/i/broadcasts/{id} または直接ブロードキャストID`;
    case "invalid_port":
      return `エラー: 無効なポート番号です: ${error.port}\n1〜65535の整数を指定してください。`;
  }
}
