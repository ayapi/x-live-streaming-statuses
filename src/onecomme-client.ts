import type { Result } from "./result.js";
import type { ParsedComment, OneCommeComment, SendError } from "./types.js";
import { ok, err } from "./result.js";
import { createLogger } from "./logger.js";

const logger = createLogger("OneCommeClient");

export interface OneCommeClientConfig {
  host: string;
  port: number;
  serviceId: string;
  ownerUserId: string;
}

export interface OneCommeClient {
  send(comment: ParsedComment): Promise<Result<void, SendError>>;
}

type FetchFn = typeof globalThis.fetch;

/** ParsedCommentをOneCommeComment形式に変換する */
export function toOneCommeComment(
  comment: ParsedComment,
  serviceId: string,
  ownerUserId: string,
): OneCommeComment {
  return {
    service: {
      id: serviceId,
    },
    comment: {
      id: comment.id,
      userId: comment.userId,
      name: comment.displayName,
      comment: comment.comment,
      profileImage: comment.profileImage,
      badges: [] as never[],
      hasGift: false as const,
      isOwner: comment.userId === ownerUserId,
      timestamp: String(comment.timestamp),
    },
  };
}

/** OneCommeClientを生成する（fetchを注入可能） */
export function createOneCommeClient(
  config: OneCommeClientConfig,
  fetchFn: FetchFn = globalThis.fetch,
): OneCommeClient {
  const baseUrl = `http://${config.host}:${config.port}`;

  return {
    async send(comment: ParsedComment): Promise<Result<void, SendError>> {
      const payload = toOneCommeComment(
        comment,
        config.serviceId,
        config.ownerUserId,
      );

      let response: Response;
      try {
        response = await fetchFn(`${baseUrl}/api/comments`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch (e) {
        if (e instanceof DOMException && e.name === "AbortError") {
          return err({ kind: "timeout" });
        }
        return err({ kind: "connection_refused" });
      }

      if (!response.ok) {
        if (response.status === 400) {
          logger.error("わんコメの枠IDが無効です。設定を確認してください", {
            serviceId: config.serviceId,
          });
          return err({
            kind: "invalid_service_id",
            serviceId: config.serviceId,
          });
        }
        return err({
          kind: "api_error",
          status: response.status,
          message: response.statusText,
        });
      }

      logger.info("コメント送信成功", {
        commentId: comment.id,
        user: comment.displayName,
      });
      return ok(undefined);
    },
  };
}
