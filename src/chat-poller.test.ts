import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createChatPoller } from "./chat-poller.js";
import type { ChatCredentials, RawChatMessage } from "./types.js";

describe("createChatPoller", () => {
  const mockFetch = vi.fn();

  const testCredentials: ChatCredentials = {
    accessToken: "test_access_token",
    endpoint: "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv",
    roomId: "1MnGnAkwLelGO",
    expiresAt: Date.now() + 86400_000,
  };

  function makeHistoryResponse(
    messages: RawChatMessage[],
    cursor: string,
  ) {
    return { messages, cursor };
  }

  function makeMessage(uuid: string, body: string): RawChatMessage {
    return {
      kind: 1,
      payload: JSON.stringify({
        uuid,
        body: JSON.stringify({ body, timestamp: Date.now() }),
        sender: { display_name: "user", twitter_id: "123" },
      }),
      signature: "sig",
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("正しいエンドポイントにPOSTリクエストを送信する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toBe(
      "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv/chatapi/v1/history",
    );

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    expect(init.method).toBe("POST");

    poller.stop();
  });

  it("初回ポーリングではcursorを空文字列・sinceを0に設定する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    await vi.advanceTimersByTimeAsync(3_000);

    const init = mockFetch.mock.calls[0][1] as RequestInit;
    const body = JSON.parse(init.body as string);

    expect(body.access_token).toBe("test_access_token");
    expect(body.cursor).toBe("");
    expect(body.since).toBe(0);
    expect(body.limit).toBe(1000);
    expect(body.quick_get).toBe(false);

    poller.stop();
  });

  it("2回目以降は前回のcursorを使用する", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([makeMessage("m1", "hello")], "cursor_abc"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([], "cursor_def"),
      });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);

    // 1回目: cursor="" → cursor_abc を取得
    await vi.advanceTimersByTimeAsync(3_000);

    // 2回目: cursor="cursor_abc"
    await vi.advanceTimersByTimeAsync(3_000);

    const secondBody = JSON.parse(
      (mockFetch.mock.calls[1][1] as RequestInit).body as string,
    );
    expect(secondBody.cursor).toBe("cursor_abc");

    poller.stop();
  });

  it("メッセージ取得時にコールバックを呼び出す", async () => {
    const msg1 = makeMessage("m1", "hello");
    const msg2 = makeMessage("m2", "world");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([msg1, msg2], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(onMessages).toHaveBeenCalledTimes(1);
    expect(onMessages).toHaveBeenCalledWith([msg1, msg2]);

    poller.stop();
  });

  it("空メッセージ時はコールバックを呼び出さない", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    await vi.advanceTimersByTimeAsync(3_000);

    expect(onMessages).not.toHaveBeenCalled();

    poller.stop();
  });

  it("設定可能なポーリング間隔で動作する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch, { pollIntervalMs: 5_000 });
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);

    // 3秒ではまだポーリングされない
    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockFetch).not.toHaveBeenCalled();

    // 5秒で1回目
    await vi.advanceTimersByTimeAsync(2_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    poller.stop();
  });

  it("stopでポーリングを停止する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([], "cursor_1"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    poller.stop();

    await vi.advanceTimersByTimeAsync(3_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("停止時にcursorを保持する", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeHistoryResponse([makeMessage("m1", "hi")], "cursor_saved"),
    });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);
    await vi.advanceTimersByTimeAsync(3_000);
    poller.stop();

    expect(poller.getCursor()).toBe("cursor_saved");
  });

  it("getCursorは初期状態で空文字列を返す", () => {
    const poller = createChatPoller(mockFetch);
    expect(poller.getCursor()).toBe("");
  });

  it("空cursorが返された場合は前回のcursorを再利用する", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([makeMessage("m1", "hi")], "cursor_keep"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([], ""),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([], "cursor_new"),
      });

    const poller = createChatPoller(mockFetch);
    const onMessages = vi.fn();

    poller.start(testCredentials, onMessages);

    // 1回目: cursor="" → "cursor_keep"
    await vi.advanceTimersByTimeAsync(3_000);
    // 2回目: cursorが空で返される → "cursor_keep"を再利用
    await vi.advanceTimersByTimeAsync(3_000);
    // 3回目: "cursor_keep"で送信されるはず
    await vi.advanceTimersByTimeAsync(3_000);

    const thirdBody = JSON.parse(
      (mockFetch.mock.calls[2][1] as RequestInit).body as string,
    );
    expect(thirdBody.cursor).toBe("cursor_keep");

    poller.stop();
  });

  describe("エラーハンドリング", () => {
    it("401エラー時にonTokenExpiredコールバックを呼び出す", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: "Unauthorized",
      });

      const poller = createChatPoller(mockFetch);
      const onMessages = vi.fn();
      const onTokenExpired = vi.fn();

      poller.start(testCredentials, onMessages, { onTokenExpired });
      await vi.advanceTimersByTimeAsync(3_000);

      expect(onTokenExpired).toHaveBeenCalledTimes(1);
      expect(onMessages).not.toHaveBeenCalled();

      poller.stop();
    });

    it("429エラー時にポーリング間隔を自動延長する", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 429,
          statusText: "Too Many Requests",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeHistoryResponse([], "cursor_1"),
        });

      const poller = createChatPoller(mockFetch, { pollIntervalMs: 3_000 });
      const onMessages = vi.fn();

      poller.start(testCredentials, onMessages);

      // 1回目: 3秒後 → 429
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 次のポーリングは2倍の6秒後
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(1); // まだ呼ばれない

      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(2); // 6秒後に呼ばれる

      poller.stop();
    });

    it("ネットワークエラー時にもクラッシュせずポーリングを継続する", async () => {
      mockFetch
        .mockRejectedValueOnce(new Error("network error"))
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeHistoryResponse([], "cursor_1"),
        });

      const poller = createChatPoller(mockFetch);
      const onMessages = vi.fn();

      poller.start(testCredentials, onMessages);

      // 1回目: ネットワークエラー
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      // 2回目: 正常 → ポーリング継続
      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      poller.stop();
    });

    it("その他のHTTPエラー時にもクラッシュせずポーリングを継続する", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: false,
          status: 500,
          statusText: "Internal Server Error",
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeHistoryResponse([], "cursor_1"),
        });

      const poller = createChatPoller(mockFetch);
      const onMessages = vi.fn();

      poller.start(testCredentials, onMessages);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(3_000);
      expect(mockFetch).toHaveBeenCalledTimes(2);

      poller.stop();
    });
  });

  describe("再開", () => {
    it("stop後にstartで再開するとcursorを引き継ぐ", async () => {
      // 1回目のポーリングセッション
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([makeMessage("m1", "hi")], "cursor_resume"),
      });

      const poller = createChatPoller(mockFetch);
      const onMessages = vi.fn();

      poller.start(testCredentials, onMessages);
      await vi.advanceTimersByTimeAsync(3_000);
      poller.stop();

      // 新しい認証情報で再開
      const newCredentials: ChatCredentials = {
        ...testCredentials,
        accessToken: "new_token",
      };

      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeHistoryResponse([], "cursor_next"),
      });

      poller.start(newCredentials, onMessages);
      await vi.advanceTimersByTimeAsync(3_000);

      // 再開時は保持されたcursorを使用
      const body = JSON.parse(
        (mockFetch.mock.calls[1][1] as RequestInit).body as string,
      );
      expect(body.cursor).toBe("cursor_resume");
      expect(body.access_token).toBe("new_token");

      poller.stop();
    });
  });
});
