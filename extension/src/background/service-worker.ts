/** Service Worker: ビジネスロジック中枢 */

import { extractCurrentViewerCount } from "../viewer-count.js";
import { createBadgeController } from "../badge-controller.js";
import { createViewerCountClient } from "../viewer-count-client.js";
import { createSettingsStore } from "../settings.js";
import type {
  ServiceWorkerMessage,
  ExtensionSettings,
  SessionState,
  LiveViewersResponse,
} from "../types.js";
import { INITIAL_SESSION_STATE } from "../types.js";

const badge = createBadgeController();
const viewerCountClient = createViewerCountClient();
const settingsStore = createSettingsStore();

/** 現在のセッション状態（メモリ内キャッシュ） */
let sessionState: SessionState = { ...INITIAL_SESSION_STATE };
let currentSettings: ExtensionSettings | null = null;

/** セッション状態を保存する */
async function persistState(): Promise<void> {
  await settingsStore.saveSessionState(sessionState);
}

/** 設定を読み込む */
async function ensureSettings(): Promise<ExtensionSettings> {
  if (!currentSettings) {
    currentSettings = await settingsStore.loadSettings();
  }
  return currentSettings;
}

/** 視聴者数を処理する */
async function handleViewerCountUpdate(
  data: LiveViewersResponse,
): Promise<void> {
  console.log("[SW] VIEWER_COUNT_UPDATE received:", JSON.stringify(data));
  const count = extractCurrentViewerCount(data);
  if (count === null) return;

  console.log("[SW] 同時視聴者数:", count);
  sessionState.currentViewerCount = count;

  const settings = await ensureSettings();

  // CLIサーバーに送信
  const result = await viewerCountClient.sendViewerCount({
    host: settings.serverHost,
    port: settings.serverPort,
    viewerCount: count,
  });

  if (result.ok) {
    sessionState.lastError = null;
    await badge.showViewerCount(count, false);
  } else {
    const errorMsg =
      result.error.kind === "connection_refused"
        ? `接続拒否: ${result.error.message}`
        : result.error.kind === "api_error"
          ? `APIエラー: ${result.error.status}`
          : "タイムアウト";
    sessionState.lastError = errorMsg;
    await badge.showViewerCount(count, true);
  }

  await persistState();
}

/** ページ検出を処理する */
async function handlePageDetected(
  mediaKey: string,
  ownerId: string,
  tabId: number | undefined,
): Promise<void> {
  sessionState = {
    isActive: true,
    mediaKey,
    ownerId,
    currentViewerCount: null,
    lastError: null,
    activeTabId: tabId ?? null,
  };

  await persistState();
}

/** ページ離脱を処理する */
async function handlePageClosed(): Promise<void> {
  sessionState = { ...INITIAL_SESSION_STATE };
  await badge.clear();
  await persistState();
}

// ── イベントリスナー（トップレベルで同期的に登録） ──

/** メッセージハンドラ */
chrome.runtime.onMessage.addListener(
  (
    message: ServiceWorkerMessage,
    sender: chrome.runtime.MessageSender,
    sendResponse: (response?: unknown) => void,
  ) => {
    switch (message.type) {
      case "VIEWER_COUNT_UPDATE":
        handleViewerCountUpdate(message.data);
        break;

      case "PAGE_DETECTED":
        handlePageDetected(message.mediaKey, message.ownerId, sender.tab?.id);
        break;

      case "PAGE_CLOSED":
        handlePageClosed();
        break;

      case "GET_STATUS":
        sendResponse({
          type: "STATUS",
          isActive: sessionState.isActive,
          viewerCount: sessionState.currentViewerCount,
          lastError: sessionState.lastError,
        });
        return; // sendResponse を同期的に呼ぶため return
    }
  },
);

/** 設定変更の監視 */
settingsStore.onSettingsChanged((newSettings: ExtensionSettings) => {
  currentSettings = newSettings;
});

/** MAIN world Content Script のプログラム的登録 */
chrome.scripting
  .registerContentScripts([
    {
      id: "content-main-world",
      matches: ["https://studio.x.com/*"],
      js: ["content-main.js"],
      world: "MAIN" as chrome.scripting.ExecutionWorld,
      runAt: "document_start",
    },
  ])
  .then(() => {
    console.log("[SW] MAIN world content script registered successfully");
  })
  .catch((err: unknown) => {
    console.warn("[SW] registerContentScripts error:", err);
  });

/** タブ更新時のフォールバック注入: 宣言的注入が効かない場合に備える */
const STUDIO_URL_RE = /^https:\/\/studio\.x\.com\//;
const injectedTabs = new Set<number>();

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== "complete") return;
  if (!tab.url || !STUDIO_URL_RE.test(tab.url)) return;
  if (injectedTabs.has(tabId)) return;

  injectedTabs.add(tabId);
  console.log("[SW] Programmatic injection for tab", tabId, tab.url);

  chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["content-isolated.js"],
    })
    .then(() => console.log("[SW] content-isolated.js injected"))
    .catch((err: unknown) => console.error("[SW] content-isolated.js injection failed:", err));

  chrome.scripting
    .executeScript({
      target: { tabId },
      files: ["content-main.js"],
      world: "MAIN" as chrome.scripting.ExecutionWorld,
    })
    .then(() => console.log("[SW] content-main.js injected"))
    .catch((err: unknown) => console.error("[SW] content-main.js injection failed:", err));
});

chrome.tabs.onRemoved.addListener((tabId: number) => {
  injectedTabs.delete(tabId);
  if (sessionState.activeTabId === tabId) {
    handlePageClosed();
  }
});

/** Service Worker 起動時にセッション状態を復元する */
async function restoreState(): Promise<void> {
  sessionState = await settingsStore.loadSessionState();
  currentSettings = await settingsStore.loadSettings();

  if (sessionState.isActive && sessionState.currentViewerCount !== null) {
    await badge.showViewerCount(
      sessionState.currentViewerCount,
      sessionState.lastError !== null,
    );
  }
}

restoreState();
