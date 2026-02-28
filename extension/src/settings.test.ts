import { describe, it, expect, vi, beforeEach } from "vitest";
import { createSettingsStore } from "./settings.js";
import { DEFAULT_SETTINGS, INITIAL_SESSION_STATE } from "./types.js";

describe("createSettingsStore", () => {
  const mockStorage = {
    local: {
      get: vi.fn(),
      set: vi.fn(),
    },
    session: {
      get: vi.fn(),
      set: vi.fn(),
    },
    onChanged: {
      addListener: vi.fn(),
    },
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("loadSettings", () => {
    it("保存済みの設定を読み込む", async () => {
      mockStorage.local.get.mockResolvedValue({
        serverHost: "192.168.1.10",
        serverPort: 8080,
      });

      const store = createSettingsStore(mockStorage);
      const settings = await store.loadSettings();

      expect(settings).toEqual({
        serverHost: "192.168.1.10",
        serverPort: 8080,
      });
    });

    it("未保存時はデフォルト値を返す", async () => {
      mockStorage.local.get.mockResolvedValue({});

      const store = createSettingsStore(mockStorage);
      const settings = await store.loadSettings();

      expect(settings).toEqual(DEFAULT_SETTINGS);
    });

    it("部分的な設定はデフォルト値でマージする", async () => {
      mockStorage.local.get.mockResolvedValue({
        serverPort: 9999,
      });

      const store = createSettingsStore(mockStorage);
      const settings = await store.loadSettings();

      expect(settings).toEqual({
        serverHost: "localhost",
        serverPort: 9999,
      });
    });
  });

  describe("saveSettings", () => {
    it("設定をchrome.storage.localに保存する", async () => {
      mockStorage.local.set.mockResolvedValue(undefined);

      const store = createSettingsStore(mockStorage);
      await store.saveSettings({
        serverHost: "localhost",
        serverPort: 11190,
      });

      expect(mockStorage.local.set).toHaveBeenCalledWith({
        serverHost: "localhost",
        serverPort: 11190,
      });
    });
  });

  describe("loadSessionState", () => {
    it("セッション状態を読み込む", async () => {
      mockStorage.session.get.mockResolvedValue({
        isActive: true,
        mediaKey: "28_123",
        ownerId: "456",
        currentViewerCount: 42,
        lastError: null,
        activeTabId: 1,
      });

      const store = createSettingsStore(mockStorage);
      const state = await store.loadSessionState();

      expect(state.isActive).toBe(true);
      expect(state.currentViewerCount).toBe(42);
    });

    it("未保存時は初期状態を返す", async () => {
      mockStorage.session.get.mockResolvedValue({});

      const store = createSettingsStore(mockStorage);
      const state = await store.loadSessionState();

      expect(state).toEqual(INITIAL_SESSION_STATE);
    });
  });

  describe("saveSessionState", () => {
    it("セッション状態をchrome.storage.sessionに保存する", async () => {
      mockStorage.session.set.mockResolvedValue(undefined);

      const store = createSettingsStore(mockStorage);
      await store.saveSessionState({
        isActive: true,
        mediaKey: "28_123",
        ownerId: "456",
        currentViewerCount: 42,
        lastError: null,
        activeTabId: 1,
      });

      expect(mockStorage.session.set).toHaveBeenCalledWith({
        isActive: true,
        mediaKey: "28_123",
        ownerId: "456",
        currentViewerCount: 42,
        lastError: null,
        activeTabId: 1,
      });
    });
  });
});
