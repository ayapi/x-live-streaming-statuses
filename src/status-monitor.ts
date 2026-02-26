import type { BroadcastState } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("StatusMonitor");

type FetchFn = typeof globalThis.fetch;

const POLL_INTERVAL_MS = 30_000;

interface BroadcastShowResponse {
  broadcasts: Record<string, { state: string }>;
}

export interface StatusMonitor {
  start(
    broadcastId: string,
    onStateChange: (state: BroadcastState) => void,
  ): void;
  stop(): void;
  getCurrentState(): BroadcastState;
}

/** StatusMonitorを生成する（fetchを注入可能） */
export function createStatusMonitor(
  fetchFn: FetchFn = globalThis.fetch,
): StatusMonitor {
  let currentState: BroadcastState = "RUNNING";
  let timerId: ReturnType<typeof setInterval> | null = null;

  return {
    start(
      broadcastId: string,
      onStateChange: (state: BroadcastState) => void,
    ): void {
      currentState = "RUNNING";

      const poll = async () => {
        try {
          const url = `https://api.x.com/1.1/broadcasts/show.json?ids=${broadcastId}&include_events=false`;
          const response = await fetchFn(url);

          if (!response.ok) {
            logger.warn("配信状態の取得に失敗", {
              status: response.status,
              statusText: response.statusText,
            });
            return;
          }

          const data = (await response.json()) as BroadcastShowResponse;
          const broadcast = data.broadcasts[broadcastId];

          if (!broadcast) {
            logger.warn("ブロードキャスト情報が見つかりません", { broadcastId });
            return;
          }

          const newState = broadcast.state as BroadcastState;

          if (newState !== currentState) {
            logger.info(`配信状態が変化: ${currentState} → ${newState}`);
            currentState = newState;
            onStateChange(newState);

            // 配信終了時はポーリングを自動停止
            if (newState === "ENDED" || newState === "TIMED_OUT") {
              logger.info("配信が終了しました。状態監視を停止します。");
              this.stop();
            }
          }
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          logger.error("配信状態の監視中にエラーが発生", { error: message });
        }
      };

      timerId = setInterval(poll, POLL_INTERVAL_MS);
    },

    stop(): void {
      if (timerId !== null) {
        clearInterval(timerId);
        timerId = null;
      }
    },

    getCurrentState(): BroadcastState {
      return currentState;
    },
  };
}
