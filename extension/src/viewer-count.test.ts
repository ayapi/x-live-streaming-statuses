import { describe, it, expect } from "vitest";
import { extractCurrentViewerCount, formatViewerCount } from "./viewer-count.js";

describe("extractCurrentViewerCount", () => {
  it("ts配列の末尾要素を返す", () => {
    expect(
      extractCurrentViewerCount({
        media_key: "28_123",
        bucket_size: 60,
        ts: [4, 3, 4, 6, 8, 8, 6, 7],
      }),
    ).toBe(7);
  });

  it("要素が1つの場合はその値を返す", () => {
    expect(
      extractCurrentViewerCount({
        media_key: "28_123",
        bucket_size: 60,
        ts: [42],
      }),
    ).toBe(42);
  });

  it("ts配列が空の場合はnullを返す", () => {
    expect(
      extractCurrentViewerCount({
        media_key: "28_123",
        bucket_size: 60,
        ts: [],
      }),
    ).toBeNull();
  });

  it("視聴者数0も正しく返す", () => {
    expect(
      extractCurrentViewerCount({
        media_key: "28_123",
        bucket_size: 60,
        ts: [5, 3, 0],
      }),
    ).toBe(0);
  });
});

describe("formatViewerCount", () => {
  it("1000未満はそのまま文字列にする", () => {
    expect(formatViewerCount(0)).toBe("0");
    expect(formatViewerCount(1)).toBe("1");
    expect(formatViewerCount(42)).toBe("42");
    expect(formatViewerCount(999)).toBe("999");
  });

  it("1000以上10000未満は小数点1桁のk表記にする", () => {
    expect(formatViewerCount(1000)).toBe("1.0k");
    expect(formatViewerCount(1234)).toBe("1.2k");
    expect(formatViewerCount(5678)).toBe("5.7k");
    expect(formatViewerCount(9999)).toBe("10k");
  });

  it("10000以上は整数のk表記にする", () => {
    expect(formatViewerCount(10000)).toBe("10k");
    expect(formatViewerCount(15000)).toBe("15k");
    expect(formatViewerCount(99999)).toBe("100k");
  });

  it("結果は常に4文字以内である", () => {
    const testValues = [0, 1, 42, 999, 1000, 1234, 9999, 10000, 99999];
    for (const v of testValues) {
      expect(formatViewerCount(v).length).toBeLessThanOrEqual(4);
    }
  });
});
