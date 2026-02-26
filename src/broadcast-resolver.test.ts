import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  extractBroadcastId,
  createBroadcastResolver,
} from "./broadcast-resolver.js";
import { isOk, isErr } from "./result.js";

describe("extractBroadcastId", () => {
  it("x.com形式のURLからブロードキャストIDを抽出する", () => {
    const result = extractBroadcastId(
      "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("1yKAPMPBOOzxb");
  });

  it("twitter.com形式のURLからブロードキャストIDを抽出する", () => {
    const result = extractBroadcastId(
      "https://twitter.com/i/broadcasts/1yKAPMPBOOzxb",
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("1yKAPMPBOOzxb");
  });

  it("末尾スラッシュ付きURLからもIDを抽出する", () => {
    const result = extractBroadcastId(
      "https://x.com/i/broadcasts/1yKAPMPBOOzxb/",
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("1yKAPMPBOOzxb");
  });

  it("クエリパラメータ付きURLからもIDを抽出する", () => {
    const result = extractBroadcastId(
      "https://x.com/i/broadcasts/1yKAPMPBOOzxb?ref=home",
    );
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("1yKAPMPBOOzxb");
  });

  it("直接IDを入力できる", () => {
    const result = extractBroadcastId("1yKAPMPBOOzxb");
    expect(isOk(result)).toBe(true);
    if (isOk(result)) expect(result.value).toBe("1yKAPMPBOOzxb");
  });

  it("無効なURLに対してエラーを返す", () => {
    const result = extractBroadcastId("https://example.com/not-a-broadcast");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("invalid_url");
  });

  it("空文字列に対してエラーを返す", () => {
    const result = extractBroadcastId("");
    expect(isErr(result)).toBe(true);
    if (isErr(result)) expect(result.error.kind).toBe("invalid_url");
  });
});

describe("createBroadcastResolver", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  function makeBroadcastResponse(overrides: Record<string, unknown> = {}) {
    return {
      broadcasts: {
        "1yKAPMPBOOzxb": {
          id: "1yKAPMPBOOzxb",
          media_key: "28_1234567890",
          title: "テスト配信",
          state: "RUNNING",
          user_display_name: "テストユーザー",
          username: "testuser",
          start: "2026-02-26T10:00:00.000Z",
          ...overrides,
        },
      },
    };
  }

  it("正常なURLからブロードキャスト情報を取得する", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse(),
    });

    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve(
      "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
    );

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.broadcastId).toBe("1yKAPMPBOOzxb");
      expect(result.value.mediaKey).toBe("28_1234567890");
      expect(result.value.title).toBe("テスト配信");
      expect(result.value.state).toBe("RUNNING");
      expect(result.value.username).toBe("testuser");
      expect(result.value.displayName).toBe("テストユーザー");
      expect(result.value.startedAt).toBeTypeOf("number");
    }
  });

  it("正しいAPIエンドポイントにリクエストする", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse(),
    });

    const resolver = createBroadcastResolver(mockFetch);
    await resolver.resolve("1yKAPMPBOOzxb");

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0] as string;
    expect(url).toContain("api.x.com/1.1/broadcasts/show.json");
    expect(url).toContain("ids=1yKAPMPBOOzxb");
    expect(url).toContain("include_events=false");
  });

  it("配信が見つからない場合にnot_foundエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ broadcasts: {} }),
    });

    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve("1yKAPMPBOOzxb");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("not_found");
    }
  });

  it("配信が終了済みの場合にalready_endedエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeBroadcastResponse({ state: "ENDED" }),
    });

    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve("1yKAPMPBOOzxb");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("already_ended");
    }
  });

  it("APIが404を返した場合にapi_errorを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve("1yKAPMPBOOzxb");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(404);
      }
    }
  });

  it("ネットワークエラー時にapi_errorを返す", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve("1yKAPMPBOOzxb");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
    }
  });

  it("無効なURLに対してinvalid_urlエラーを返す", async () => {
    const resolver = createBroadcastResolver(mockFetch);
    const result = await resolver.resolve("https://example.com/not-valid");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("invalid_url");
    }
    expect(mockFetch).not.toHaveBeenCalled();
  });
});
