import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBadgeController } from "./badge-controller.js";

describe("createBadgeController", () => {
  const mockAction = {
    setBadgeText: vi.fn().mockResolvedValue(undefined),
    setBadgeBackgroundColor: vi.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    vi.resetAllMocks();
  });

  it("動作中は緑背景で視聴者数を表示する", async () => {
    const badge = createBadgeController(mockAction);
    await badge.showViewerCount(42, false);

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "42" });
    expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#4CAF50",
    });
  });

  it("わんコメエラー時は赤背景で視聴者数を表示する", async () => {
    const badge = createBadgeController(mockAction);
    await badge.showViewerCount(42, true);

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "42" });
    expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#F44336",
    });
  });

  it("設定未完了時はグレー背景で!を表示する", async () => {
    const badge = createBadgeController(mockAction);
    await badge.showConfigRequired();

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "!" });
    expect(mockAction.setBadgeBackgroundColor).toHaveBeenCalledWith({
      color: "#9E9E9E",
    });
  });

  it("停止時はバッジをクリアする", async () => {
    const badge = createBadgeController(mockAction);
    await badge.clear();

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "" });
  });

  it("大きい数値はフォーマットされる", async () => {
    const badge = createBadgeController(mockAction);
    await badge.showViewerCount(1234, false);

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "1.2k" });
  });

  it("視聴者数0も表示する", async () => {
    const badge = createBadgeController(mockAction);
    await badge.showViewerCount(0, false);

    expect(mockAction.setBadgeText).toHaveBeenCalledWith({ text: "0" });
  });
});
