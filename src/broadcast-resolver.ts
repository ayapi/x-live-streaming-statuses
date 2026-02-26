import type { Result } from "./result.js";
import type { BroadcastInfo, BroadcastError } from "./types.js";
import { ok, err } from "./result.js";
import { createLogger } from "./logger.js";

const logger = createLogger("BroadcastResolver");

const BROADCAST_URL_PATTERN =
  /^https?:\/\/(?:x\.com|twitter\.com)\/i\/broadcasts\/([A-Za-z0-9_]+)/;
const BROADCAST_ID_PATTERN = /^[A-Za-z0-9_]+$/;

/** URLまたは直接IDからブロードキャストIDを抽出する */
export function extractBroadcastId(
  urlOrId: string,
): Result<string, BroadcastError> {
  if (!urlOrId) {
    return err({ kind: "invalid_url", url: urlOrId });
  }

  const urlMatch = urlOrId.match(BROADCAST_URL_PATTERN);
  if (urlMatch) {
    return ok(urlMatch[1]);
  }

  if (BROADCAST_ID_PATTERN.test(urlOrId) && !urlOrId.includes("/")) {
    return ok(urlOrId);
  }

  return err({ kind: "invalid_url", url: urlOrId });
}

type FetchFn = typeof globalThis.fetch;

interface BroadcastShowResponse {
  broadcasts: Record<
    string,
    {
      id: string;
      media_key: string;
      title: string;
      state: string;
      user_display_name: string;
      username: string;
      start: string;
    }
  >;
}

export interface BroadcastResolver {
  resolve(urlOrId: string): Promise<Result<BroadcastInfo, BroadcastError>>;
}

/** BroadcastResolverを生成する（fetchを注入可能） */
export function createBroadcastResolver(
  fetchFn: FetchFn = globalThis.fetch,
): BroadcastResolver {
  return {
    async resolve(
      urlOrId: string,
    ): Promise<Result<BroadcastInfo, BroadcastError>> {
      const idResult = extractBroadcastId(urlOrId);
      if (!idResult.ok) {
        return idResult;
      }
      const broadcastId = idResult.value;

      let response: Response;
      try {
        const url = `https://api.x.com/1.1/broadcasts/show.json?ids=${broadcastId}&include_events=false`;
        response = await fetchFn(url);
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        return err({ kind: "api_error", status: 0, message });
      }

      if (!response.ok) {
        return err({
          kind: "api_error",
          status: response.status,
          message: response.statusText,
        });
      }

      const data = (await response.json()) as BroadcastShowResponse;
      const broadcast = data.broadcasts[broadcastId];

      if (!broadcast) {
        return err({ kind: "not_found", broadcastId });
      }

      if (broadcast.state === "ENDED") {
        return err({ kind: "already_ended", broadcastId });
      }

      const info: BroadcastInfo = {
        broadcastId: broadcast.id,
        mediaKey: broadcast.media_key,
        title: broadcast.title,
        state: broadcast.state,
        username: broadcast.username,
        displayName: broadcast.user_display_name,
        startedAt: new Date(broadcast.start).getTime(),
      };

      logger.info(`配信を検出: "${info.title}" by @${info.username}`);

      return ok(info);
    },
  };
}
