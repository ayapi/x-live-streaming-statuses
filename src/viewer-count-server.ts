import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createLogger } from "./logger.js";

const logger = createLogger("ViewerCount");

export interface ViewerCountServer {
  /** サーバーを起動する */
  start(): Promise<void>;
  /** サーバーを停止する（グレースフルシャットダウン） */
  stop(): Promise<void>;
  /** 現在の視聴者数を取得する */
  getViewerCount(): number | null;
  /** 実際にバインドされたポートを返す */
  port(): number;
}

interface ViewerCountServerConfig {
  port: number;
}

const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function createViewerCountServer(
  config: ViewerCountServerConfig,
): ViewerCountServer {
  let viewerCount: number | null = null;
  let updatedAt: string | null = null;

  function setCorsHeaders(res: ServerResponse): void {
    for (const [key, value] of Object.entries(CORS_HEADERS)) {
      res.setHeader(key, value);
    }
  }

  function readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => resolve(Buffer.concat(chunks).toString()));
      req.on("error", reject);
    });
  }

  async function handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
  ): Promise<void> {
    setCorsHeaders(res);

    const { method, url } = req;

    // OPTIONS preflight
    if (method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (url !== "/api/viewer-count") {
      res.writeHead(404, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Not Found" }));
      return;
    }

    if (method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ viewerCount, updatedAt }));
      return;
    }

    if (method === "POST") {
      try {
        const body = await readBody(req);
        const parsed = JSON.parse(body);
        if (typeof parsed.viewerCount !== "number") {
          res.writeHead(400, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ error: "viewerCount must be a number" }));
          return;
        }
        viewerCount = parsed.viewerCount;
        updatedAt = new Date().toISOString();
        res.writeHead(204);
        res.end();
      } catch {
        res.writeHead(400, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid JSON" }));
      }
      return;
    }

    res.writeHead(405, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Method Not Allowed" }));
  }

  const server = createServer((req, res) => {
    handleRequest(req, res).catch((e) => {
      const message = e instanceof Error ? e.message : String(e);
      logger.error("リクエスト処理中にエラー:", { error: message });
      if (!res.headersSent) {
        res.writeHead(500);
        res.end();
      }
    });
  });

  return {
    start(): Promise<void> {
      return new Promise((resolve, reject) => {
        server.on("error", reject);
        server.listen(config.port, "127.0.0.1", () => {
          const addr = server.address();
          const boundPort =
            addr && typeof addr !== "string" ? addr.port : config.port;
          logger.info(`視聴者数サーバーを起動しました: http://127.0.0.1:${boundPort}`);
          resolve();
        });
      });
    },

    stop(): Promise<void> {
      return new Promise((resolve) => {
        server.closeAllConnections();
        server.close(() => {
          logger.info("視聴者数サーバーを停止しました");
          resolve();
        });
      });
    },

    getViewerCount(): number | null {
      return viewerCount;
    },

    port(): number {
      const addr = server.address();
      if (addr && typeof addr !== "string") {
        return addr.port;
      }
      return config.port;
    },
  };
}
