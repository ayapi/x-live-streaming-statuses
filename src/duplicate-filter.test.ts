import { describe, it, expect } from "vitest";
import { createDuplicateFilter } from "./duplicate-filter.js";

describe("DuplicateFilter", () => {
  it("新規UUIDは重複でないと判定する", () => {
    const filter = createDuplicateFilter();

    expect(filter.isDuplicate("uuid-001")).toBe(false);
    expect(filter.isDuplicate("uuid-002")).toBe(false);
  });

  it("markSent後は重複と判定する", () => {
    const filter = createDuplicateFilter();

    filter.markSent("uuid-001");
    expect(filter.isDuplicate("uuid-001")).toBe(true);
  });

  it("markSentしていないIDは重複でないと判定する", () => {
    const filter = createDuplicateFilter();

    filter.markSent("uuid-001");
    expect(filter.isDuplicate("uuid-002")).toBe(false);
  });

  it("size()は送信済みIDの数を返す", () => {
    const filter = createDuplicateFilter();

    expect(filter.size()).toBe(0);
    filter.markSent("uuid-001");
    expect(filter.size()).toBe(1);
    filter.markSent("uuid-002");
    expect(filter.size()).toBe(2);
  });

  it("同じIDを複数回markSentしてもサイズは増えない", () => {
    const filter = createDuplicateFilter();

    filter.markSent("uuid-001");
    filter.markSent("uuid-001");
    filter.markSent("uuid-001");
    expect(filter.size()).toBe(1);
  });

  it("サイズ上限を超えた場合、最も古いエントリから削除する", () => {
    const maxSize = 5;
    const filter = createDuplicateFilter(maxSize);

    // 5件追加（上限まで）
    for (let i = 1; i <= 5; i++) {
      filter.markSent(`uuid-${i}`);
    }
    expect(filter.size()).toBe(5);

    // 6件目を追加 → 最も古い uuid-1 が削除される
    filter.markSent("uuid-6");
    expect(filter.size()).toBe(5);
    expect(filter.isDuplicate("uuid-1")).toBe(false); // 削除済み
    expect(filter.isDuplicate("uuid-2")).toBe(true); // まだ存在
    expect(filter.isDuplicate("uuid-6")).toBe(true); // 新しく追加
  });

  it("デフォルト上限は10,000件である", () => {
    const filter = createDuplicateFilter();
    // デフォルト上限の確認（大量追加テスト）
    for (let i = 1; i <= 10001; i++) {
      filter.markSent(`uuid-${i}`);
    }
    expect(filter.size()).toBe(10000);
    expect(filter.isDuplicate("uuid-1")).toBe(false); // 最古が削除
    expect(filter.isDuplicate("uuid-2")).toBe(true); // まだ存在
    expect(filter.isDuplicate("uuid-10001")).toBe(true); // 最新
  });

  it("上限超過時に複数のエントリが削除される", () => {
    const maxSize = 3;
    const filter = createDuplicateFilter(maxSize);

    filter.markSent("a");
    filter.markSent("b");
    filter.markSent("c");
    filter.markSent("d"); // a削除
    filter.markSent("e"); // b削除

    expect(filter.size()).toBe(3);
    expect(filter.isDuplicate("a")).toBe(false);
    expect(filter.isDuplicate("b")).toBe(false);
    expect(filter.isDuplicate("c")).toBe(true);
    expect(filter.isDuplicate("d")).toBe(true);
    expect(filter.isDuplicate("e")).toBe(true);
  });
});
