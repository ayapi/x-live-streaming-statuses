import { describe, it, expect } from "vitest";
import { isProducerPage, extractBroadcastId } from "./page-detector.js";

describe("isProducerPage", () => {
  it("配信詳細ページのURLをtrueと判定する", () => {
    expect(
      isProducerPage(
        "https://studio.x.com/producer/broadcasts/1yKAPMPBOOzxb",
      ),
    ).toBe(true);
  });

  it("配信詳細ページのURLをサブパス付きでもtrueと判定する", () => {
    expect(
      isProducerPage(
        "https://studio.x.com/producer/broadcasts/1yKAPMPBOOzxb/details",
      ),
    ).toBe(true);
  });

  it("Media Studioのトップページはfalseと判定する", () => {
    expect(isProducerPage("https://studio.x.com/producer")).toBe(false);
  });

  it("Media Studioの配信一覧はfalseと判定する", () => {
    expect(isProducerPage("https://studio.x.com/producer/broadcasts")).toBe(
      false,
    );
  });

  it("別ドメインはfalseと判定する", () => {
    expect(
      isProducerPage("https://x.com/producer/broadcasts/1yKAPMPBOOzxb"),
    ).toBe(false);
  });

  it("空文字はfalseと判定する", () => {
    expect(isProducerPage("")).toBe(false);
  });
});

describe("extractBroadcastId", () => {
  it("配信詳細ページURLからブロードキャストIDを抽出する", () => {
    expect(
      extractBroadcastId(
        "https://studio.x.com/producer/broadcasts/1yKAPMPBOOzxb",
      ),
    ).toBe("1yKAPMPBOOzxb");
  });

  it("サブパス付きURLからもブロードキャストIDを抽出する", () => {
    expect(
      extractBroadcastId(
        "https://studio.x.com/producer/broadcasts/1yKAPMPBOOzxb/details",
      ),
    ).toBe("1yKAPMPBOOzxb");
  });

  it("配信一覧URLからはnullを返す", () => {
    expect(
      extractBroadcastId("https://studio.x.com/producer/broadcasts"),
    ).toBeNull();
  });

  it("無関係なURLからはnullを返す", () => {
    expect(extractBroadcastId("https://example.com")).toBeNull();
  });
});
