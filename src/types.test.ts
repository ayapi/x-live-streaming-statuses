import { describe, it, expect } from "vitest";
import { ok, err, isOk, isErr, unwrap } from "./result.js";
import type {
  Result,
  BroadcastInfo,
  ChatCredentials,
  RawChatMessage,
  ParsedComment,
  BroadcastState,
  CLIConfig,
  BroadcastError,
  TokenError,
  SendError,
  ConfigError,
} from "./types.js";

describe("Result型ユーティリティ", () => {
  it("ok() は成功結果を生成する", () => {
    const result = ok(42);
    expect(isOk(result)).toBe(true);
    expect(isErr(result)).toBe(false);
    expect(unwrap(result)).toBe(42);
  });

  it("err() は失敗結果を生成する", () => {
    const result = err({ kind: "not_found" as const, broadcastId: "abc" });
    expect(isErr(result)).toBe(true);
    expect(isOk(result)).toBe(false);
  });

  it("unwrap() はerr結果に対してthrowする", () => {
    const result = err("some error");
    expect(() => unwrap(result)).toThrow();
  });

  it("ok結果のvalueにアクセスできる", () => {
    const result: Result<string, Error> = ok("hello");
    if (isOk(result)) {
      expect(result.value).toBe("hello");
    }
  });

  it("err結果のerrorにアクセスできる", () => {
    const result: Result<string, string> = err("fail");
    if (isErr(result)) {
      expect(result.error).toBe("fail");
    }
  });
});

describe("ドメインモデル型", () => {
  it("BroadcastInfo型が正しい構造を持つ", () => {
    const info: BroadcastInfo = {
      broadcastId: "1yKAPMPBOOzxb",
      mediaKey: "28_1234567890",
      title: "テスト配信",
      state: "RUNNING",
      username: "testuser",
      displayName: "テストユーザー",
      startedAt: Date.now(),
    };
    expect(info.broadcastId).toBe("1yKAPMPBOOzxb");
    expect(info.state).toBe("RUNNING");
  });

  it("ChatCredentials型が正しい構造を持つ", () => {
    const creds: ChatCredentials = {
      accessToken: "token123",
      endpoint: "https://prod-chatman-ancillary-ap-northeast-1.pscp.tv",
      roomId: "room123",
      expiresAt: Date.now() + 86400000,
    };
    expect(creds.accessToken).toBe("token123");
  });

  it("RawChatMessage型が正しい構造を持つ", () => {
    const msg: RawChatMessage = {
      kind: 1,
      payload: '{"uuid":"abc"}',
      signature: "sig123",
    };
    expect(msg.kind).toBe(1);
  });

  it("ParsedComment型が正しい構造を持つ", () => {
    const comment: ParsedComment = {
      id: "uuid-123",
      userId: "12345",
      username: "testuser",
      displayName: "テスト",
      comment: "こんにちは",
      profileImage: "https://example.com/img.jpg",
      timestamp: Date.now(),
      verified: false,
      lang: "ja",
    };
    expect(comment.comment).toBe("こんにちは");
  });

  it("CLIConfig型がデフォルト値を含む構造を持つ", () => {
    const config: CLIConfig = {
      broadcastUrl: "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
      oneCommeHost: "localhost",
      oneCommePort: 11180,
      oneCommeServiceId: "uuid-service",
      pollIntervalMs: 3000,
    };
    expect(config.oneCommePort).toBe(11180);
    expect(config.pollIntervalMs).toBe(3000);
  });
});

describe("エラー型", () => {
  it("BroadcastError の各種kindを表現できる", () => {
    const errors: BroadcastError[] = [
      { kind: "invalid_url", url: "bad-url" },
      { kind: "not_found", broadcastId: "abc" },
      { kind: "already_ended", broadcastId: "abc" },
      { kind: "api_error", status: 500, message: "Server Error" },
    ];
    expect(errors).toHaveLength(4);
    expect(errors[0].kind).toBe("invalid_url");
  });

  it("TokenError の各種kindを表現できる", () => {
    const errors: TokenError[] = [
      { kind: "stream_not_found", mediaKey: "28_123" },
      { kind: "stream_offline" },
      { kind: "chat_access_denied" },
      { kind: "api_error", status: 401, message: "Unauthorized" },
    ];
    expect(errors).toHaveLength(4);
  });

  it("SendError の各種kindを表現できる", () => {
    const errors: SendError[] = [
      { kind: "connection_refused" },
      { kind: "invalid_service_id", serviceId: "bad-id" },
      { kind: "api_error", status: 400, message: "Bad Request" },
      { kind: "timeout" },
    ];
    expect(errors).toHaveLength(4);
  });

  it("ConfigError の各種kindを表現できる", () => {
    const errors: ConfigError[] = [
      { kind: "missing_broadcast_url" },
      { kind: "missing_service_id" },
      { kind: "invalid_url", url: "not-a-url" },
      { kind: "invalid_port", port: "abc" },
    ];
    expect(errors).toHaveLength(4);
  });
});
