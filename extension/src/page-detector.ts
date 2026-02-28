const PRODUCER_BROADCAST_PATTERN =
  /^https:\/\/studio\.x\.com\/producer\/broadcasts\/([A-Za-z0-9_]+)/;

/** URLがMedia Studioの配信詳細ページかどうかを判定する */
export function isProducerPage(url: string): boolean {
  return PRODUCER_BROADCAST_PATTERN.test(url);
}

/** 配信詳細ページURLからブロードキャストIDを抽出する */
export function extractBroadcastId(url: string): string | null {
  const match = url.match(PRODUCER_BROADCAST_PATTERN);
  return match ? match[1] : null;
}
