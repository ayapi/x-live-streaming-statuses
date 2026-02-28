/** live_viewers.json のレスポンス型 */
export interface LiveViewersResponse {
  media_key: string;
  bucket_size: number;
  ts: number[];
}

/** chrome.storage.local に保存する永続設定 */
export interface ExtensionSettings {
  serverHost: string;
  serverPort: number;
}

/** chrome.storage.session に保存する実行時状態 */
export interface SessionState {
  isActive: boolean;
  mediaKey: string | null;
  ownerId: string | null;
  currentViewerCount: number | null;
  lastError: string | null;
  activeTabId: number | null;
}

/** Content Script → Service Worker メッセージ */
export type ContentMessage =
  | { type: "PAGE_DETECTED"; mediaKey: string; ownerId: string }
  | { type: "VIEWER_COUNT_UPDATE"; data: LiveViewersResponse }
  | { type: "PAGE_CLOSED" };

/** Popup → Service Worker メッセージ */
export type PopupMessage = { type: "GET_STATUS" };

/** Service Worker → Popup レスポンス */
export type StatusResponse = {
  type: "STATUS";
  isActive: boolean;
  viewerCount: number | null;
  lastError: string | null;
};

/** MAIN world → ISOLATED world メッセージ (window.postMessage) */
export interface WindowMessage {
  type: "X_LIVE_VIEWER_DATA";
  data: LiveViewersResponse;
}

/** すべての Service Worker が受け付けるメッセージ */
export type ServiceWorkerMessage = ContentMessage | PopupMessage;

/** 設定のデフォルト値 */
export const DEFAULT_SETTINGS: ExtensionSettings = {
  serverHost: "localhost",
  serverPort: 11190,
};

/** 初期セッション状態 */
export const INITIAL_SESSION_STATE: SessionState = {
  isActive: false,
  mediaKey: null,
  ownerId: null,
  currentViewerCount: null,
  lastError: null,
  activeTabId: null,
};
