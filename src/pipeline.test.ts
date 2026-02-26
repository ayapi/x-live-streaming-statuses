import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createBroadcastResolver } from "./broadcast-resolver.js";
import { createTokenProvider } from "./token-provider.js";
import { createChatPoller } from "./chat-poller.js";
import { createMessageParser } from "./message-parser.js";
import { createDuplicateFilter } from "./duplicate-filter.js";
import { createOneCommeClient } from "./onecomme-client.js";
import { createBufferedOneCommeClient } from "./buffered-onecomme-client.js";
import { createStatusMonitor } from "./status-monitor.js";
import { isOk } from "./result.js";
import type { ChatCredentials, RawChatMessage } from "./types.js";

// ============================================================
// テストヘルパー
// ============================================================

function createMockJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp, room_id: "room_1" })).toString("base64url");
  return `${header}.${payload}.mock_signature`;
}

function makeChatPayload(overrides: {
  uuid?: string;
  body?: string;
  displayName?: string;
  username?: string;
  twitterId?: string;
  timestamp?: number;
} = {}): string {
  const innerBody = JSON.stringify({
    body: overrides.body ?? "テストコメント",
    timestamp: overrides.timestamp ?? 1709000000000,
    uuid: overrides.uuid ?? "msg-001",
  });

  return JSON.stringify({
    uuid: overrides.uuid ?? "msg-001",
    body: innerBody,
    lang: "ja",
    sender: {
      user_id: "puser_1",
      username: overrides.username ?? "testuser",
      display_name: overrides.displayName ?? "テストユーザー",
      profile_image_url: "https://pbs.twimg.com/profile_images/123/photo.jpg",
      verified: false,
      twitter_id: overrides.twitterId ?? "999888777",
    },
    timestamp: 1709000000000000000,
  });
}

function makeRawMessage(uuid: string, body: string): RawChatMessage {
  return {
    kind: 1,
    payload: makeChatPayload({ uuid, body }),
    signature: "sig",
  };
}

// ============================================================
// E2Eパイプラインテスト
// ============================================================

describe("E2Eパイプライン: メッセージ取得→パース→重複フィルタ→わんコメ送信", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const serviceId = "service-uuid-001";
  const testExp = Math.floor(Date.now() / 1000) + 86400;
  const testChatToken = createMockJwt(testExp);

  function setupMockApis() {
    // BroadcastResolver: broadcasts/show.json
    const broadcastResponse = {
      broadcasts: {
        "1yKAPMPBOOzxb": {
          id: "1yKAPMPBOOzxb",
          media_key: "28_1234567890",
          title: "テスト配信",
          state: "RUNNING",
          user_display_name: "配信者",
          username: "broadcaster",
          start: "2026-02-26T10:00:00.000Z",
        },
      },
    };

    // TokenProvider: live_video_stream/status
    const streamResponse = {
      chatToken: testChatToken,
      source: { location: "https://example.com/stream" },
    };

    // TokenProvider: accessChatPublic
    const accessChatResponse = {
      access_token: "access_token_value",
      endpoint: "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv",
      room_id: "room_1",
    };

    return { broadcastResponse, streamResponse, accessChatResponse };
  }

  it("フルパイプライン: 起動→コメント取得→変換→送信→重複スキップ", async () => {
    const { broadcastResponse, streamResponse, accessChatResponse } = setupMockApis();

    // Step 1-3: Resolve broadcast, acquire token
    mockFetch
      // BroadcastResolver.resolve
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => broadcastResponse,
      })
      // TokenProvider.acquire (live_video_stream)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => streamResponse,
      })
      // TokenProvider.acquire (accessChatPublic)
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => accessChatResponse,
      });

    // Step 1: Resolve broadcast
    const resolver = createBroadcastResolver(mockFetch);
    const broadcastResult = await resolver.resolve("1yKAPMPBOOzxb");
    expect(isOk(broadcastResult)).toBe(true);
    if (!broadcastResult.ok) return;
    const broadcast = broadcastResult.value;

    // Step 2: Acquire token
    const tokenProvider = createTokenProvider(mockFetch);
    const tokenResult = await tokenProvider.acquire(broadcast.mediaKey);
    expect(isOk(tokenResult)).toBe(true);
    if (!tokenResult.ok) return;
    const credentials = tokenResult.value;

    // Step 3: Setup pipeline components
    const messageParser = createMessageParser();
    const duplicateFilter = createDuplicateFilter();
    const oneCommeClient = createOneCommeClient(
      { host: "localhost", port: 11180, serviceId, ownerUserId: "broadcaster" },
      mockFetch,
    );
    const bufferedClient = createBufferedOneCommeClient(oneCommeClient, {
      delayFn: () => Promise.resolve(),
    });

    // Chat polling用のレスポンス
    const msg1 = makeRawMessage("uuid-001", "こんにちは");
    const msg2 = makeRawMessage("uuid-002", "よろしく");

    // 1回目のポーリング: 2件のメッセージ
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ messages: [msg1, msg2], cursor: "cursor_1" }),
    });

    // わんコメへの送信（2回分）
    mockFetch
      .mockResolvedValueOnce({ ok: true, status: 200 }) // uuid-001
      .mockResolvedValueOnce({ ok: true, status: 200 }); // uuid-002

    // 2回目のポーリング: 重複メッセージ + 新規メッセージ
    mockFetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({
        messages: [
          msg1, // 重複
          makeRawMessage("uuid-003", "新しいコメント"),
        ],
        cursor: "cursor_2",
      }),
    });

    // わんコメへの送信（1回分: uuid-003のみ）
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 }); // uuid-003

    // パイプラインの実行
    const sentComments: string[] = [];

    const handleMessages = async (rawMessages: RawChatMessage[]) => {
      const parsed = messageParser.parse(rawMessages);
      for (const comment of parsed) {
        if (duplicateFilter.isDuplicate(comment.id)) {
          continue;
        }
        const result = await bufferedClient.send(comment);
        if (result.ok) {
          duplicateFilter.markSent(comment.id);
          sentComments.push(comment.id);
        }
      }
    };

    const chatPoller = createChatPoller(mockFetch, { pollIntervalMs: 3_000 });
    chatPoller.start(credentials, handleMessages);

    // 1回目のポーリング
    await vi.advanceTimersByTimeAsync(3_000);
    // 非同期コールバックの完了を待つ
    await vi.advanceTimersByTimeAsync(0);

    expect(sentComments).toEqual(["uuid-001", "uuid-002"]);
    expect(duplicateFilter.size()).toBe(2);

    // 2回目のポーリング（重複コメント含む）
    await vi.advanceTimersByTimeAsync(3_000);
    await vi.advanceTimersByTimeAsync(0);

    // uuid-001は重複なのでスキップ、uuid-003のみ送信
    expect(sentComments).toEqual(["uuid-001", "uuid-002", "uuid-003"]);
    expect(duplicateFilter.size()).toBe(3);

    chatPoller.stop();
  });

  it("わんコメ接続不能時のバッファリングと接続回復後のフラッシュ", async () => {
    const messageParser = createMessageParser();
    const duplicateFilter = createDuplicateFilter();

    // 最初は接続拒否
    const oneCommeFetch = vi.fn();
    const oneCommeClient = createOneCommeClient(
      { host: "localhost", port: 11180, serviceId, ownerUserId: "" },
      oneCommeFetch,
    );
    const bufferedClient = createBufferedOneCommeClient(oneCommeClient, {
      delayFn: () => Promise.resolve(),
    });

    // わんコメ接続拒否
    oneCommeFetch.mockRejectedValue(new Error("fetch failed"));

    const raw = [
      makeRawMessage("uuid-buf-1", "バッファ1"),
      makeRawMessage("uuid-buf-2", "バッファ2"),
    ];

    // パイプライン実行（接続拒否→バッファリング）
    const parsed = messageParser.parse(raw);
    for (const comment of parsed) {
      if (!duplicateFilter.isDuplicate(comment.id)) {
        const result = await bufferedClient.send(comment);
        if (result.ok) {
          duplicateFilter.markSent(comment.id);
        }
      }
    }

    // 1件目で接続拒否 → バッファモード移行、2件目はバッファに追加
    expect(bufferedClient.isConnected()).toBe(false);
    expect(bufferedClient.getBufferSize()).toBe(2);

    // わんコメ接続回復
    oneCommeFetch.mockResolvedValue({ ok: true, status: 200 });
    await bufferedClient.flushBuffer();

    expect(bufferedClient.isConnected()).toBe(true);
    expect(bufferedClient.getBufferSize()).toBe(0);
  });

  it("配信終了検出によるパイプライン停止", async () => {
    const { broadcastResponse } = setupMockApis();

    // StatusMonitor: 最初はRUNNING、次にENDED
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => broadcastResponse,
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          broadcasts: {
            "1yKAPMPBOOzxb": {
              ...broadcastResponse.broadcasts["1yKAPMPBOOzxb"],
              state: "ENDED",
            },
          },
        }),
      });

    const statusMonitor = createStatusMonitor(mockFetch);
    const stateChanges: string[] = [];

    statusMonitor.start("1yKAPMPBOOzxb", (state) => {
      stateChanges.push(state);
    });

    // 30秒後: まだRUNNING
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stateChanges).toEqual([]);
    expect(statusMonitor.getCurrentState()).toBe("RUNNING");

    // 60秒後: ENDEDに変化
    await vi.advanceTimersByTimeAsync(30_000);
    expect(stateChanges).toEqual(["ENDED"]);
    expect(statusMonitor.getCurrentState()).toBe("ENDED");
  });

  it("トークンリフレッシュ後にポーラーが新しい認証情報で再開する", async () => {
    const { streamResponse, accessChatResponse } = setupMockApis();

    // 短い有効期限のトークン
    const now = Date.now();
    const shortExp = Math.floor(now / 1000) + 100; // 100秒後
    const shortJwt = createMockJwt(shortExp);

    // 初回token acquire
    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ...streamResponse, chatToken: shortJwt }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => accessChatResponse,
      });

    const tokenProvider = createTokenProvider(mockFetch);
    const result = await tokenProvider.acquire("28_1234567890");
    expect(isOk(result)).toBe(true);

    // 80秒経過 → isExpiringSoon = true
    vi.setSystemTime(now + 80_000);
    expect(tokenProvider.isExpiringSoon()).toBe(true);

    // リフレッシュ用レスポンス（新しい長い有効期限）
    const longExp = Math.floor((now + 80_000) / 1000) + 86400;
    const longJwt = createMockJwt(longExp);

    mockFetch
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({ ...streamResponse, chatToken: longJwt }),
      })
      .mockResolvedValueOnce({
        ok: true, status: 200,
        json: async () => ({
          ...accessChatResponse,
          access_token: "refreshed_token",
        }),
      });

    const refreshResult = await tokenProvider.refresh();
    expect(isOk(refreshResult)).toBe(true);
    if (refreshResult.ok) {
      expect(refreshResult.value.accessToken).toBe("refreshed_token");
    }

    // リフレッシュ後は期限切れ間近ではない
    expect(tokenProvider.isExpiringSoon()).toBe(false);
  });

  it("kind:2メッセージはパイプライン全体でスキップされる", async () => {
    const messageParser = createMessageParser();
    const duplicateFilter = createDuplicateFilter();

    const raw: RawChatMessage[] = [
      { kind: 2, payload: '{"type":"join","body":"{}"}', signature: "sig" },
      makeRawMessage("uuid-only", "唯一の有効コメント"),
      { kind: 2, payload: '{"type":"share","body":"{}"}', signature: "sig" },
    ];

    const parsed = messageParser.parse(raw);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].id).toBe("uuid-only");

    // 重複フィルタを通して送信対象を確認
    const toSend = parsed.filter((c) => !duplicateFilter.isDuplicate(c.id));
    expect(toSend).toHaveLength(1);
    expect(toSend[0].comment).toBe("唯一の有効コメント");
  });

  it("不正JSONメッセージ混在時もパイプラインが停止しない", async () => {
    const consoleSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const messageParser = createMessageParser();
    const duplicateFilter = createDuplicateFilter();

    const raw: RawChatMessage[] = [
      makeRawMessage("uuid-good-1", "正常コメント1"),
      { kind: 1, payload: "not-valid-json", signature: "sig" },
      makeRawMessage("uuid-good-2", "正常コメント2"),
      { kind: 1, payload: JSON.stringify({ uuid: "bad", body: "not-json{", lang: "ja", sender: { twitter_id: "1", username: "u", display_name: "d", profile_image_url: "http://x", verified: false }, timestamp: 0 }), signature: "sig" },
    ];

    const parsed = messageParser.parse(raw);
    // 不正JSONはスキップ、正常な2件のみ
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("uuid-good-1");
    expect(parsed[1].id).toBe("uuid-good-2");

    const toSend = parsed.filter((c) => !duplicateFilter.isDuplicate(c.id));
    expect(toSend).toHaveLength(2);

    consoleSpy.mockRestore();
  });
});

describe("グレースフルシャットダウン", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ChatPollerとStatusMonitorがstopで安全に停止する", async () => {
    const mockFetch = vi.fn();

    // ChatPoller: ポーリング中にstop
    mockFetch.mockResolvedValue({
      ok: true, status: 200,
      json: async () => ({ messages: [], cursor: "c1" }),
    });

    const credentials: ChatCredentials = {
      accessToken: "token",
      endpoint: "https://chatman.pscp.tv",
      roomId: "room_1",
      expiresAt: Date.now() + 86400_000,
    };

    const chatPoller = createChatPoller(mockFetch, { pollIntervalMs: 3_000 });
    const statusMonitor = createStatusMonitor(mockFetch);
    const onMessages = vi.fn();

    chatPoller.start(credentials, onMessages);
    statusMonitor.start("1yKAPMPBOOzxb", vi.fn());

    // 1回ポーリング実行
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockFetch).toHaveBeenCalled();

    // シャットダウン: stop
    chatPoller.stop();
    statusMonitor.stop();

    const callCountAfterStop = mockFetch.mock.calls.length;

    // stop後はポーリングされない
    await vi.advanceTimersByTimeAsync(60_000);
    expect(mockFetch.mock.calls.length).toBe(callCountAfterStop);
  });

  it("バッファフラッシュ後にシャットダウンが完了する", async () => {
    const mockSend = vi.fn();
    const innerClient = { send: mockSend };

    // 接続拒否→バッファモード（OneCommeClientはResultを返す）
    mockSend.mockResolvedValue({ ok: false, error: { kind: "connection_refused" } });

    const bufferedClient = createBufferedOneCommeClient(innerClient, {
      delayFn: () => Promise.resolve(),
    });

    // バッファにコメントを蓄積
    await bufferedClient.send({
      id: "shutdown-1", userId: "u1", username: "user1",
      displayName: "ユーザー1", comment: "テスト",
      profileImage: "http://img", timestamp: 123, verified: false, lang: "ja",
    });
    await bufferedClient.send({
      id: "shutdown-2", userId: "u2", username: "user2",
      displayName: "ユーザー2", comment: "テスト2",
      profileImage: "http://img", timestamp: 456, verified: false, lang: "ja",
    });

    expect(bufferedClient.getBufferSize()).toBe(2);
    expect(bufferedClient.isConnected()).toBe(false);

    // 接続回復→フラッシュ
    mockSend.mockResolvedValue({ ok: true, value: undefined } as const);
    await bufferedClient.flushBuffer();

    expect(bufferedClient.getBufferSize()).toBe(0);
    expect(bufferedClient.isConnected()).toBe(true);
  });
});
