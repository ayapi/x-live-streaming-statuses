import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createTokenProvider, decodeJwtExp } from "./token-provider.js";
import { isOk, isErr } from "./result.js";

/** テスト用のモックJWTを生成する */
function createMockJwt(exp: number): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({ exp, room_id: "1MnGnAkwLelGO" })).toString("base64url");
  return `${header}.${payload}.mock_signature`;
}

describe("decodeJwtExp", () => {
  it("JWTペイロードからexpフィールドをデコードする", () => {
    const exp = Math.floor(Date.now() / 1000) + 86400;
    const jwt = createMockJwt(exp);
    expect(decodeJwtExp(jwt)).toBe(exp);
  });

  it("不正なJWT形式に対してnullを返す", () => {
    expect(decodeJwtExp("not-a-jwt")).toBeNull();
  });

  it("expフィールドがないJWTに対してnullを返す", () => {
    const header = Buffer.from(JSON.stringify({ alg: "HS256" })).toString("base64url");
    const payload = Buffer.from(JSON.stringify({ sub: "test" })).toString("base64url");
    const jwt = `${header}.${payload}.sig`;
    expect(decodeJwtExp(jwt)).toBeNull();
  });

  it("不正なBase64ペイロードに対してnullを返す", () => {
    expect(decodeJwtExp("header.!!!invalid!!!.sig")).toBeNull();
  });
});

describe("createTokenProvider", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  const testMediaKey = "28_1234567890";
  const testExp = Math.floor(Date.now() / 1000) + 86400; // 24h later
  const testChatToken = createMockJwt(testExp);

  function makeLiveVideoStreamResponse(chatToken: string = testChatToken) {
    return {
      source: { location: "https://example.com/stream" },
      chatToken,
      lifecycleToken: "lifecycle_token_value",
      sessionId: "session_123",
    };
  }

  function makeAccessChatPublicResponse() {
    return {
      access_token: "access_token_value",
      endpoint: "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv",
      room_id: "1MnGnAkwLelGO",
    };
  }

  it("mediaKeyからchatTokenを取得しaccess_tokenに交換する", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLiveVideoStreamResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeAccessChatPublicResponse(),
      });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.accessToken).toBe("access_token_value");
      expect(result.value.endpoint).toBe("https://prod-chatman-ancillary-ap-northeast-1.pscp.tv");
      expect(result.value.roomId).toBe("1MnGnAkwLelGO");
      expect(result.value.expiresAt).toBe(testExp * 1000);
    }
  });

  it("正しいAPIエンドポイントにリクエストする", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLiveVideoStreamResponse(),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeAccessChatPublicResponse(),
      });

    const provider = createTokenProvider(mockFetch);
    await provider.acquire(testMediaKey);

    expect(mockFetch).toHaveBeenCalledTimes(2);

    // Step 1: live_video_stream/status
    const firstUrl = mockFetch.mock.calls[0][0] as string;
    expect(firstUrl).toBe(
      `https://api.x.com/1.1/live_video_stream/status/${testMediaKey}.json`,
    );

    // Step 2: accessChatPublic
    const secondUrl = mockFetch.mock.calls[1][0] as string;
    expect(secondUrl).toBe("https://proxsee-cf.pscp.tv/api/v2/accessChatPublic");
    const secondInit = mockFetch.mock.calls[1][1] as RequestInit;
    expect(secondInit.method).toBe("POST");
    expect(secondInit.headers).toEqual({ "Content-Type": "application/json" });
    const body = JSON.parse(secondInit.body as string);
    expect(body.chat_token).toBe(testChatToken);
  });

  it("chatTokenのJWT expからexpiresAtを算出する", async () => {
    const specificExp = 1740000000; // specific epoch seconds
    const specificJwt = createMockJwt(specificExp);

    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLiveVideoStreamResponse(specificJwt),
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeAccessChatPublicResponse(),
      });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value.expiresAt).toBe(specificExp * 1000);
    }
  });

  it("live_video_streamが404を返した場合にstream_not_foundエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("stream_not_found");
      if (result.error.kind === "stream_not_found") {
        expect(result.error.mediaKey).toBe(testMediaKey);
      }
    }
  });

  it("レスポンスにchatTokenがない場合にstream_offlineエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ source: {}, lifecycleToken: "xxx" }),
    });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("stream_offline");
    }
  });

  it("chatTokenのexpがデコードできない場合にstream_offlineエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => makeLiveVideoStreamResponse("not-a-valid-jwt"),
    });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("stream_offline");
    }
  });

  it("accessChatPublicが失敗した場合にchat_access_deniedエラーを返す", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLiveVideoStreamResponse(),
      })
      .mockResolvedValueOnce({
        ok: false,
        status: 403,
        statusText: "Forbidden",
      });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("chat_access_denied");
    }
  });

  it("live_video_streamのAPI非200レスポンス（404以外）にapi_errorを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(500);
      }
    }
  });

  it("ネットワークエラー時にapi_errorを返す", async () => {
    mockFetch.mockRejectedValueOnce(new Error("fetch failed"));

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(0);
        expect(result.error.message).toBe("fetch failed");
      }
    }
  });

  it("accessChatPublicへのネットワークエラー時にapi_errorを返す", async () => {
    mockFetch
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => makeLiveVideoStreamResponse(),
      })
      .mockRejectedValueOnce(new Error("connection refused"));

    const provider = createTokenProvider(mockFetch);
    const result = await provider.acquire(testMediaKey);

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.message).toBe("connection refused");
      }
    }
  });

  describe("isExpiringSoon", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("acquire前はtrueを返す", () => {
      const provider = createTokenProvider(mockFetch);
      expect(provider.isExpiringSoon()).toBe(true);
    });

    it("有効期限の80%未満の場合はfalseを返す", async () => {
      const now = Date.now();
      vi.setSystemTime(now);

      // expiresAt = now + 100秒 → acquiredAt=now, lifetime=100秒, 80%=80秒
      const expSeconds = Math.floor(now / 1000) + 100;
      const jwt = createMockJwt(expSeconds);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(jwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // 79秒経過 → まだ80%未満
      vi.setSystemTime(now + 79_000);
      expect(provider.isExpiringSoon()).toBe(false);
    });

    it("有効期限の80%以上経過した場合はtrueを返す", async () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const expSeconds = Math.floor(now / 1000) + 100;
      const jwt = createMockJwt(expSeconds);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(jwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // 80秒経過 → 80%到達
      vi.setSystemTime(now + 80_000);
      expect(provider.isExpiringSoon()).toBe(true);
    });

    it("有効期限を過ぎた場合はtrueを返す", async () => {
      const now = Date.now();
      vi.setSystemTime(now);

      const expSeconds = Math.floor(now / 1000) + 100;
      const jwt = createMockJwt(expSeconds);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(jwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // 101秒経過 → 完全に期限切れ
      vi.setSystemTime(now + 101_000);
      expect(provider.isExpiringSoon()).toBe(true);
    });
  });

  describe("refresh", () => {
    it("保存されたmediaKeyで再取得する", async () => {
      // 初回acquire
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // refresh用のレスポンス
      const newExp = Math.floor(Date.now() / 1000) + 172800; // 48h
      const newJwt = createMockJwt(newExp);
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(newJwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "new_access_token",
            endpoint: "https://prod-chatman-ancillary-us-east-1.pscp.tv",
            room_id: "1MnGnAkwLelGO",
          }),
        });

      const result = await provider.refresh();

      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.accessToken).toBe("new_access_token");
        expect(result.value.endpoint).toBe("https://prod-chatman-ancillary-us-east-1.pscp.tv");
        expect(result.value.expiresAt).toBe(newExp * 1000);
      }

      // 保存されたmediaKeyで正しいURLにリクエストされる
      expect(mockFetch.mock.calls[2][0]).toBe(
        `https://api.x.com/1.1/live_video_stream/status/${testMediaKey}.json`,
      );
    });

    it("acquire前にrefreshするとエラーを返す", async () => {
      const provider = createTokenProvider(mockFetch);
      const result = await provider.refresh();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("stream_offline");
      }
    });

    it("リフレッシュ成功後にisExpiringSoonがfalseになる", async () => {
      const now = Date.now();
      vi.useFakeTimers();
      vi.setSystemTime(now);

      const shortExp = Math.floor(now / 1000) + 100;
      const shortJwt = createMockJwt(shortExp);

      // 初回acquire（短い有効期限）
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(shortJwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // 80%経過→期限切れ間近
      vi.setSystemTime(now + 81_000);
      expect(provider.isExpiringSoon()).toBe(true);

      // refresh（長い有効期限）
      const longExp = Math.floor((now + 81_000) / 1000) + 86400;
      const longJwt = createMockJwt(longExp);

      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(longJwt),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "refreshed_token",
            endpoint: "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv",
            room_id: "1MnGnAkwLelGO",
          }),
        });

      const result = await provider.refresh();
      expect(isOk(result)).toBe(true);

      // リフレッシュ後は期限切れ間近ではない
      expect(provider.isExpiringSoon()).toBe(false);

      vi.useRealTimers();
    });

    it("リフレッシュ失敗時はエラーを返す", async () => {
      // 初回acquire
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // refresh失敗
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 500,
        statusText: "Internal Server Error",
      });

      const result = await provider.refresh();

      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("api_error");
      }
    });
  });

  describe("getCredentials", () => {
    it("acquire前はnullを返す", () => {
      const provider = createTokenProvider(mockFetch);
      expect(provider.getCredentials()).toBeNull();
    });

    it("acquire後に認証情報を返す", async () => {
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      const creds = provider.getCredentials();
      expect(creds).not.toBeNull();
      expect(creds!.accessToken).toBe("access_token_value");
      expect(creds!.endpoint).toBe("https://prod-chatman-ancillary-ap-northeast-1.pscp.tv");
      expect(creds!.roomId).toBe("1MnGnAkwLelGO");
    });

    it("refresh後に新しい認証情報を返す", async () => {
      // 初回acquire
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeAccessChatPublicResponse(),
        });

      const provider = createTokenProvider(mockFetch);
      await provider.acquire(testMediaKey);

      // refresh
      mockFetch
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => makeLiveVideoStreamResponse(),
        })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => ({
            access_token: "refreshed_access_token",
            endpoint: "https://prod-chatman-ancillary-us-east-1.pscp.tv",
            room_id: "1MnGnAkwLelGO",
          }),
        });

      await provider.refresh();

      const creds = provider.getCredentials();
      expect(creds).not.toBeNull();
      expect(creds!.accessToken).toBe("refreshed_access_token");
      expect(creds!.endpoint).toBe("https://prod-chatman-ancillary-us-east-1.pscp.tv");
    });
  });
});
