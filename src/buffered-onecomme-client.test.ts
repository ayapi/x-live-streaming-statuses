import { describe, it, expect, vi, beforeEach } from "vitest";
import { createBufferedOneCommeClient } from "./buffered-onecomme-client.js";
import type { OneCommeClient } from "./onecomme-client.js";
import { ok, err, isOk, isErr } from "./result.js";
import type { ParsedComment, SendError } from "./types.js";
import type { Result } from "./result.js";

function makeParsedComment(
  overrides: Partial<ParsedComment> = {},
): ParsedComment {
  return {
    id: "msg-uuid-001",
    userId: "999888777",
    username: "testuser",
    displayName: "テストユーザー",
    comment: "こんにちは",
    profileImage: "https://pbs.twimg.com/profile_images/123/photo.jpg",
    timestamp: 1709000000000,
    verified: false,
    lang: "ja",
    ...overrides,
  };
}

function createMockClient() {
  const sendFn = vi.fn<
    [ParsedComment],
    Promise<Result<void, SendError>>
  >();
  const client: OneCommeClient = { send: sendFn };
  return { client, sendFn };
}

/** テスト用の即座に解決するdelay */
const instantDelay = () => Promise.resolve();

describe("BufferedOneCommeClient - リトライ", () => {
  let mockSend: ReturnType<typeof createMockClient>["sendFn"];
  let mockClient: OneCommeClient;

  beforeEach(() => {
    const mock = createMockClient();
    mockSend = mock.sendFn;
    mockClient = mock.client;
  });

  it("送信成功時はリトライせずにok結果を返す", async () => {
    mockSend.mockResolvedValueOnce(ok(undefined));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    const result = await buffered.send(makeParsedComment());

    expect(isOk(result)).toBe(true);
    expect(mockSend).toHaveBeenCalledOnce();
  });

  it("送信失敗時に最大3回リトライする", async () => {
    mockSend
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "error" }))
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "error" }))
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "error" }))
      .mockResolvedValueOnce(ok(undefined)); // 4回目は呼ばれない

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    const result = await buffered.send(makeParsedComment());

    // 初回 + 3回リトライ = 合計4回呼ばれるが、maxRetries=3なので初回+3=4回
    // 仕様: "最大3回リトライ" = 初回1回 + リトライ3回 = 合計4回
    // いや、"最大3回リトライ"の通常の解釈は初回含め3回
    // design: 指数バックオフ（1秒→2秒→4秒）で最大3回 = 3回のリトライ
    // 初回送信が失敗 → リトライ1(1秒後) → リトライ2(2秒後) → リトライ3(4秒後)
    // = 初回 + 3リトライ = 合計4回の送信試行
    expect(mockSend).toHaveBeenCalledTimes(4);
  });

  it("リトライ中に成功した場合はok結果を返す", async () => {
    mockSend
      .mockResolvedValueOnce(err({ kind: "connection_refused" }))
      .mockResolvedValueOnce(ok(undefined));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    const result = await buffered.send(makeParsedComment());

    expect(isOk(result)).toBe(true);
    expect(mockSend).toHaveBeenCalledTimes(2);
  });

  it("リトライ時に指数バックオフの間隔で待機する", async () => {
    const delays: number[] = [];
    const trackingDelay = (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    };

    mockSend
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "err" }))
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "err" }))
      .mockResolvedValueOnce(err({ kind: "api_error", status: 500, message: "err" }))
      .mockResolvedValueOnce(ok(undefined)); // 呼ばれない（3回リトライで止まる）

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: trackingDelay,
    });
    await buffered.send(makeParsedComment());

    expect(delays).toEqual([1000, 2000, 4000]);
  });

  it("invalid_service_idエラーはリトライしない", async () => {
    mockSend.mockResolvedValueOnce(
      err({ kind: "invalid_service_id", serviceId: "bad-id" }),
    );

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    const result = await buffered.send(makeParsedComment());

    expect(isErr(result)).toBe(true);
    if (isErr(result)) {
      expect(result.error.kind).toBe("invalid_service_id");
    }
    expect(mockSend).toHaveBeenCalledOnce();
  });
});

describe("BufferedOneCommeClient - バッファモード", () => {
  let mockSend: ReturnType<typeof createMockClient>["sendFn"];
  let mockClient: OneCommeClient;

  beforeEach(() => {
    const mock = createMockClient();
    mockSend = mock.sendFn;
    mockClient = mock.client;
  });

  it("全リトライがconnection_refusedで失敗するとバッファモードに移行する", async () => {
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });

    await buffered.send(makeParsedComment());

    expect(buffered.isConnected()).toBe(false);
  });

  it("送信成功時はconnected状態を維持する", async () => {
    mockSend.mockResolvedValueOnce(ok(undefined));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });

    await buffered.send(makeParsedComment());

    expect(buffered.isConnected()).toBe(true);
  });

  it("バッファモード中はコメントをキューに蓄積してok結果を返す", async () => {
    // まずバッファモードに移行
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    await buffered.send(makeParsedComment({ id: "first" }));

    // バッファモード中の送信 → バッファに蓄積（sendは呼ばれない）
    const callCountBefore = mockSend.mock.calls.length;
    const result = await buffered.send(makeParsedComment({ id: "second" }));

    expect(isOk(result)).toBe(true);
    expect(mockSend.mock.calls.length).toBe(callCountBefore); // 追加呼び出しなし
    expect(buffered.getBufferSize()).toBe(2); // firstも含む
  });

  it("getBufferSize()がバッファ内のコメント数を返す", async () => {
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });

    expect(buffered.getBufferSize()).toBe(0);

    await buffered.send(makeParsedComment({ id: "a" }));
    expect(buffered.getBufferSize()).toBe(1);

    await buffered.send(makeParsedComment({ id: "b" }));
    expect(buffered.getBufferSize()).toBe(2);
  });

  it("バッファが上限（1000件）に達した場合は古いコメントから破棄する", async () => {
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
      maxBufferSize: 5, // テスト用に小さい上限
    });

    // バッファモードに移行（1件目）
    await buffered.send(makeParsedComment({ id: "c1" }));
    // 残り4件追加
    for (let i = 2; i <= 5; i++) {
      await buffered.send(makeParsedComment({ id: `c${i}` }));
    }
    expect(buffered.getBufferSize()).toBe(5);

    // 6件目 → c1が破棄される
    await buffered.send(makeParsedComment({ id: "c6" }));
    expect(buffered.getBufferSize()).toBe(5);

    // 7件目 → c2が破棄される
    await buffered.send(makeParsedComment({ id: "c7" }));
    expect(buffered.getBufferSize()).toBe(5);
  });
});

describe("BufferedOneCommeClient - flushBuffer", () => {
  let mockSend: ReturnType<typeof createMockClient>["sendFn"];
  let mockClient: OneCommeClient;

  beforeEach(() => {
    const mock = createMockClient();
    mockSend = mock.sendFn;
    mockClient = mock.client;
  });

  it("flushBuffer()がバッファ内のコメントをFIFO順で送信する", async () => {
    // バッファモードに移行
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    await buffered.send(makeParsedComment({ id: "first" }));
    await buffered.send(makeParsedComment({ id: "second" }));
    await buffered.send(makeParsedComment({ id: "third" }));

    // 接続回復
    mockSend.mockResolvedValue(ok(undefined));

    await buffered.flushBuffer();

    // flushBufferで呼ばれたsendの引数を確認
    const flushCalls = mockSend.mock.calls.slice(-3);
    expect(flushCalls[0][0].id).toBe("first");
    expect(flushCalls[1][0].id).toBe("second");
    expect(flushCalls[2][0].id).toBe("third");
  });

  it("flushBuffer()成功後にバッファがクリアされisConnectedがtrueになる", async () => {
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    await buffered.send(makeParsedComment({ id: "a" }));

    expect(buffered.getBufferSize()).toBe(1);
    expect(buffered.isConnected()).toBe(false);

    // 接続回復
    mockSend.mockResolvedValue(ok(undefined));
    await buffered.flushBuffer();

    expect(buffered.getBufferSize()).toBe(0);
    expect(buffered.isConnected()).toBe(true);
  });

  it("flushBuffer()中に送信失敗したコメント以降はバッファに残る", async () => {
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    await buffered.send(makeParsedComment({ id: "a" }));
    await buffered.send(makeParsedComment({ id: "b" }));
    await buffered.send(makeParsedComment({ id: "c" }));

    // aは成功、bは失敗
    mockSend
      .mockResolvedValueOnce(ok(undefined))
      .mockResolvedValueOnce(err({ kind: "connection_refused" }));

    await buffered.flushBuffer();

    // bとcがバッファに残る
    expect(buffered.getBufferSize()).toBe(2);
    expect(buffered.isConnected()).toBe(false);
  });

  it("バッファが空の場合のflushBuffer()は何もしない", async () => {
    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });

    await buffered.flushBuffer();

    expect(buffered.getBufferSize()).toBe(0);
    expect(buffered.isConnected()).toBe(true);
  });

  it("flush成功後に新しいコメントは直接送信される", async () => {
    // バッファモードに移行
    mockSend.mockResolvedValue(err({ kind: "connection_refused" }));

    const buffered = createBufferedOneCommeClient(mockClient, {
      delayFn: instantDelay,
    });
    await buffered.send(makeParsedComment({ id: "buffered" }));
    expect(buffered.isConnected()).toBe(false);

    // flush成功
    mockSend.mockResolvedValue(ok(undefined));
    await buffered.flushBuffer();
    expect(buffered.isConnected()).toBe(true);

    // 新しいコメントは直接送信される
    mockSend.mockClear();
    mockSend.mockResolvedValueOnce(ok(undefined));
    await buffered.send(makeParsedComment({ id: "direct" }));

    expect(mockSend).toHaveBeenCalledOnce();
    expect(mockSend.mock.calls[0][0].id).toBe("direct");
  });
});
