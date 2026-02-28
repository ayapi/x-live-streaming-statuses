import { describe, it, expect, afterEach } from "vitest";
import { createViewerCountServer } from "./viewer-count-server.js";

// テスト用のポート取得（競合回避のためランダムポート）
let servers: Array<{ stop(): Promise<void> }> = [];

afterEach(async () => {
  for (const server of servers) {
    await server.stop();
  }
  servers = [];
});

function trackServer(server: ReturnType<typeof createViewerCountServer>) {
  servers.push(server);
  return server;
}

describe("ViewerCountServer", () => {
  describe("起動・停止", () => {
    it("start() でサーバーが起動し stop() で停止する", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      // サーバーが起動していることを確認（GETリクエストが成功する）
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`);
      expect(res.ok).toBe(true);
      await server.stop();
    });

    it("初期状態で getViewerCount() は null を返す", () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      expect(server.getViewerCount()).toBeNull();
    });
  });

  describe("CORS ヘッダ", () => {
    it("すべてのレスポンスに CORS ヘッダが付与される", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`);
      expect(res.headers.get("access-control-allow-origin")).toBe("*");
      expect(res.headers.get("access-control-allow-methods")).toBe(
        "GET, POST, OPTIONS",
      );
      expect(res.headers.get("access-control-allow-headers")).toBe(
        "Content-Type",
      );
    });

    it("OPTIONS リクエストに 204 で応答する", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "OPTIONS",
      });
      expect(res.status).toBe(204);
    });
  });

  describe("POST /api/viewer-count", () => {
    it("正常な POST で内部状態が更新され 204 を返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerCount: 42 }),
      });
      expect(res.status).toBe(204);
      expect(server.getViewerCount()).toBe(42);
    });

    it("不正な JSON ボディで 400 を返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "not json",
      });
      expect(res.status).toBe(400);
    });

    it("viewerCount が数値でない場合に 400 を返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerCount: "abc" }),
      });
      expect(res.status).toBe(400);
    });
  });

  describe("GET /api/viewer-count", () => {
    it("初期状態で null を含むレスポンスを返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`);
      const body = await res.json();
      expect(body).toEqual({ viewerCount: null, updatedAt: null });
    });

    it("POST 後に最新の視聴者数を返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();

      await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerCount: 100 }),
      });

      const res = await fetch(`http://127.0.0.1:${port}/api/viewer-count`);
      const body = await res.json();
      expect(body.viewerCount).toBe(100);
      expect(body.updatedAt).toBeTruthy();
      // updatedAt は ISO 8601 形式
      expect(new Date(body.updatedAt).toISOString()).toBe(body.updatedAt);
    });

    it("連続 GET で安定して応答する", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();

      await fetch(`http://127.0.0.1:${port}/api/viewer-count`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ viewerCount: 50 }),
      });

      const results = await Promise.all(
        Array.from({ length: 10 }, () =>
          fetch(`http://127.0.0.1:${port}/api/viewer-count`).then((r) =>
            r.json(),
          ),
        ),
      );

      for (const body of results) {
        expect(body.viewerCount).toBe(50);
      }
    });
  });

  describe("未知のエンドポイント", () => {
    it("未知のパスに 404 を返す", async () => {
      const server = trackServer(createViewerCountServer({ port: 0 }));
      await server.start();
      const port = server.port();
      const res = await fetch(`http://127.0.0.1:${port}/unknown`);
      expect(res.status).toBe(404);
    });
  });
});
