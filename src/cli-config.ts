import type { Result } from "./result.js";
import type { CLIConfig, ConfigError } from "./types.js";
import { ok, err } from "./result.js";
import { extractBroadcastId } from "./broadcast-resolver.js";
import { createLogger } from "./logger.js";

const logger = createLogger("CLI");

const USAGE = "使い方: x-live-to-wancome [broadcast-url] [--service-name <名前>] [--service-id <id>] [--host <host>] [--port <port>] [--viewer-port <port>] [--interval <ms>]";

/**
 * process.argvをパースしてCLIConfigを返す。
 *
 * 使い方:
 *   x-live-to-wancome [broadcast-url] [--service-name <名前>] [--service-id <id>] [--host <host>] [--port <port>] [--viewer-port <port>] [--interval <ms>]
 */
export function parseArgs(argv: string[]): Result<CLIConfig, ConfigError> {
  // node, scriptを除いた引数
  const args = argv.slice(2);

  let broadcastUrl: string | undefined;
  let serviceId: string | undefined;
  let serviceName: string | undefined;
  let host = "localhost";
  let port = 11180;
  let interval = 3000;
  let viewerPort = 11190;

  let portRaw: string | undefined;
  let viewerPortRaw: string | undefined;

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--service-id" && i + 1 < args.length) {
      serviceId = args[++i];
    } else if (arg === "--service-name" && i + 1 < args.length) {
      serviceName = args[++i];
    } else if (arg === "--host" && i + 1 < args.length) {
      host = args[++i];
    } else if (arg === "--port" && i + 1 < args.length) {
      portRaw = args[++i];
    } else if (arg === "--viewer-port" && i + 1 < args.length) {
      viewerPortRaw = args[++i];
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

  // --service-id と --service-name の排他バリデーション
  if (serviceId !== undefined && serviceName !== undefined) {
    return err({ kind: "conflicting_service_options" });
  }

  // broadcastUrl指定時のみURL形式バリデーション
  if (broadcastUrl !== undefined) {
    const idResult = extractBroadcastId(broadcastUrl);
    if (!idResult.ok) {
      return err({ kind: "invalid_url", url: broadcastUrl });
    }
  }

  // ポートバリデーション
  if (portRaw !== undefined) {
    const parsed = Number(portRaw);
    if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return err({ kind: "invalid_port", port: portRaw });
    }
    port = parsed;
  }

  // viewer-portバリデーション
  if (viewerPortRaw !== undefined) {
    const parsed = Number(viewerPortRaw);
    if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 1 || parsed > 65535) {
      return err({ kind: "invalid_viewer_port", port: viewerPortRaw });
    }
    viewerPort = parsed;
  }

  // serviceTarget: 未指定時にデフォルト --service-name=X を適用
  const config: CLIConfig = {
    broadcastUrl,
    oneCommeHost: host,
    oneCommePort: port,
    serviceTarget: serviceId !== undefined
      ? { kind: "id", serviceId }
      : { kind: "name", serviceName: serviceName ?? "X" },
    pollIntervalMs: interval,
    viewerCountPort: viewerPort,
  };

  return ok(config);
}

/** 起動時に設定値をログ出力する */
export function logConfig(config: CLIConfig, resolvedServiceId?: string): void {
  const serviceInfo = config.serviceTarget.kind === "name"
    ? { serviceName: config.serviceTarget.serviceName, resolvedServiceId }
    : { serviceId: config.serviceTarget.serviceId };

  logger.info("設定値:", {
    broadcastUrl: config.broadcastUrl ?? "(自動取得)",
    oneCommeHost: config.oneCommeHost,
    oneCommePort: config.oneCommePort,
    ...serviceInfo,
    pollIntervalMs: config.pollIntervalMs,
    viewerCountPort: config.viewerCountPort,
  });
}

/** ConfigErrorをユーザー向けエラーメッセージに変換する */
export function formatConfigError(error: ConfigError): string {
  switch (error.kind) {
    case "conflicting_service_options":
      return `エラー: --service-name と --service-id は同時に指定できません。いずれか一方のみ指定してください。\n${USAGE}`;
    case "invalid_url":
      return `エラー: 無効なブロードキャストURL形式です: ${error.url}\n対応形式: https://x.com/i/broadcasts/{id} または直接ブロードキャストID`;
    case "invalid_port":
      return `エラー: 無効なポート番号です: ${error.port}\n1〜65535の整数を指定してください。`;
    case "invalid_viewer_port":
      return `エラー: 無効な視聴者数サーバーポート番号です: ${error.port}\n1〜65535の整数を指定してください。`;
  }
}
