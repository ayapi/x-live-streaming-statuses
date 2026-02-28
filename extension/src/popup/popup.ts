import type { ExtensionSettings, StatusResponse } from "../types.js";
import { DEFAULT_SETTINGS } from "../types.js";

const hostInput = document.getElementById("host") as HTMLInputElement;
const portInput = document.getElementById("port") as HTMLInputElement;
const saveBtn = document.getElementById("save-btn") as HTMLButtonElement;
const form = document.getElementById("settings-form") as HTMLFormElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const statusText = document.getElementById("status-text") as HTMLSpanElement;
const viewerCountEl = document.getElementById("viewer-count") as HTMLSpanElement;
const errorMessage = document.getElementById("error-message") as HTMLDivElement;

/** 設定をフォームに反映する */
function populateForm(settings: ExtensionSettings): void {
  hostInput.value = settings.serverHost;
  portInput.value = String(settings.serverPort);
}

/** ステータス表示を更新する */
function updateStatus(response: StatusResponse): void {
  statusEl.className = "status";

  if (response.lastError) {
    statusEl.classList.add("status--error");
    statusText.textContent = "エラー";
    errorMessage.textContent = response.lastError;
    errorMessage.hidden = false;
  } else if (response.isActive) {
    statusEl.classList.add("status--active");
    statusText.textContent = "動作中";
    errorMessage.hidden = true;
  } else {
    statusEl.classList.add("status--inactive");
    statusText.textContent = "停止中";
    errorMessage.hidden = true;
  }

  if (response.viewerCount !== null) {
    viewerCountEl.textContent = `${response.viewerCount}人`;
  } else {
    viewerCountEl.textContent = "";
  }
}

/** 設定を読み込む */
async function loadSettings(): Promise<void> {
  const raw = await chrome.storage.local.get([
    "serverHost",
    "serverPort",
  ]);
  const settings: ExtensionSettings = {
    serverHost:
      typeof raw.serverHost === "string"
        ? raw.serverHost
        : DEFAULT_SETTINGS.serverHost,
    serverPort:
      typeof raw.serverPort === "number"
        ? raw.serverPort
        : DEFAULT_SETTINGS.serverPort,
  };
  populateForm(settings);
}

/** 設定を保存する */
async function saveSettings(): Promise<void> {
  await chrome.storage.local.set({
    serverHost: hostInput.value.trim() || DEFAULT_SETTINGS.serverHost,
    serverPort: Number(portInput.value) || DEFAULT_SETTINGS.serverPort,
  });
}

/** Service Worker からステータスを取得する */
async function fetchStatus(): Promise<void> {
  try {
    const response = await chrome.runtime.sendMessage({ type: "GET_STATUS" });
    if (response?.type === "STATUS") {
      updateStatus(response as StatusResponse);
    }
  } catch {
    /* Service Worker が停止中の場合は無視 */
  }
}

// イベントハンドラ
form.addEventListener("submit", async (e) => {
  e.preventDefault();
  await saveSettings();
  saveBtn.textContent = "保存しました";
  setTimeout(() => {
    saveBtn.textContent = "保存";
  }, 1500);
});

// 初期化
loadSettings();
fetchStatus();
