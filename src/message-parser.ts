import type { RawChatMessage, ParsedComment } from "./types.js";
import { createLogger } from "./logger.js";

const logger = createLogger("MessageParser");

interface PayloadSender {
  user_id: string;
  username: string;
  display_name: string;
  profile_image_url: string;
  verified: boolean;
  twitter_id: string;
}

interface ParsedPayload {
  uuid: string;
  body: string; // inner JSON string
  lang: string;
  sender: PayloadSender;
  timestamp: number; // nanoseconds
}

interface ParsedBody {
  body: string;
  timestamp: number; // milliseconds
}

export interface MessageParser {
  parse(raw: RawChatMessage[]): ParsedComment[];
}

/** MessageParserを生成する */
export function createMessageParser(): MessageParser {
  return {
    parse(raw: RawChatMessage[]): ParsedComment[] {
      const results: ParsedComment[] = [];

      for (const msg of raw) {
        if (msg.kind !== 1) {
          continue;
        }

        let payload: ParsedPayload;
        try {
          payload = JSON.parse(msg.payload) as ParsedPayload;
        } catch {
          logger.warn("ペイロードのJSONパースに失敗しました", {
            signature: msg.signature,
          });
          continue;
        }

        let body: ParsedBody;
        try {
          body = JSON.parse(payload.body) as ParsedBody;
        } catch {
          logger.warn("bodyの内部JSONパースに失敗しました", {
            uuid: payload.uuid,
          });
          continue;
        }

        results.push({
          id: payload.uuid,
          userId: payload.sender.twitter_id,
          username: payload.sender.username,
          displayName: payload.sender.display_name,
          comment: body.body,
          profileImage: payload.sender.profile_image_url,
          timestamp: body.timestamp,
          verified: payload.sender.verified,
          lang: payload.lang,
        });
      }

      return results;
    },
  };
}
