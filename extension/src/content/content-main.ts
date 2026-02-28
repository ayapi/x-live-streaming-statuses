/** MAIN world Content Script: live_viewers.json を能動的にフェッチし、
 * XHR/fetch インターセプトでもデータを取得する */

const MESSAGE_TYPE = "X_LIVE_VIEWER_DATA";
const POLL_INTERVAL_MS = 30_000;
const BROADCAST_URL_PATTERN = /\/producer\/broadcasts\/([A-Za-z0-9_]+)/;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
/** XHR インターセプトで学習した live_viewers.json の完全 URL */
let capturedViewerUrl: string | null = null;
/** XHR インターセプトで取得した media_key */
let resolvedMediaKey: string | null = null;

// ── Cookie ヘルパー ──

function getCookie(name: string): string | null {
  const match = document.cookie.match(
    new RegExp(`(?:^|;\\s*)${name}=([^;]*)`),
  );
  return match ? decodeURIComponent(match[1]) : null;
}

function extractOwnerIdFromCookie(): string | null {
  const twid = getCookie("twid");
  if (!twid) return null;
  // twid format: u%3D{id} → decoded to u={id}
  const match = twid.match(/u=(\d+)/);
  return match ? match[1] : null;
}

// ── XHR インターセプト（live_viewers.json の URL を学習 + データ転送） ──

const OrigXHR = window.XMLHttpRequest;
const origOpen = OrigXHR.prototype.open;
const origSend = OrigXHR.prototype.send;

OrigXHR.prototype.open = function (
  this: XMLHttpRequest & { __xUrl?: string },
  method: string,
  url: string | URL,
  async?: boolean,
  user?: string | null,
  password?: string | null,
): void {
  this.__xUrl = String(url);
  origOpen.call(
    this,
    method,
    url,
    async ?? true,
    user ?? null,
    password ?? null,
  );
};

OrigXHR.prototype.send = function (
  this: XMLHttpRequest & { __xUrl?: string },
  body?: Document | XMLHttpRequestBodyInit | null,
): void {
  const url = this.__xUrl;
  if (url) {
    // live_viewers.json のレスポンスを傍受
    if (url.includes("live_viewers.json")) {
      console.log("[MAIN] XHR intercepted live_viewers.json:", url);
      capturedViewerUrl = url.startsWith("http")
        ? url
        : new URL(url, location.origin).href;
      this.addEventListener("load", function () {
        try {
          const data: unknown = JSON.parse(this.responseText);
          console.log("[MAIN] XHR viewer data:", data);
          window.postMessage({ type: MESSAGE_TYPE, data }, "*");
        } catch {
          /* parse error ignored */
        }
      });
    }
    // broadcasts 関連レスポンスから media_key を抽出
    if (url.includes("broadcasts") && !resolvedMediaKey) {
      this.addEventListener("load", function () {
        try {
          const data = JSON.parse(this.responseText) as Record<
            string,
            unknown
          >;
          if (
            data?.broadcasts &&
            typeof data.broadcasts === "object" &&
            data.broadcasts !== null
          ) {
            const bObj = data.broadcasts as Record<
              string,
              { media_key?: string }
            >;
            const keys = Object.keys(bObj);
            if (keys.length > 0 && bObj[keys[0]]?.media_key) {
              resolvedMediaKey = bObj[keys[0]].media_key!;
              console.log(
                "[MAIN] Captured media_key from XHR:",
                resolvedMediaKey,
              );
            }
          }
          if (
            !resolvedMediaKey &&
            typeof (data as { media_key?: string }).media_key === "string"
          ) {
            resolvedMediaKey = (data as { media_key: string }).media_key;
            console.log(
              "[MAIN] Captured media_key from response:",
              resolvedMediaKey,
            );
          }
        } catch {
          /* parse error ignored */
        }
      });
    }
  }
  origSend.call(this, body);
};

// ── fetch インターセプト（念のため） ──

const originalFetch = window.fetch;
window.fetch = async function (
  ...args: Parameters<typeof fetch>
): ReturnType<typeof fetch> {
  const response = await originalFetch.apply(this, args);
  try {
    const url =
      typeof args[0] === "string" ? args[0] : (args[0] as Request)?.url ?? "";
    if (url.includes("live_viewers.json")) {
      console.log("[MAIN] fetch intercepted live_viewers.json:", url);
      capturedViewerUrl = url;
      const clone = response.clone();
      clone
        .json()
        .then((data: unknown) => {
          console.log("[MAIN] fetch viewer data:", data);
          window.postMessage({ type: MESSAGE_TYPE, data }, "*");
        })
        .catch(() => {
          /* ignore */
        });
    }
  } catch {
    /* ignore */
  }
  return response;
};

// ── 能動的フェッチ ──

async function fetchViewerData(
  mediaKey: string,
  ownerId: string,
): Promise<void> {
  const ct0 = getCookie("ct0");
  if (!ct0) {
    console.warn("[MAIN] ct0 cookie not found, skipping fetch");
    return;
  }

  // キャプチャ済み URL があればそれを優先使用
  let url: string;
  if (capturedViewerUrl) {
    url = capturedViewerUrl;
  } else {
    url = `https://studio.x.com/1/analytics/broadcast/live_viewers.json?media_key=${encodeURIComponent(mediaKey)}&owner_id=${encodeURIComponent(ownerId)}&user_id=${encodeURIComponent(ownerId)}`;
  }

  console.log("[MAIN] Fetching:", url);

  try {
    const response = await originalFetch(url, {
      credentials: "include",
      headers: {
        "x-csrf-token": ct0,
      },
    });

    if (!response.ok) {
      console.warn(
        "[MAIN] live_viewers.json:",
        response.status,
        response.statusText,
      );
      return;
    }

    const data: unknown = await response.json();
    console.log("[MAIN] Viewer data:", data);
    window.postMessage({ type: MESSAGE_TYPE, data }, "*");
  } catch (e) {
    console.warn("[MAIN] live_viewers.json fetch error:", e);
  }
}

// ── media_key 解決（api.x.com の公開 API） ──

async function resolveMediaKeyFromApi(
  broadcastId: string,
): Promise<string | null> {
  try {
    const url = `https://api.x.com/1.1/broadcasts/show.json?ids=${broadcastId}&include_events=false`;
    console.log("[MAIN] Resolving media_key via:", url);
    const response = await originalFetch(url);
    if (!response.ok) {
      console.warn("[MAIN] broadcasts/show.json:", response.status);
      return null;
    }
    const data = (await response.json()) as {
      broadcasts?: Record<string, { media_key?: string }>;
    };
    const broadcast = data?.broadcasts?.[broadcastId];
    return broadcast?.media_key ?? null;
  } catch (e) {
    console.warn("[MAIN] broadcasts/show.json error (CORS?):", e);
    return null;
  }
}

// ── メイン処理 ──

async function init(): Promise<void> {
  console.log("[MAIN] Content script loaded on:", location.href);

  const match = location.pathname.match(BROADCAST_URL_PATTERN);
  if (!match) {
    console.log("[MAIN] Not a broadcast page — interception only mode");
    return;
  }
  const broadcastId = match[1];

  const ownerId = extractOwnerIdFromCookie();
  console.log("[MAIN] broadcastId:", broadcastId, "ownerId:", ownerId);

  if (!ownerId) {
    const hasTwid = getCookie("twid");
    console.warn(
      "[MAIN] Could not extract owner_id.",
      hasTwid ? "twid cookie exists but unparseable" : "twid cookie missing (HttpOnly?)",
    );
    console.log("[MAIN] Falling back to XHR interception only");
    return;
  }

  // media_key を解決
  let mediaKey = await resolveMediaKeyFromApi(broadcastId);
  if (mediaKey) {
    resolvedMediaKey = mediaKey;
    console.log("[MAIN] media_key resolved:", mediaKey);
  } else {
    mediaKey = broadcastId;
    console.log(
      "[MAIN] Could not resolve media_key, using broadcastId as fallback:",
      mediaKey,
    );
  }

  // 即座に1回フェッチ
  console.log(
    "[MAIN] Starting polling every",
    POLL_INTERVAL_MS / 1000,
    "seconds",
  );
  await fetchViewerData(mediaKey, ownerId);

  // 定期フェッチ
  pollingTimer = setInterval(() => {
    const key = resolvedMediaKey ?? mediaKey!;
    fetchViewerData(key, ownerId);
  }, POLL_INTERVAL_MS);
}

window.addEventListener("beforeunload", () => {
  if (pollingTimer !== null) {
    clearInterval(pollingTimer);
    pollingTimer = null;
    console.log("[MAIN] Polling stopped");
  }
});

init();
