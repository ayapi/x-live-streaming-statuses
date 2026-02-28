import { describe, it, expect, vi, beforeEach } from "vitest";
import { createViewerCountClient } from "./viewer-count-client.js";

describe("createViewerCountClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("POST /api/viewer-count に正しいペイロードを送信する", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const client = createViewerCountClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 42,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11190/api/viewer-count",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerCount: 42 }),
      },
    );
  });

  it("視聴者数0も正しく送信する", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const client = createViewerCountClient(mockFetch);
    await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 0,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ viewerCount: 0 }),
      }),
    );
  });

  it("HTTP 400エラー時にエラー結果を返す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 400,
      statusText: "Bad Request",
    });

    const client = createViewerCountClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("api_error");
      if (result.error.kind === "api_error") {
        expect(result.error.status).toBe(400);
      }
    }
  });

  it("ネットワークエラー（接続拒否）時にエラー結果を返す", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const client = createViewerCountClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("connection_refused");
    }
  });

  it("タイムアウトエラー時にエラー結果を返す", async () => {
    mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const client = createViewerCountClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("POST メソッドを使用する（PUT ではない）", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 });

    const client = createViewerCountClient(mockFetch);
    await client.sendViewerCount({
      host: "localhost",
      port: 11190,
      viewerCount: 5,
    });

    const [, options] = mockFetch.mock.calls[0];
    expect(options.method).toBe("POST");
  });
});
