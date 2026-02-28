#!/usr/bin/env node

import { parseArgs, formatConfigError, logConfig } from "./cli-config.js";
import { createBroadcastResolver } from "./broadcast-resolver.js";
import { createTokenProvider } from "./token-provider.js";
import { createChatPoller } from "./chat-poller.js";
import { createMessageParser } from "./message-parser.js";
import { createDuplicateFilter } from "./duplicate-filter.js";
import { createOneCommeClient } from "./onecomme-client.js";
import { createBufferedOneCommeClient } from "./buffered-onecomme-client.js";
import { createStatusMonitor } from "./status-monitor.js";
import { createViewerCountServer } from "./viewer-count-server.js";
import { createServiceResolver, formatServiceResolveError } from "./service-resolver.js";
import { createLogger } from "./logger.js";
import type { RawChatMessage } from "./types.js";

const logger = createLogger("Main");

async function main(): Promise<void> {
  // ── CLI引数の解析 ──
  const configResult = parseArgs(process.argv);
  if (!configResult.ok) {
    console.error(formatConfigError(configResult.error));
    process.exit(1);
  }
  const config = configResult.value;

  // ── サービスID解決 ──
  let serviceId: string;
  if (config.serviceTarget.kind === "name") {
    const resolver = createServiceResolver({
      host: config.oneCommeHost,
      port: config.oneCommePort,
    });
    const resolveResult = await resolver.resolve(config.serviceTarget.serviceName);
    if (!resolveResult.ok) {
      console.error(formatServiceResolveError(resolveResult.error));
      process.exit(1);
    }
    serviceId = resolveResult.value;
  } else {
    serviceId = config.serviceTarget.serviceId;
  }

  logConfig(config, serviceId);

  // ── ブロードキャスト解決 ──
  const resolver = createBroadcastResolver();
  const broadcastResult = await resolver.resolve(config.broadcastUrl);
  if (!broadcastResult.ok) {
    const e = broadcastResult.error;
    switch (e.kind) {
      case "invalid_url":
        logger.error(`無効なブロードキャストURL: ${e.url}`);
        break;
      case "not_found":
        logger.error(`配信が見つかりません: ${e.broadcastId}`);
        break;
      case "already_ended":
        logger.error(`配信は既に終了しています: ${e.broadcastId}`);
        break;
      case "api_error":
        logger.error(`APIエラー: ${e.status} ${e.message}`);
        break;
    }
    process.exit(1);
  }
  const broadcast = broadcastResult.value;

  // ── トークン取得 ──
  const tokenProvider = createTokenProvider();
  const tokenResult = await tokenProvider.acquire(broadcast.mediaKey);
  if (!tokenResult.ok) {
    const e = tokenResult.error;
    switch (e.kind) {
      case "stream_not_found":
        logger.error(`ストリームが見つかりません: ${e.mediaKey}`);
        break;
      case "stream_offline":
        logger.error("ストリームがオフラインです");
        break;
      case "chat_access_denied":
        logger.error("チャットへのアクセスが拒否されました");
        break;
      case "api_error":
        logger.error(`APIエラー: ${e.status} ${e.message}`);
        break;
    }
    process.exit(1);
  }
  let credentials = tokenResult.value;

  // ── コンポーネント初期化 ──
  const messageParser = createMessageParser();
  const duplicateFilter = createDuplicateFilter();
  const innerClient = createOneCommeClient({
    host: config.oneCommeHost,
    port: config.oneCommePort,
    serviceId,
    ownerUserId: broadcast.username,
  });
  const bufferedClient = createBufferedOneCommeClient(innerClient);
  const chatPoller = createChatPoller(undefined, {
    pollIntervalMs: config.pollIntervalMs,
  });
  const statusMonitor = createStatusMonitor();

  // ── 視聴者数サーバー ──
  const viewerCountServer = createViewerCountServer({
    port: config.viewerCountPort,
  });

  try {
    await viewerCountServer.start();
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    logger.error(`視聴者数サーバーの起動に失敗しました: ${message}`);
    process.exit(1);
  }

  // ── 統計 ──
  let totalComments = 0;
  let totalErrors = 0;

  // ── トークン期限切れハンドラ ──
  const handleTokenExpired = async (): Promise<void> => {
    logger.warn("トークンが無効です。再取得を試みます。");

    // まずリフレッシュを試行
    const refreshResult = await tokenProvider.refresh();
    if (refreshResult.ok) {
      credentials = refreshResult.value;
      chatPoller.stop();
      chatPoller.start(credentials, handleMessages, {
        onTokenExpired: () => { handleTokenExpired(); },
      });
      return;
    }

    // リフレッシュ失敗 → フルフロー再取得
    logger.warn("リフレッシュ失敗。フルフロー再取得を試みます。");
    const reacquireResult = await tokenProvider.acquire(broadcast.mediaKey);
    if (reacquireResult.ok) {
      credentials = reacquireResult.value;
      chatPoller.stop();
      chatPoller.start(credentials, handleMessages, {
        onTokenExpired: () => { handleTokenExpired(); },
      });
    } else {
      logger.error("トークン再取得に失敗しました。終了します。");
      await shutdown();
    }
  };

  // ── メッセージ処理ハンドラ ──
  const handleMessages = async (rawMessages: RawChatMessage[]): Promise<void> => {
    try {
      const parsed = messageParser.parse(rawMessages);

      for (const comment of parsed) {
        if (duplicateFilter.isDuplicate(comment.id)) {
          continue;
        }

        const result = await bufferedClient.send(comment);
        if (result.ok) {
          duplicateFilter.markSent(comment.id);
          totalComments++;
        } else {
          totalErrors++;
        }
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("メッセージ処理中に予期しないエラーが発生", { error: message });
      totalErrors++;
    }
  };

  // ── トークン有効期限の定期チェック（30秒間隔） ──
  const tokenCheckInterval = setInterval(async () => {
    if (tokenProvider.isExpiringSoon()) {
      logger.info("トークンの有効期限が近づいています。リフレッシュを開始します。");
      const refreshResult = await tokenProvider.refresh();
      if (refreshResult.ok) {
        credentials = refreshResult.value;
        chatPoller.stop();
        chatPoller.start(credentials, handleMessages, {
          onTokenExpired: () => { handleTokenExpired(); },
        });
      } else {
        logger.warn("プロアクティブトークンリフレッシュに失敗", {
          error: JSON.stringify(refreshResult.error),
        });
      }
    }
  }, 30_000);

  // ── わんコメ接続回復チェック（30秒間隔） ──
  const bufferRecoveryInterval = setInterval(async () => {
    if (!bufferedClient.isConnected()) {
      logger.info("わんコメへの接続を再試行しています...");
      await bufferedClient.flushBuffer();
    }
  }, 30_000);

  // ── 統計ログ出力（60秒間隔） ──
  const statsInterval = setInterval(() => {
    logger.info("動作状況", {
      totalComments,
      totalErrors,
      duplicateFilterSize: duplicateFilter.size(),
      bufferSize: bufferedClient.getBufferSize(),
      oneCommeConnected: bufferedClient.isConnected(),
    });
  }, 60_000);

  // ── クリーンアップ ──
  async function cleanup(): Promise<void> {
    chatPoller.stop();
    statusMonitor.stop();
    clearInterval(tokenCheckInterval);
    clearInterval(bufferRecoveryInterval);
    clearInterval(statsInterval);
    await viewerCountServer.stop();
  }

  // ── グレースフルシャットダウン ──
  let shuttingDown = false;

  async function shutdown(): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info("シャットダウン中...");
    await cleanup();

    // 未送信バッファのフラッシュ
    if (bufferedClient.getBufferSize() > 0) {
      logger.info("未送信バッファをフラッシュしています...", {
        bufferSize: bufferedClient.getBufferSize(),
      });
      await bufferedClient.flushBuffer();
    }

    // 最終統計
    logger.info("最終統計", {
      totalComments,
      totalErrors,
      duplicateFilterSize: duplicateFilter.size(),
    });

    process.exit(0);
  }

  process.on("SIGINT", () => { shutdown(); });
  process.on("SIGTERM", () => { shutdown(); });

  // ── チャットポーリング開始 ──
  chatPoller.start(credentials, handleMessages, {
    onTokenExpired: () => { handleTokenExpired(); },
  });

  // ── 配信状態監視開始 ──
  statusMonitor.start(broadcast.broadcastId, (state) => {
    if (state === "ENDED" || state === "TIMED_OUT") {
      logger.info(`配信が終了しました (${state})。シャットダウンを開始します。`);
      shutdown();
    }
  });

  logger.info("ブリッジを開始しました", {
    broadcast: broadcast.title,
    user: `@${broadcast.username}`,
    pollInterval: config.pollIntervalMs,
  });
}

// トップレベルエラーハンドラ
main().catch((e) => {
  const message = e instanceof Error ? e.message : String(e);
  logger.error(`予期しない致命的エラー: ${message}`);
  process.exit(1);
});
