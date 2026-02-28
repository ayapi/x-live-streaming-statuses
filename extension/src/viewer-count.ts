import type { LiveViewersResponse } from "./types.js";

/** ts 配列末尾から現在の同時視聴者数を抽出する */
export function extractCurrentViewerCount(
  response: LiveViewersResponse,
): number | null {
  if (response.ts.length === 0) return null;
  return response.ts[response.ts.length - 1];
}

/** 視聴者数をバッジ表示用にフォーマットする（最大4文字） */
export function formatViewerCount(count: number): string {
  if (count >= 9950) return `${Math.round(count / 1000)}k`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}
