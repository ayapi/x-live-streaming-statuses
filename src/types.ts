// ============================================================
// Domain Models
// ============================================================

/** ブロードキャスト情報 */
export interface BroadcastInfo {
  broadcastId: string;
  mediaKey: string;
  title: string;
  state: "RUNNING" | "ENDED" | string;
  username: string;
  displayName: string;
  startedAt: number; // epoch ms
}

/** チャット認証情報 */
export interface ChatCredentials {
  accessToken: string;
  endpoint: string; // chatman server URL (region-specific)
  roomId: string;
  expiresAt: number; // epoch ms
}

/** Periscope Chat APIからの生メッセージ */
export interface RawChatMessage {
  kind: number; // 1=chat, 2=system
  payload: string; // JSON string
  signature: string;
}

/** チャット履歴レスポンス */
export interface ChatHistoryResponse {
  messages: RawChatMessage[];
  cursor: string;
}

/** パース済みコメント */
export interface ParsedComment {
  id: string; // payload.uuid
  userId: string; // sender.twitter_id
  username: string; // sender.username
  displayName: string; // sender.display_name
  comment: string; // body.body (inner JSON)
  profileImage: string; // sender.profile_image_url
  timestamp: number; // body.timestamp (ms)
  verified: boolean; // sender.verified
  lang: string; // payload.lang
}

/** ブロードキャスト状態 */
export type BroadcastState = "RUNNING" | "ENDED" | "TIMED_OUT" | string;

/** わんコメ送信用コメント */
export interface OneCommeComment {
  service: {
    id: string;
  };
  comment: {
    id: string;
    userId: string;
    name: string;
    comment: string;
    profileImage: string;
    badges: never[];
    hasGift: false;
    isOwner: boolean;
    timestamp: number; // epoch ms (number) — わんコメAJVスキーマはoneOf[number, date-time string]
  };
}

// ============================================================
// Configuration
// ============================================================

/** サービス指定方法を表すdiscriminated union */
export type ServiceTarget =
  | { kind: "id"; serviceId: string }
  | { kind: "name"; serviceName: string };

export interface CLIConfig {
  broadcastUrl: string | undefined;
  oneCommeHost: string; // default: "localhost"
  oneCommePort: number; // default: 11180
  serviceTarget: ServiceTarget; // サービス指定（ID直接 or 名前解決）
  pollIntervalMs: number; // default: 3000
  viewerCountPort: number; // default: 11190
}

// ============================================================
// Error Types
// ============================================================

export type BroadcastError =
  | { kind: "invalid_url"; url: string }
  | { kind: "not_found"; broadcastId: string }
  | { kind: "already_ended"; broadcastId: string }
  | { kind: "api_error"; status: number; message: string };

export type TokenError =
  | { kind: "stream_not_found"; mediaKey: string }
  | { kind: "stream_offline" }
  | { kind: "chat_access_denied" }
  | { kind: "api_error"; status: number; message: string };

export type SendError =
  | { kind: "connection_refused" }
  | { kind: "invalid_service_id"; serviceId: string }
  | { kind: "validation_error"; details: string }
  | { kind: "api_error"; status: number; message: string }
  | { kind: "timeout" };

export type ConfigError =
  | { kind: "conflicting_service_options" }
  | { kind: "invalid_url"; url: string }
  | { kind: "invalid_port"; port: string }
  | { kind: "invalid_viewer_port"; port: string };

/** わんコメ GET /api/services レスポンスの各要素（必要フィールドのみ） */
export interface OneCommeService {
  id: string;
  name: string;
  url: string;
}

/** サービス解決結果（IDとURL） */
export interface ResolvedService {
  serviceId: string;
  url: string;
}

/** サービス解決エラー */
export type ServiceResolveError =
  | { kind: "not_found"; serviceName: string; availableServices: string[] }
  | { kind: "id_not_found"; serviceId: string }
  | { kind: "url_not_found"; serviceId: string; serviceName: string }
  | { kind: "ambiguous"; serviceName: string; matches: Array<{ id: string; name: string }> }
  | { kind: "connection_refused" }
  | { kind: "timeout" }
  | { kind: "api_error"; status: number; message: string };
