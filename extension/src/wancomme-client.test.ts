import { describe, it, expect, vi, beforeEach } from "vitest";
import { createWancommeClient } from "./wancomme-client.js";

describe("createWancommeClient", () => {
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("PUT /api/services/{serviceId} に正しいペイロードを送信する", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const client = createWancommeClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 42,
    });

    expect(result.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledWith(
      "http://localhost:11180/api/services/x-live-1",
      {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ meta: { viewer: 42 } }),
      },
    );
  });

  it("視聴者数0も正しく送信する", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const client = createWancommeClient(mockFetch);
    await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 0,
    });

    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: JSON.stringify({ meta: { viewer: 0 } }),
      }),
    );
  });

  it("HTTP 404エラー時にエラー結果を返す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
    });

    const client = createWancommeClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "bad-id",
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("api_error");
    }
  });

  it("HTTP 500エラー時にエラー結果を返す", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      status: 500,
      statusText: "Internal Server Error",
    });

    const client = createWancommeClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("api_error");
    }
  });

  it("ネットワークエラー（接続拒否）時にエラー結果を返す", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));

    const client = createWancommeClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("connection_refused");
    }
  });

  it("タイムアウトエラー時にエラー結果を返す", async () => {
    mockFetch.mockRejectedValue(new DOMException("Aborted", "AbortError"));

    const client = createWancommeClient(mockFetch);
    const result = await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 10,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("timeout");
    }
  });

  it("POST /api/comments ではなく PUT /api/services を使用する", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 200 });

    const client = createWancommeClient(mockFetch);
    await client.sendViewerCount({
      host: "localhost",
      port: 11180,
      serviceId: "x-live-1",
      viewerCount: 5,
    });

    const [url, options] = mockFetch.mock.calls[0];
    expect(url).not.toContain("/api/comments");
    expect(url).toContain("/api/services/");
    expect(options.method).toBe("PUT");
  });
});
