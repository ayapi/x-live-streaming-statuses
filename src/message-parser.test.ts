import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMessageParser } from "./message-parser.js";
import type { RawChatMessage, ParsedComment } from "./types.js";

/** テスト用のペイロードを生成するヘルパー */
function makePayload(overrides: Record<string, unknown> = {}): string {
  const innerBody = JSON.stringify({
    body: "こんにちは",
    displayName: "テストユーザー",
    username: "testuser",
    remoteID: "puser_123",
    timestamp: 1709000000000,
    uuid: "msg-uuid-001",
    type: 1,
    v: 2,
  });

  return JSON.stringify({
    room: "broadcast_123",
    body: innerBody,
    lang: "ja",
    sender: {
      user_id: "puser_123",
      username: "testuser",
      display_name: "テストユーザー",
      profile_image_url:
        "https://pbs.twimg.com/profile_images/123/photo_reasonably_small.jpg",
      participant_index: 0,
      locale: "ja",
      verified: false,
      twitter_id: "999888777",
      lang: ["ja"],
    },
    timestamp: 1709000000000000000,
    uuid: "msg-uuid-001",
    ...overrides,
  });
}

function makeRawMessage(
  overrides: { kind?: number; payload?: string; signature?: string } = {},
): RawChatMessage {
  return {
    kind: 1,
    payload: makePayload(),
    signature: "sig_abc",
    ...overrides,
  };
}

describe("MessageParser", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("kind:1のチャットメッセージを正しくパースする", () => {
    const parser = createMessageParser();
    const raw = [makeRawMessage()];
    const result = parser.parse(raw);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-uuid-001");
    expect(result[0].userId).toBe("999888777");
    expect(result[0].username).toBe("testuser");
    expect(result[0].displayName).toBe("テストユーザー");
    expect(result[0].comment).toBe("こんにちは");
    expect(result[0].profileImage).toBe(
      "https://pbs.twimg.com/profile_images/123/photo_reasonably_small.jpg",
    );
    expect(result[0].timestamp).toBe(1709000000000);
    expect(result[0].verified).toBe(false);
    expect(result[0].lang).toBe("ja");
  });

  it("kind:2のシステムメッセージをスキップする", () => {
    const parser = createMessageParser();
    const raw = [
      makeRawMessage(),
      makeRawMessage({ kind: 2, payload: '{"type":"join"}' }),
    ];
    const result = parser.parse(raw);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-uuid-001");
  });

  it("複数のチャットメッセージを正しくパースする", () => {
    const parser = createMessageParser();
    const payload2 = makePayload({
      uuid: "msg-uuid-002",
      body: JSON.stringify({
        body: "お疲れ様",
        timestamp: 1709000001000,
        uuid: "msg-uuid-002",
      }),
      sender: {
        user_id: "puser_456",
        username: "user2",
        display_name: "ユーザー2",
        profile_image_url: "https://example.com/img2.jpg",
        participant_index: 1,
        locale: "ja",
        verified: true,
        twitter_id: "111222333",
        lang: ["ja"],
      },
      lang: "en",
    });

    const raw = [makeRawMessage(), makeRawMessage({ payload: payload2 })];
    const result = parser.parse(raw);

    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("msg-uuid-001");
    expect(result[1].id).toBe("msg-uuid-002");
    expect(result[1].userId).toBe("111222333");
    expect(result[1].displayName).toBe("ユーザー2");
    expect(result[1].comment).toBe("お疲れ様");
    expect(result[1].verified).toBe(true);
    expect(result[1].lang).toBe("en");
  });

  it("外側のpayload JSONが不正な場合はスキップしてログを出力する", () => {
    const parser = createMessageParser();
    const raw = [makeRawMessage({ payload: "not-json{{{" })];
    const result = parser.parse(raw);

    expect(result).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("内側のbody JSONが不正な場合はスキップしてログを出力する", () => {
    const parser = createMessageParser();
    const badPayload = JSON.stringify({
      uuid: "bad-body-msg",
      body: "not-valid-json{{{",
      lang: "ja",
      sender: {
        user_id: "p1",
        username: "u1",
        display_name: "d1",
        profile_image_url: "https://example.com/img.jpg",
        verified: false,
        twitter_id: "t1",
      },
      timestamp: 1709000000000000000,
    });
    const raw = [makeRawMessage({ payload: badPayload })];
    const result = parser.parse(raw);

    expect(result).toHaveLength(0);
    expect(consoleSpy).toHaveBeenCalled();
  });

  it("空の配列を渡すと空の配列を返す", () => {
    const parser = createMessageParser();
    const result = parser.parse([]);

    expect(result).toHaveLength(0);
  });

  it("verified: true の投稿者を正しくパースする", () => {
    const parser = createMessageParser();
    const payload = makePayload({
      sender: {
        user_id: "puser_v",
        username: "verified_user",
        display_name: "認証済みユーザー",
        profile_image_url: "https://example.com/verified.jpg",
        participant_index: 0,
        locale: "ja",
        verified: true,
        twitter_id: "verified_id",
        lang: ["ja"],
      },
    });
    const raw = [makeRawMessage({ payload })];
    const result = parser.parse(raw);

    expect(result).toHaveLength(1);
    expect(result[0].verified).toBe(true);
    expect(result[0].displayName).toBe("認証済みユーザー");
  });

  it("kind:1以外（kind:3など）もスキップする", () => {
    const parser = createMessageParser();
    const raw = [makeRawMessage({ kind: 3 }), makeRawMessage({ kind: 0 })];
    const result = parser.parse(raw);

    expect(result).toHaveLength(0);
  });

  it("正常なメッセージと不正なメッセージが混在する場合、正常なもののみ返す", () => {
    const parser = createMessageParser();
    const raw = [
      makeRawMessage(), // 正常
      makeRawMessage({ payload: "broken" }), // 不正
      makeRawMessage({ kind: 2 }), // システムメッセージ
    ];
    const result = parser.parse(raw);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("msg-uuid-001");
  });
});
