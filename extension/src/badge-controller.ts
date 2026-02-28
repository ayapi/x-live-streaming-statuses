import { formatViewerCount } from "./viewer-count.js";

const COLOR_ACTIVE = "#4CAF50";
const COLOR_ERROR = "#F44336";
const COLOR_CONFIG_REQUIRED = "#9E9E9E";

interface ChromeActionAPI {
  setBadgeText(details: { text: string }): Promise<void>;
  setBadgeBackgroundColor(details: { color: string }): Promise<void>;
}

export interface BadgeController {
  showViewerCount(count: number, hasError: boolean): Promise<void>;
  showConfigRequired(): Promise<void>;
  clear(): Promise<void>;
}

export function createBadgeController(
  action: ChromeActionAPI = chrome.action,
): BadgeController {
  return {
    async showViewerCount(count: number, hasError: boolean): Promise<void> {
      await action.setBadgeText({ text: formatViewerCount(count) });
      await action.setBadgeBackgroundColor({
        color: hasError ? COLOR_ERROR : COLOR_ACTIVE,
      });
    },

    async showConfigRequired(): Promise<void> {
      await action.setBadgeText({ text: "!" });
      await action.setBadgeBackgroundColor({ color: COLOR_CONFIG_REQUIRED });
    },

    async clear(): Promise<void> {
      await action.setBadgeText({ text: "" });
    },
  };
}
