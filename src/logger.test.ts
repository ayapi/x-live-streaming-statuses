import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createLogger, type Logger } from "./logger.js";

describe("構造化ロガー", () => {
  let originalConsole: {
    log: typeof console.log;
    warn: typeof console.warn;
    error: typeof console.error;
  };

  beforeEach(() => {
    originalConsole = {
      log: console.log,
      warn: console.warn,
      error: console.error,
    };
    console.log = vi.fn();
    console.warn = vi.fn();
    console.error = vi.fn();
  });

  afterEach(() => {
    console.log = originalConsole.log;
    console.warn = originalConsole.warn;
    console.error = originalConsole.error;
  });

  it("createLogger はコンポーネント名付きロガーを返す", () => {
    const logger = createLogger("TestComponent");
    expect(logger).toBeDefined();
    expect(typeof logger.info).toBe("function");
    expect(typeof logger.warn).toBe("function");
    expect(typeof logger.error).toBe("function");
    expect(typeof logger.debug).toBe("function");
  });

  it("info レベルのログを [timestamp] [INFO] [component] message 形式で出力する", () => {
    const logger = createLogger("ChatPoller");
    logger.info("ポーリング開始");

    expect(console.log).toHaveBeenCalledOnce();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toMatch(
      /^\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.\d{3}Z\] \[INFO\] \[ChatPoller\] ポーリング開始$/,
    );
  });

  it("warn レベルのログを出力する", () => {
    const logger = createLogger("Parser");
    logger.warn("JSONパース失敗");

    expect(console.warn).toHaveBeenCalledOnce();
    const output = (console.warn as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toMatch(/\[WARN\] \[Parser\] JSONパース失敗/);
  });

  it("error レベルのログを出力する", () => {
    const logger = createLogger("OneComme");
    logger.error("接続失敗");

    expect(console.error).toHaveBeenCalledOnce();
    const output = (console.error as ReturnType<typeof vi.fn>).mock
      .calls[0][0];
    expect(output).toMatch(/\[ERROR\] \[OneComme\] 接続失敗/);
  });

  it("debug レベルのログを出力する", () => {
    const logger = createLogger("Token");
    logger.debug("トークン有効期限チェック");

    expect(console.log).toHaveBeenCalledOnce();
    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toMatch(/\[DEBUG\] \[Token\] トークン有効期限チェック/);
  });

  it("追加データ付きでログ出力できる", () => {
    const logger = createLogger("Monitor");
    logger.info("統計情報", { comments: 42, errors: 0 });

    const output = (console.log as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(output).toContain("統計情報");
    expect(output).toContain('"comments":42');
  });
});
