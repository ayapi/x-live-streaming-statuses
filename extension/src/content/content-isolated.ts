/** ISOLATED world Content Script: MAIN world と Service Worker 間のブリッジ、ページ検知 */

import { isProducerPage, extractBroadcastId } from "../page-detector.js";
import type { WindowMessage } from "../types.js";

const WINDOW_MESSAGE_TYPE = "X_LIVE_VIEWER_DATA";

/** ページ検出: 配信詳細ページの場合は Service Worker に通知 */
function detectPage(): void {
  console.log("[ISOLATED] detectPage called, URL:", location.href);
  if (!isProducerPage(location.href)) {
    console.log("[ISOLATED] Not a producer page, skipping");
    return;
  }

  const broadcastId = extractBroadcastId(location.href);
  if (!broadcastId) return;

  // owner_id はページ内のスクリプトやAPIレスポンスから取得する必要がある
  // 初期実装ではページ内の __NEXT_DATA__ やグローバル変数から抽出を試みる
  // 取得できない場合は broadcastId のみで PAGE_DETECTED を送信する
  const ownerId = extractOwnerIdFromPage();

  console.log("[ISOLATED] Sending PAGE_DETECTED, broadcastId:", broadcastId, "ownerId:", ownerId);
  chrome.runtime.sendMessage({
    type: "PAGE_DETECTED",
    mediaKey: broadcastId,
    ownerId: ownerId ?? "",
  }).then(() => {
    console.log("[ISOLATED] PAGE_DETECTED sent successfully");
  }).catch((err: unknown) => {
    console.error("[ISOLATED] PAGE_DETECTED failed:", err);
  });
}

/** ページ DOM からオーナーIDを抽出する */
function extractOwnerIdFromPage(): string | null {
  // Media Studio のページ内の script タグやデータ属性から取得を試みる
  try {
    // __NEXT_DATA__ から取得を試みる（Next.js ベースの場合）
    const nextDataEl = document.getElementById("__NEXT_DATA__");
    if (nextDataEl?.textContent) {
      const data = JSON.parse(nextDataEl.textContent);
      const userId =
        data?.props?.pageProps?.user?.id_str ??
        data?.props?.pageProps?.userId;
      if (typeof userId === "string") return userId;
    }
  } catch {
    /* パース失敗は無視 */
  }

  // meta タグから取得を試みる
  const metaUserId = document.querySelector<HTMLMetaElement>(
    'meta[name="user-id"]',
  );
  if (metaUserId?.content) return metaUserId.content;

  return null;
}

/** MAIN world からの視聴者データを受信し Service Worker に転送する */
function setupMessageBridge(): void {
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;

    const data = event.data as Partial<WindowMessage> | null;
    if (!data || data.type !== WINDOW_MESSAGE_TYPE) return;

    chrome.runtime.sendMessage({
      type: "VIEWER_COUNT_UPDATE",
      data: data.data,
    });
  });
}

/** ページ離脱を Service Worker に通知する */
function setupPageCloseHandler(): void {
  window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({ type: "PAGE_CLOSED" });
  });
}

/** SPA ナビゲーション対応: URL 変化を監視して再検出する */
let lastHref = location.href;

function monitorUrlChanges(): void {
  setInterval(() => {
    if (location.href === lastHref) return;
    const previousHref = lastHref;
    lastHref = location.href;

    const wasOnBroadcast = isProducerPage(previousHref);
    const isOnBroadcast = isProducerPage(lastHref);

    if (isOnBroadcast) {
      // 配信ページに遷移（別の配信への遷移も含む）
      detectPage();
    } else if (wasOnBroadcast) {
      // 配信ページから離脱
      chrome.runtime.sendMessage({ type: "PAGE_CLOSED" });
    }
  }, 500);
}

// 初期化
console.log("[ISOLATED] Content script loaded on:", location.href);
setupMessageBridge();
setupPageCloseHandler();
monitorUrlChanges();

// DOMContentLoaded 後にページ検出（DOM要素へのアクセスが必要なため）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", detectPage);
} else {
  detectPage();
}
