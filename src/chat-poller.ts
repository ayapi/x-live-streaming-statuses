import type { ChatCredentials, RawChatMessage, ChatHistoryResponse } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("ChatPoller");

type FetchFn = typeof globalThis.fetch;

const DEFAULT_POLL_INTERVAL_MS = 3_000;
const HISTORY_LIMIT = 1000;

export interface ChatPollerOptions {
  pollIntervalMs?: number;
}

export interface ChatPollerCallbacks {
  onTokenExpired?: () => void;
}

export interface ChatPoller {
  start(
    credentials: ChatCredentials,
    onMessages: (msgs: RawChatMessage[]) => void,
    callbacks?: ChatPollerCallbacks,
  ): void;
  stop(): void;
  getCursor(): string;
}

/** ChatPollerを生成する（fetchを注入可能） */
export function createChatPoller(
  fetchFn: FetchFn = globalThis.fetch,
  options?: ChatPollerOptions,
): ChatPoller {
  const basePollInterval = options?.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  let currentPollInterval = basePollInterval;
  let cursor = "";
  let timerId: ReturnType<typeof setInterval> | null = null;

  return {
    start(
      credentials: ChatCredentials,
      onMessages: (msgs: RawChatMessage[]) => void,
      callbacks?: ChatPollerCallbacks,
    ): void {
      currentPollInterval = basePollInterval;

      const poll = async () => {
        try {
          const url = `${credentials.endpoint}/chatapi/v1/history`;
          const response = await fetchFn(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              access_token: credentials.accessToken,
              cursor,
              limit: HISTORY_LIMIT,
              since: cursor === "" ? 0 : undefined,
              quick_get: false,
            }),
          });

          if (!response.ok) {
            if (response.status === 401) {
              logger.warn("トークンが無効です。リフレッシュが必要です。");
              callbacks?.onTokenExpired?.();
              return;
            }

            if (response.status === 429) {
              logger.warn("レート制限を受けました。ポーリング間隔を延長します。", {
                previousInterval: currentPollInterval,
                newInterval: currentPollInterval * 2,
              });
              // 現在のタイマーを停止し、延長した間隔で再開
              if (timerId !== null) {
                clearInterval(timerId);
              }
              currentPollInterval = currentPollInterval * 2;
              timerId = setInterval(poll, currentPollInterval);
              return;
            }

            logger.warn("チャット履歴の取得に失敗", {
              status: response.status,
              statusText: response.statusText,
            });
            return;
          }

          const data = (await response.json()) as ChatHistoryResponse;

          // cursorの更新（空cursorの場合は前回のを保持）
          if (data.cursor !== "") {
            cursor = data.cursor;
          }

          // メッセージがある場合のみコールバック
          if (data.messages.length > 0) {
            onMessages(data.messages);
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.error("チャットポーリング中にエラーが発生", { error: message });
        }
      };

      timerId = setInterval(poll, currentPollInterval);
    },

    stop(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },

    getCursor(): string {
      return cursor;
    },
  };
}
