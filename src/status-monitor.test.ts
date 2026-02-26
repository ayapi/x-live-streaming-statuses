import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createStatusMonitor } from "./status-monitor.js";

describe("createStatusMonitor", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeBroadcastResponse(state: string) {
    return {
      broadcasts: {
        "1yKAPMPBOOzxb": {
          id: "1yKAPMPBOOzxb",
          media_key: "28_1234567890",
          title: "テスト配信",
          state,
          user_display_name: "テストユーザー",
          username: "testuser",
          start: "2026-02-26T10:00:00.000Z",
        },
      },
    };
  }

  it("開始時の初期状態はRUNNINGである", () => {
    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    expect(monitor.getCurrentState()).toBe("RUNNING");

    monitor.stop();
  });

  it("30秒間隔でbroadcasts/show.jsonをポーリングする", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("RUNNING"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);

    // 最初のポーリング（30秒後）
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2回目のポーリング（60秒後）
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("正しいAPIエンドポイントにリクエストする", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("RUNNING"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    await vi.advanceTimersByTimeAsync(30_000);

    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("api.x.com/1.1/broadcasts/show.json");
    expect(url).toContain("ids=1yKAPMPBOOzxb");

    monitor.stop();
  });

  it("状態がRUNNINGからENDEDに変化した場合にコールバックを呼び出す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("ENDED"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onStateChange).toHaveBeenCalledWith("ENDED");
    expect(monitor.getCurrentState()).toBe("ENDED");
  });

  it("状態がRUNNINGからTIMED_OUTに変化した場合にもコールバックを呼び出す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("TIMED_OUT"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onStateChange).toHaveBeenCalledWith("TIMED_OUT");
  });

  it("状態が変化しない場合はコールバックを呼び出さない", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("RUNNING"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    await vi.advanceTimersByTimeAsync(30_000);
    await vi.advanceTimersByTimeAsync(30_000);

    expect(onStateChange).not.toHaveBeenCalled();
  });

  it("stopでポーリングを停止する", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse("RUNNING"),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    monitor.stop();

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("APIエラー時にもクラッシュせずポーリングを継続する", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBroadcastResponse("RUNNING"),
      });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);

    // 1回目: APIエラー → クラッシュしない
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    // 2回目: 正常 → ポーリング継続
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("ネットワークエラー時にもクラッシュせずポーリングを継続する", async () => {
    mockFetch
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBroadcastResponse("RUNNING"),
      });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("レスポンスにbroadcast情報がない場合もクラッシュしない", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ broadcasts: {} }),
    });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);
    await vi.advanceTimersByTimeAsync(30_000);

    // クラッシュせず、コールバックも呼ばれない
    expect(onStateChange).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("配信終了検出後はポーリングを自動停止する", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBroadcastResponse("ENDED"),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeBroadcastResponse("ENDED"),
      });

    const monitor = createStatusMonitor(mockFetch);
    const onStateChange = vi.fn();

    monitor.start("1yKAPMPBOOzxb", onStateChange);

    // ENDED検出
    await vi.advanceTimersByTimeAsync(30_000);
    expect(onStateChange).toHaveBeenCalledTimes(1);

    // 以降のポーリングは停止
    await vi.advanceTimersByTimeAsync(30_000);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
