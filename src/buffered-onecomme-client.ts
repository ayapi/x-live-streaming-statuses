import type { Result } from "./result.js";
import type { ParsedComment, SendError } from "./types.js";
import type { OneCommeClient } from "./onecomme-client.js";
import { ok, err } from "./result.js";
import { createLogger } from "./logger.js";

const logger = createLogger("BufferedOneCommeClient");

const DEFAULT_MAX_BUFFER_SIZE = 1_000;
const DEFAULT_RETRY_DELAYS_MS = [1000, 2000, 4000];

function defaultDelay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export interface BufferedOneCommeClientOptions {
  maxBufferSize?: number;
  retryDelaysMs?: number[];
  delayFn?: (ms: number) => Promise<void>;
}

export interface BufferedOneCommeClient {
  send(comment: ParsedComment): Promise<Result<void, SendError>>;
  isConnected(): boolean;
  getBufferSize(): number;
  flushBuffer(): Promise<void>;
}

/** リトライ・バッファリング機能付きOneCommeClientを生成する */
export function createBufferedOneCommeClient(
  innerClient: OneCommeClient,
  options: BufferedOneCommeClientOptions = {},
): BufferedOneCommeClient {
  const maxBufferSize = options.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const delayFn = options.delayFn ?? defaultDelay;

  const buffer: ParsedComment[] = [];
  let connected = true;

  function addToBuffer(comment: ParsedComment): void {
    buffer.push(comment);
    if (buffer.length > maxBufferSize) {
      const discarded = buffer.shift();
      logger.warn("バッファ上限に達したため古いコメントを破棄しました", {
        discardedId: discarded?.id,
        bufferSize: buffer.length,
      });
    }
  }

  async function sendWithRetry(
    comment: ParsedComment,
  ): Promise<Result<void, SendError>> {
    const result = await innerClient.send(comment);
    if (result.ok) {
      return result;
    }

    // invalid_service_id / validation_error はリトライしない（設定・データエラー）
    if (
      result.error.kind === "invalid_service_id" ||
      result.error.kind === "validation_error"
    ) {
      return result;
    }

    // リトライ
    for (let i = 0; i < retryDelaysMs.length; i++) {
      logger.warn(`送信リトライ ${i + 1}/${retryDelaysMs.length}`, {
        delayMs: retryDelaysMs[i],
        commentId: comment.id,
      });
      await delayFn(retryDelaysMs[i]);

      const retryResult = await innerClient.send(comment);
      if (retryResult.ok) {
        return retryResult;
      }

      if (
        retryResult.error.kind === "invalid_service_id" ||
        retryResult.error.kind === "validation_error"
      ) {
        return retryResult;
      }
    }

    // 全リトライ失敗
    return result;
  }

  return {
    async send(comment: ParsedComment): Promise<Result<void, SendError>> {
      // バッファモード中はバッファに追加
      if (!connected) {
        addToBuffer(comment);
        logger.debug("バッファモード中: コメントをキューに追加", {
          commentId: comment.id,
          bufferSize: buffer.length,
        });
        return ok(undefined);
      }

      const result = await sendWithRetry(comment);

      if (result.ok) {
        return result;
      }

      // connection_refusedの場合はバッファモードに移行
      if (result.error.kind === "connection_refused") {
        connected = false;
        addToBuffer(comment);
        logger.error("わんコメに接続できません。バッファモードに移行します", {
          bufferSize: buffer.length,
        });
        return ok(undefined);
      }

      return result;
    },

    isConnected(): boolean {
      return connected;
    },

    getBufferSize(): number {
      return buffer.length;
    },

    async flushBuffer(): Promise<void> {
      if (buffer.length === 0) {
        return;
      }

      logger.info("バッファフラッシュを開始します", {
        bufferSize: buffer.length,
      });

      while (buffer.length > 0) {
        const comment = buffer[0];
        const result = await innerClient.send(comment);

        if (!result.ok) {
          logger.warn("バッファフラッシュ中に送信失敗。残りはバッファに保持", {
            remainingBuffer: buffer.length,
          });
          connected = false;
          return;
        }

        buffer.shift();
      }

      connected = true;
      logger.info("バッファフラッシュ完了。接続を回復しました");
    },
  };
}
