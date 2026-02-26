import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createOneCommeClient,
  toOneCommeComment,
} from "./onecomme-client.js";
import { isOk, isErr } from "./result.js";
import type { ParsedComment } from "./types.js";

function makeParsedComment(
  overrides: Partial<ParsedComment> = {},
): ParsedComment {
  return {
    id: "msg-uuid-001",
    userId: "999888777",
    username: "testuser",
    displayName: "テストユーザー",
    comment: "こんにちは",
    profileImage: "https://pbs.twimg.com/profile_images/123/photo.jpg",
    timestamp: 1709000000000,
    verified: false,
    lang: "ja",
    ...overrides,
  };
}

describe("toOneCommeComment", () => {
  const serviceId = "service-uuid-001";
  const ownerUserId = "owner-twitter-id";

  it("ParsedCommentをOneCommeComment形式に正しく変換する", () => {
    const comment = makeParsedComment();
    const result = toOneCommeComment(comment, serviceId, ownerUserId);

    expect(result.service.id).toBe(serviceId);
    expect(result.comment.id).toBe("msg-uuid-001");
    expect(result.comment.userId).toBe("999888777");
    expect(result.comment.name).toBe("テストユーザー");
    expect(result.comment.comment).toBe("こんにちは");
    expect(result.comment.profileImage).toBe(
      "https://pbs.twimg.com/profile_images/123/photo.jpg",
    );
    expect(result.comment.badges).toEqual([]);
    expect(result.comment.hasGift).toBe(false);
    expect(result.comment.isOwner).toBe(false);
  });

  it("timestampをstring型に変換する", () => {
    const comment = makeParsedComment({ timestamp: 1709000000000 });
    const result = toOneCommeComment(comment, serviceId, ownerUserId);

    expect(result.comment.timestamp).toBe("1709000000000");
    expect(typeof result.comment.timestamp).toBe("string");
  });

  it("配信者のtwitter_idと一致する場合にisOwner=trueを設定する", () => {
    const comment = makeParsedComment({ userId: "owner-twitter-id" });
    const result = toOneCommeComment(comment, serviceId, ownerUserId);

    expect(result.comment.isOwner).toBe(true);
  });

  it("配信者のtwitter_idと一致しない場合にisOwner=falseを設定する", () => {
    const comment = makeParsedComment({ userId: "someone-else" });
    const result = toOneCommeComment(comment, serviceId, ownerUserId);

    expect(result.comment.isOwner).toBe(false);
  });
});

describe("OneCommeClient", () => {
  const mockFetch = vi.fn();
  const config = {
    host: "localhost",
    port: 11180,
    serviceId: "service-uuid-001",
    ownerUserId: "owner-twitter-id",
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("正しいエンドポイントにPOSTリクエストを送信する", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const client = createOneCommeClient(config, mockFetch);
    await client.send(makeParsedComment());

    expect(mockFetch).toHaveBeenCalledOnce();
    const [url, options] = mockFetch.mock.calls[0];
    expect(url).toBe("http://localhost:11180/api/comments");
    expect(options.method).toBe("POST");
    expect(options.headers["Content-Type"]).toBe("application/json");
  });

  it("正しいJSON形式のボディを送信する", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const client = createOneCommeClient(config, mockFetch);
    await client.send(makeParsedComment());

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.service.id).toBe("service-uuid-001");
    expect(body.comment.id).toBe("msg-uuid-001");
    expect(body.comment.userId).toBe("999888777");
    expect(body.comment.name).toBe("テストユーザー");
    expect(body.comment.comment).toBe("こんにちは");
    expect(body.comment.profileImage).toBe(
      "https://pbs.twimg.com/profile_images/123/photo.jpg",
    );
    expect(body.comment.badges).toEqual([]);
    expect(body.comment.hasGift).toBe(false);
    expect(body.comment.isOwner).toBe(false);
    expect(body.comment.timestamp).toBe("1709000000000");
  });

  it("送信成功時（200 OK）にok結果を返す", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isOk(result)).toBe(true);
  });

  it("接続拒否時にconnection_refusedエラーを返す", async () => {
    const connError = new TypeError("fetch failed");
    (connError as NodeJS.ErrnoException).cause = {
      code: "ECONNREFUSED",
    };
    mockFetch.mockRejectedValueOnce(connError);

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("connection_refused");
    }
  });

  it("400レスポンス時にinvalid_service_idエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("invalid_service_id");
      if (result.error.kind === "invalid_service_id") {
        expect(result.error.serviceId).toBe("service-uuid-001");
      }
    }
  });

  it("その他のHTTPエラーレスポンス時にapi_errorを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(500);
      }
    }
  });

  it("タイムアウトエラー時にtimeoutエラーを返す", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("一般的なネットワークエラー時にconnection_refusedエラーを返す", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const client = createOneCommeClient(config, mockFetch);
    const result = await client.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("connection_refused");
    }
  });

  it("配信者のコメントにisOwner=trueを設定する", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const client = createOneCommeClient(config, mockFetch);
    await client.send(makeParsedComment({ userId: "owner-twitter-id" }));

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.comment.isOwner).toBe(true);
  });

  it("カスタムホスト・ポートを使用してURLを構築する", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, status: 200 });

    const customConfig = {
      ...config,
      host: "192.168.1.100",
      port: 9999,
    };
    const client = createOneCommeClient(customConfig, mockFetch);
    await client.send(makeParsedComment());

    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("http://192.168.1.100:9999/api/comments");
  });
});
