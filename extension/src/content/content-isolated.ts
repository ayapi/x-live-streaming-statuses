/** ISOLATED world Content Script: MAIN world と Service Worker 間のブリッジ、ページ検知 */

import { isProducerPage, extractBroadcastId } from "../page-detector.js";
import type { WindowMessage } from "../types.js";

const WINDOW_MESSAGE_TYPE = "X_LIVE_VIEWER_DATA";

/** ページ検出: 配信詳細ページの場合は Service Worker に通知 */
function detectPage(): void {
  if (!isProducerPage(location.href)) return;

  const broadcastId = extractBroadcastId(location.href);
  if (!broadcastId) return;

  // owner_id はページ内のスクリプトやAPIレスポンスから取得する必要がある
  // 初期実装ではページ内の __NEXT_DATA__ やグローバル変数から抽出を試みる
  // 取得できない場合は broadcastId のみで PAGE_DETECTED を送信する
  const ownerId = extractOwnerIdFromPage();

  chrome.runtime.sendMessage({
    type: "PAGE_DETECTED",
    mediaKey: broadcastId,
    ownerId: ownerId ?? "",
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

// 初期化
setupMessageBridge();
setupPageCloseHandler();

// DOMContentLoaded 後にページ検出（DOM要素へのアクセスが必要なため）
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", detectPage);
} else {
  detectPage();
}
