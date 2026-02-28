import type { ExtensionSettings, SessionState } from "./types.js";
import { DEFAULT_SETTINGS, INITIAL_SESSION_STATE } from "./types.js";

interface ChromeStorageAPI {
  local: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  session: {
    get(keys: string[]): Promise<Record<string, unknown>>;
    set(items: Record<string, unknown>): Promise<void>;
  };
  onChanged: {
    addListener(
      callback: (
        changes: Record<string, chrome.storage.StorageChange>,
        areaName: string,
      ) => void,
    ): void;
  };
}

export interface SettingsStore {
  loadSettings(): Promise<ExtensionSettings>;
  saveSettings(settings: ExtensionSettings): Promise<void>;
  loadSessionState(): Promise<SessionState>;
  saveSessionState(state: SessionState): Promise<void>;
  onSettingsChanged(callback: (settings: ExtensionSettings) => void): void;
}

export function createSettingsStore(
  storage: ChromeStorageAPI = chrome.storage,
): SettingsStore {
  return {
    async loadSettings(): Promise<ExtensionSettings> {
      const raw = await storage.local.get([
        "serverHost",
        "serverPort",
      ]);
      return {
        serverHost:
          typeof raw.serverHost === "string"
            ? raw.serverHost
            : DEFAULT_SETTINGS.serverHost,
        serverPort:
          typeof raw.serverPort === "number"
            ? raw.serverPort
            : DEFAULT_SETTINGS.serverPort,
      };
    },

    async saveSettings(settings: ExtensionSettings): Promise<void> {
      await storage.local.set({ ...settings });
    },

    async loadSessionState(): Promise<SessionState> {
      const keys = Object.keys(INITIAL_SESSION_STATE);
      const raw = await storage.session.get(keys);
      return {
        isActive:
          typeof raw.isActive === "boolean"
            ? raw.isActive
            : INITIAL_SESSION_STATE.isActive,
        mediaKey:
          typeof raw.mediaKey === "string" ? raw.mediaKey : null,
        ownerId:
          typeof raw.ownerId === "string" ? raw.ownerId : null,
        currentViewerCount:
          typeof raw.currentViewerCount === "number"
            ? raw.currentViewerCount
            : null,
        lastError:
          typeof raw.lastError === "string" ? raw.lastError : null,
        activeTabId:
          typeof raw.activeTabId === "number" ? raw.activeTabId : null,
      };
    },

    async saveSessionState(state: SessionState): Promise<void> {
      await storage.session.set({ ...state });
    },

    onSettingsChanged(callback: (settings: ExtensionSettings) => void): void {
      storage.onChanged.addListener((changes, areaName) => {
        if (areaName !== "local") return;
        if (
          changes.serverHost ||
          changes.serverPort
        ) {
          this.loadSettings().then(callback);
        }
      });
    },
  };
}
