import { describe, it, expect } from "vitest";
import { parseArgs, formatConfigError } from "./cli-config.js";
import { isOk, isErr } from "./result.js";
import type { ConfigError } from "./types.js";

// process.argv: [node, script, ...args]
// parseArgs receives the full argv including node and script path

describe("parseArgs", () => {
  function argv(...args: string[]): string[] {
    return ["node", "x-live-to-wancome", ...args];
  }

  describe("正常系", () => {
    it("必須引数のみで正しいデフォルト値を持つCLIConfigを返す", () => {
      const result = parseArgs(
        argv(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          "--service-id",
          "550e8400-e29b-41d4-a716-446655440000",
        ),
      );
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value).toEqual({
          broadcastUrl: "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          oneCommeHost: "localhost",
          oneCommePort: 11180,
          oneCommeServiceId: "550e8400-e29b-41d4-a716-446655440000",
          pollIntervalMs: 3000,
        });
      }
    });

    it("全引数を指定した場合にすべて反映される", () => {
      const result = parseArgs(
        argv(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          "--service-id",
          "my-service-id",
          "--host",
          "192.168.1.10",
          "--port",
          "8080",
          "--interval",
          "5000",
        ),
      );
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.oneCommeHost).toBe("192.168.1.10");
        expect(result.value.oneCommePort).toBe(8080);
        expect(result.value.pollIntervalMs).toBe(5000);
      }
    });

    it("直接ブロードキャストIDを指定できる", () => {
      const result = parseArgs(
        argv("1yKAPMPBOOzxb", "--service-id", "test-id"),
      );
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.broadcastUrl).toBe("1yKAPMPBOOzxb");
      }
    });

    it("引数の順序に依存しない", () => {
      const result = parseArgs(
        argv(
          "--service-id",
          "test-id",
          "--port",
          "9999",
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
        ),
      );
      expect(isOk(result)).toBe(true);
      if (isOk(result)) {
        expect(result.value.broadcastUrl).toBe(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
        );
        expect(result.value.oneCommeServiceId).toBe("test-id");
        expect(result.value.oneCommePort).toBe(9999);
      }
    });
  });

  describe("エラー系: 必須引数不足", () => {
    it("ブロードキャストURLが未指定の場合にmissing_broadcast_urlエラーを返す", () => {
      const result = parseArgs(argv("--service-id", "test-id"));
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("missing_broadcast_url");
      }
    });

    it("サービスIDが未指定の場合にmissing_service_idエラーを返す", () => {
      const result = parseArgs(
        argv("https://x.com/i/broadcasts/1yKAPMPBOOzxb"),
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("missing_service_id");
      }
    });

    it("引数が一切ない場合にmissing_broadcast_urlエラーを返す", () => {
      const result = parseArgs(argv());
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("missing_broadcast_url");
      }
    });
  });

  describe("エラー系: バリデーション", () => {
    it("無効なポート番号（非数値）の場合にinvalid_portエラーを返す", () => {
      const result = parseArgs(
        argv(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          "--service-id",
          "test-id",
          "--port",
          "abc",
        ),
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("invalid_port");
        if (result.error.kind === "invalid_port") {
          expect(result.error.port).toBe("abc");
        }
      }
    });

    it("無効なポート番号（範囲外）の場合にinvalid_portエラーを返す", () => {
      const result = parseArgs(
        argv(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          "--service-id",
          "test-id",
          "--port",
          "70000",
        ),
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("invalid_port");
      }
    });

    it("無効なポート番号（負数）の場合にinvalid_portエラーを返す", () => {
      const result = parseArgs(
        argv(
          "https://x.com/i/broadcasts/1yKAPMPBOOzxb",
          "--service-id",
          "test-id",
          "--port",
          "-1",
        ),
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("invalid_port");
      }
    });

    it("無効なURL形式の場合にinvalid_urlエラーを返す", () => {
      const result = parseArgs(
        argv(
          "https://example.com/not-a-broadcast",
          "--service-id",
          "test-id",
        ),
      );
      expect(isErr(result)).toBe(true);
      if (isErr(result)) {
        expect(result.error.kind).toBe("invalid_url");
      }
    });
  });
});

describe("formatConfigError", () => {
  it("missing_broadcast_urlエラーに使い方を含むメッセージを返す", () => {
    const error: ConfigError = { kind: "missing_broadcast_url" };
    const msg = formatConfigError(error);
    expect(msg).toContain("ブロードキャストURL");
    expect(msg).toContain("使い方");
  });

  it("missing_service_idエラーに枠IDの説明を含むメッセージを返す", () => {
    const error: ConfigError = { kind: "missing_service_id" };
    const msg = formatConfigError(error);
    expect(msg).toContain("枠ID");
    expect(msg).toContain("--service-id");
  });

  it("invalid_urlエラーにURLを含むメッセージを返す", () => {
    const error: ConfigError = { kind: "invalid_url", url: "bad-url" };
    const msg = formatConfigError(error);
    expect(msg).toContain("bad-url");
  });

  it("invalid_portエラーにポート番号を含むメッセージを返す", () => {
    const error: ConfigError = { kind: "invalid_port", port: "abc" };
    const msg = formatConfigError(error);
    expect(msg).toContain("abc");
  });
});
