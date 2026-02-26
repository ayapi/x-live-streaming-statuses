import type { Result } from "./result.js";
import type { ChatCredentials, TokenError } from "./types.js";
import { ok, err } from "./result.js";
import { createLogger } from "./logger.js";

const logger = createLogger("TokenProvider");

type FetchFn = typeof globalThis.fetch;

const LIVE_VIDEO_STREAM_URL = "https://api.x.com/1.1/live_video_stream/status";
const ACCESS_CHAT_PUBLIC_URL = "https://proxsee-cf.pscp.tv/api/v2/accessChatPublic";

/** JWTペイロードからexpフィールドをデコードする（検証は行わない） */
export function decodeJwtExp(jwt: string): number | null {
  try {
    const parts = jwt.split(".");
    if (parts.length !== 3) return null;
    const payload = JSON.parse(
      Buffer.from(parts[1], "base64url").toString("utf-8"),
    );
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

interface LiveVideoStreamResponse {
  chatToken?: string;
}

interface AccessChatPublicResponse {
  access_token: string;
  endpoint: string;
  room_id: string;
}

export interface TokenProvider {
  acquire(mediaKey: string): Promise<Result<ChatCredentials, TokenError>>;
  refresh(): Promise<Result<ChatCredentials, TokenError>>;
  isExpiringSoon(): boolean;
  getCredentials(): ChatCredentials | null;
}

/** トークン取得の共通ロジック */
async function acquireToken(
  fetchFn: FetchFn,
  mediaKey: string,
): Promise<Result<ChatCredentials, TokenError>> {
  // Step 1: live_video_stream/status からchatTokenを取得
  let streamResponse: Response;
  try {
    streamResponse = await fetchFn(
      `${LIVE_VIDEO_STREAM_URL}/${mediaKey}.json`,
    );
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: "api_error", status: 0, message });
  }

  if (!streamResponse.ok) {
    if (streamResponse.status === 404) {
      return err({ kind: "stream_not_found", mediaKey });
    }
    return err({
      kind: "api_error",
      status: streamResponse.status,
      message: streamResponse.statusText,
    });
  }

  const streamData =
    (await streamResponse.json()) as LiveVideoStreamResponse;

  if (!streamData.chatToken) {
    return err({ kind: "stream_offline" });
  }

  const chatToken = streamData.chatToken;

  // Step 2: JWTからexpを抽出
  const exp = decodeJwtExp(chatToken);
  if (exp === null) {
    return err({ kind: "stream_offline" });
  }

  // Step 3: accessChatPublic でaccess_tokenに交換
  let chatResponse: Response;
  try {
    chatResponse = await fetchFn(ACCESS_CHAT_PUBLIC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_token: chatToken }),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return err({ kind: "api_error", status: 0, message });
  }

  if (!chatResponse.ok) {
    return err({ kind: "chat_access_denied" });
  }

  const chatData =
    (await chatResponse.json()) as AccessChatPublicResponse;

  return ok({
    accessToken: chatData.access_token,
    endpoint: chatData.endpoint,
    roomId: chatData.room_id,
    expiresAt: exp * 1000,
  });
}

/** TokenProviderを生成する（fetchを注入可能） */
export function createTokenProvider(
  fetchFn: FetchFn = globalThis.fetch,
): TokenProvider {
  let storedMediaKey: string | null = null;
  let credentials: ChatCredentials | null = null;
  let acquiredAt: number | null = null;

  return {
    async acquire(
      mediaKey: string,
    ): Promise<Result<ChatCredentials, TokenError>> {
      const result = await acquireToken(fetchFn, mediaKey);
      if (result.ok) {
        storedMediaKey = mediaKey;
        credentials = result.value;
        acquiredAt = Date.now();

        logger.info("チャットトークン取得成功", {
          endpoint: credentials.endpoint,
          roomId: credentials.roomId,
          expiresAt: new Date(credentials.expiresAt).toISOString(),
        });
      }
      return result;
    },

    async refresh(): Promise<Result<ChatCredentials, TokenError>> {
      if (storedMediaKey === null) {
        return err({ kind: "stream_offline" });
      }

      const result = await acquireToken(fetchFn, storedMediaKey);
      if (result.ok) {
        credentials = result.value;
        acquiredAt = Date.now();

        logger.info("トークンリフレッシュ成功", {
          endpoint: credentials.endpoint,
          roomId: credentials.roomId,
          expiresAt: new Date(credentials.expiresAt).toISOString(),
        });
      }
      return result;
    },

    isExpiringSoon(): boolean {
      if (credentials === null || acquiredAt === null) {
        return true;
      }
      const lifetime = credentials.expiresAt - acquiredAt;
      const elapsed = Date.now() - acquiredAt;
      return elapsed >= lifetime * 0.8;
    },

    getCredentials(): ChatCredentials | null {
      return credentials;
    },
  };
}
