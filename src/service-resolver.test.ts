import { describe, it, expect, vi, beforeEach } from "vitest";
import { createServiceResolver, formatServiceResolveError } from "./service-resolver.js";
import { isOk, isErr } from "./result.js";
import type { ServiceResolveError } from "./types.js";

describe("ServiceResolver", () => {
  const mockFetch = vi.fn();
  const config = { host: "localhost", port: 11180 };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("完全一致1件の場合にそのサービスIDをOkで返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { id: "uuid-001", name: "テスト枠" },
        { id: "uuid-002", name: "別の枠" },
      ],
    });

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("テスト枠");

    expect(isOk(result)).toBe(true);
    if (isOk(result)) {
      expect(result.value).toBe("uuid-001");
    }
  });

  it("正しいURLでGET /api/servicesを呼び出す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [{ id: "uuid-001", name: "枠" }],
    });

    const resolver = createServiceResolver(config, mockFetch);
    await resolver.resolve("枠");

    expect(mockFetch).toHaveBeenCalledOnce();
    const url = mockFetch.mock.calls[0][0];
    expect(url).toBe("http://localhost:11180/api/services");
  });

  it("一致なしの場合にnot_foundエラーと利用可能サービス名一覧を返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { id: "uuid-001", name: "枠A" },
        { id: "uuid-002", name: "枠B" },
      ],
    });

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("存在しない枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("not_found");
      if (result.error.kind === "not_found") {
        expect(result.error.serviceName).toBe("存在しない枠");
        expect(result.error.availableServices).toEqual(["枠A", "枠B"]);
      }
    }
  });

  it("複数一致の場合にambiguousエラーと該当サービス一覧を返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [
        { id: "uuid-001", name: "同名枠" },
        { id: "uuid-002", name: "同名枠" },
        { id: "uuid-003", name: "別の枠" },
      ],
    });

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("同名枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("ambiguous");
      if (result.error.kind === "ambiguous") {
        expect(result.error.serviceName).toBe("同名枠");
        expect(result.error.matches).toEqual([
          { id: "uuid-001", name: "同名枠" },
          { id: "uuid-002", name: "同名枠" },
        ]);
      }
    }
  });

  it("接続拒否時にconnection_refusedエラーを返す", async () => {
    const connError = new TypeError("fetch failed");
    (connError as NodeJS.ErrnoException).cause = { code: "ECONNREFUSED" };
    mockFetch.mockRejectedValueOnce(connError);

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("テスト枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("connection_refused");
    }
  });

  it("タイムアウト時にtimeoutエラーを返す", async () => {
    const abortError = new DOMException("The operation was aborted", "AbortError");
    mockFetch.mockRejectedValueOnce(abortError);

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("テスト枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("APIエラー（非2xx）時にapi_errorを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
      text: async () => "Server Error",
    });

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("テスト枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(500);
        expect(result.error.message).toBe("Server Error");
      }
    }
  });

  it("空のサービス一覧でnot_foundエラーを返す", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => [],
    });

    const resolver = createServiceResolver(config, mockFetch);
    const result = await resolver.resolve("テスト枠");

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("not_found");
      if (result.error.kind === "not_found") {
        expect(result.error.availableServices).toEqual([]);
      }
    }
  });
});

describe("formatServiceResolveError", () => {
  it("not_foundエラーに指定名と利用可能サービス名一覧を含む", () => {
    const error: ServiceResolveError = {
      kind: "not_found",
      serviceName: "テスト枠",
      availableServices: ["枠A", "枠B"],
    };
    const msg = formatServiceResolveError(error);
    expect(msg).toContain("テスト枠");
    expect(msg).toContain("枠A");
    expect(msg).toContain("枠B");
  });

  it("ambiguousエラーにID一覧と--service-id案内を含む", () => {
    const error: ServiceResolveError = {
      kind: "ambiguous",
      serviceName: "同名枠",
      matches: [
        { id: "uuid-001", name: "同名枠" },
        { id: "uuid-002", name: "同名枠" },
      ],
    };
    const msg = formatServiceResolveError(error);
    expect(msg).toContain("同名枠");
    expect(msg).toContain("uuid-001");
    expect(msg).toContain("uuid-002");
    expect(msg).toContain("--service-id");
  });

  it("connection_refusedエラーにわんコメ起動確認案内を含む", () => {
    const error: ServiceResolveError = { kind: "connection_refused" };
    const msg = formatServiceResolveError(error);
    expect(msg).toContain("わんコメ");
  });

  it("timeoutエラーにタイムアウトメッセージを含む", () => {
    const error: ServiceResolveError = { kind: "timeout" };
    const msg = formatServiceResolveError(error);
    expect(msg).toContain("タイムアウト");
  });

  it("api_errorにステータスコードとメッセージを含む", () => {
    const error: ServiceResolveError = {
      kind: "api_error",
      status: 503,
      message: "Service Unavailable",
    };
    const msg = formatServiceResolveError(error);
    expect(msg).toContain("503");
    expect(msg).toContain("Service Unavailable");
  });
});
