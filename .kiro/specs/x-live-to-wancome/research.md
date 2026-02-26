# Research & Design Decisions

---
**Purpose**: X Live配信コメント→わんコメブリッジの技術設計に必要な調査結果を記録する。
---

## Summary
- **Feature**: `x-live-to-wancome`
- **Discovery Scope**: New Feature（グリーンフィールド）
- **Key Findings**:
  1. X Liveのチャットシステムは旧Periscope（pscp.tv）インフラで動作しており、公開HTTPエンドポイントからチャットトークン取得・メッセージポーリングが認証なしで可能
  2. チャットメッセージの取得はWebSocketではなくHTTPポーリング（cursor-based pagination）で実現されている
  3. わんコメの`POST /api/comments`エンドポイントはシンプルなJSON構造で、Xチャットのメッセージフィールドと直接マッピング可能

## Research Log

### X Liveチャットの技術基盤
- **Context**: X（Twitter）のライブ配信チャットにはPeriscope API廃止（2021年）以降、公式APIが存在しない。実際の通信プロトコルを解析する必要があった。
- **Sources Consulted**: Playwright MCPによるライブ配信ページ（`https://x.com/i/broadcasts/1yKAPMPBOOzxb`）のネットワーク解析
- **Findings**:
  - チャットシステムは旧Periscope（`pscp.tv`）ドメインで動作
  - 認証なし（ゲスト）でもチャットの読み取りが可能
  - APIフロー（4ステップ）:
    1. `GET /graphql/BroadcastQuery` → broadcast metadata（media_key取得）
    2. `GET /1.1/live_video_stream/status/{media_key}.json` → chatToken（JWT）
    3. `POST proxsee-cf.pscp.tv/api/v2/accessChatPublic` → access_token, endpoint
    4. `POST {endpoint}/chatapi/v1/history` → messages（cursorベースポーリング）
  - BroadcastQuery GraphQLのoperation IDは `P11fY-GUGe2MX_a1MQoQKw` だが変更される可能性あり
  - `broadcasts/show.json`（REST）も代替エンドポイントとして利用可能
- **Implications**: ブラウザ自動化（Puppeteer等）は不要。直接HTTP APIコールでチャットを取得できる。

### チャットメッセージのデータ構造
- **Context**: わんコメへのマッピングに必要なフィールドを特定する。
- **Sources Consulted**: 実際のchatapi/v1/historyレスポンスの解析
- **Findings**:
  - メッセージ配列の各要素: `{ kind, payload (JSON string), signature }`
  - `kind: 1` = チャットメッセージ、`kind: 2` = システムイベント（入室）
  - payloadをパースすると:
    ```
    {
      room: string,           // broadcast ID
      body: string,           // さらにJSON文字列（二重ネスト）
      lang: string,           // "ja", "en" etc.
      sender: {
        user_id: string,      // Periscope user ID
        username: string,     // @username
        display_name: string, // 表示名
        profile_image_url: string,
        participant_index: number,
        locale: string,
        verified: boolean,
        twitter_id: string,   // TwitterのユーザーID
        lang: string[]
      },
      timestamp: number,      // ナノ秒タイムスタンプ
      uuid: string            // メッセージ固有ID
    }
    ```
  - body内部のJSON:
    ```
    {
      body: string,              // 実際のコメントテキスト
      displayName: string,
      username: string,
      remoteID: string,          // user_id
      timestamp: number,         // ミリ秒タイムスタンプ
      uuid: string,
      type: number,              // 1 = 通常コメント
      v: number,                 // バージョン (2)
      participant_index: number,
      programDateTime: string,   // ISO 8601
      ntpForBroadcasterFrame: number,
      ntpForLiveFrame: number
    }
    ```
- **Implications**: ペイロードは二重JSONネストされており、パーサーは2段階のJSON.parseが必要。uuidフィールドで重複検出が可能。

### チャットトークンとセッション管理
- **Context**: トークンの有効期限と更新メカニズムの調査。
- **Sources Consulted**: JWTペイロードのデコード、ライブ配信ページのネットワークトラフィック分析
- **Findings**:
  - `chatToken`はJWT形式で、`exp`フィールドによる有効期限あり（約24時間）
  - `accessChatPublic`レスポンスの`access_token`は不透明トークン（JWT非準拠）
  - ページは`broadcasts/show.json`を定期的にポーリングして配信状態（Running/Ended）を監視
  - `startPublic`/`pingPublic`エンドポイントは視聴者カウント用で、チャット取得には不要
  - `life_cycle_token`にも`exp`フィールドがあり、期限切れ前の再取得が必要
- **Implications**: トークンリフレッシュ機構が必要。chatTokenの期限を監視し、期限切れ前にlive_video_stream/statusから再取得する。

### わんコメ（OneComme）HTTP API
- **Context**: コメント送信先であるわんコメのAPI仕様を調査。
- **Sources Consulted**: OneComme公式ドキュメント、Postman APIドキュメント、フォーラム投稿、@onecomme.com/onesdk型定義
- **Findings**:
  - `POST /api/comments` エンドポイント（デフォルトポート: 11180）
  - リクエストボディ:
    ```json
    {
      "service": { "id": "<frame UUID>" },
      "comment": {
        "id": "<unique comment ID>",
        "userId": "<user ID>",
        "name": "<display name>",
        "comment": "<comment text>",
        "profileImage": "<avatar URL>",
        "badges": [],
        "hasGift": false,
        "isOwner": false,
        "timestamp": 1644470611051
      }
    }
    ```
  - `GET /api/services` でフレーム一覧取得可能（service.idの動的取得）
  - service.idは環境固有のUUIDで、ハードコード不可
  - localhostからのアクセスのみデフォルトで許可
  - レスポンス: 成功時200 OK、バリデーションエラー時400
  - ~~timestampフィールドはstring型（ミリ秒エポック）~~ **訂正**: timestampフィールドはAJV `oneOf`スキーマで検証される — `number`型（エポックミリ秒）または`date-time`形式の文字列（ISO 8601）のいずれかを受け付ける
  - 400レスポンスはservice.id不正に限らず、commentオブジェクトのスキーマバリデーションエラー全般で発生する
- **Implications**: Xチャットの各フィールドはわんコメのフィールドに直接マッピング可能。service.idは起動時にユーザー設定またはAPIから取得する。timestampは`number`型（エポックミリ秒）で送信する。

### わんコメAPI timestampフィールドの仕様訂正（2026-02-26追加調査）
- **Context**: 実装テスト中に、`timestamp`を`String(epochMs)`（例: `"1709000000000"`）で送信したところ、わんコメ側でAJVバリデーションエラーが発生。
- **Sources Consulted**:
  - わんコメ側のエラーログ（AJVバリデーション出力）
  - OneCommeコメントログドキュメント（`onecomme.com/docs/feature/comment-log`）
  - OneCommeフォーラム投稿（`forum.onecomme.com/t/topic/1833`, `/2391`）
  - `@onecomme.com/onesdk` v9.0.0-alpha.1 型定義
- **Findings**:
  - わんコメの`POST /api/comments`は内部でAJV JSONスキーマバリデーションを使用
  - `timestamp`フィールドのスキーマは`oneOf`:
    1. `{ type: "number" }` — エポックミリ秒（例: `1709000000000`）
    2. `{ format: "date-time" }` — ISO 8601文字列（例: `"2024-02-27T06:13:20.000Z"`）
  - 数字の文字列表現（`"1709000000000"`）は**どちらにも該当しない**ため拒否される
  - コメントログドキュメントの実例では`timestamp: 1644470611051`（number型）が使用されている
  - フォーラムの投稿例ではtimestampフィールドを省略しているケースが多い（サーバー側で自動補完される可能性）
  - `@onecomme.com/onesdk`の`BaseResponse`型では`timestamp: string`と定義されているが、これは読み取り側の型（サーバーからの応答）であり、書き込み側のスキーマとは異なる
- **Implications**:
  - `OneCommeComment.comment.timestamp`の型を`string`から`number`に変更する必要がある
  - `String(comment.timestamp)`の変換を削除し、`number`のまま送信する
  - 400エラーのハンドリングも改善が必要：全400を「枠ID無効」と判断するのではなく、レスポンスボディを解析して具体的なバリデーションエラーを識別すべき

### ポーリング間隔と負荷
- **Context**: チャットポーリングの適切な間隔を決定する。
- **Sources Consulted**: ライブ配信ページのネットワークトラフィックのタイミング分析
- **Findings**:
  - X公式ページはchatapi/v1/historyを初回ロード時に1回呼び出し、以降はcursorベースで定期ポーリング
  - ページのポーリング間隔は約3〜5秒
  - レート制限に関する明示的なドキュメントはないが、過剰なリクエストはIP制限の可能性あり
  - cursorが空文字で返された場合は新規メッセージなし
- **Implications**: ポーリング間隔は3秒をデフォルトとし、設定可能にする。空レスポンス時はバックオフも検討。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| Pipeline | 直列パイプライン: Resolve→Token→Poll→Parse→Dedupe→Send | シンプル、デバッグ容易、依存関係が明確 | 並行処理の余地が少ない | 単一配信の監視用途にはこれで十分 |
| Event-Driven | EventEmitterベース: 各コンポーネントがイベントで疎結合 | 拡張性高、コンポーネント独立 | 過剰設計の恐れ、エラー追跡が複雑 | 複数配信同時監視には有効だが現スコープ外 |
| Actor Model | 各コンポーネントが独立アクター | 耐障害性、並行処理 | 実装が複雑、ライブラリ依存 | 現要件に対して過剰 |

**選択**: Pipeline パターン — 単一配信の監視というスコープに最適。シンプルで理解しやすく、エラー追跡が容易。

## Design Decisions

### Decision: コメント取得方式 — HTTP APIポーリング
- **Context**: X Liveチャットのリアルタイム取得方法の選択
- **Alternatives Considered**:
  1. ブラウザ自動化（Puppeteer/Playwright） — DOM解析でコメント取得
  2. HTTP APIポーリング — Periscope Chat APIを直接呼び出し
  3. WebSocket接続 — リアルタイムストリーム
- **Selected Approach**: HTTP APIポーリング
- **Rationale**: ネットワーク解析の結果、チャットシステムはHTTPポーリングで動作していることが判明。ブラウザ自動化は重量級で不安定、WebSocketエンドポイントは発見されなかった。公開APIを直接呼び出す方が軽量で安定的。
- **Trade-offs**: ポーリング間隔によるレイテンシ（最大3秒の遅延）が発生するが、コメント管理用途では許容範囲。
- **Follow-up**: レート制限の実測、トークン有効期限の長期テスト

### Decision: ランタイム — Node.js (TypeScript)
- **Context**: ブリッジアプリケーションのランタイム選択
- **Alternatives Considered**:
  1. Node.js (TypeScript) — fetch API、JSON処理に強い
  2. Deno — セキュリティモデルが優秀だが、エコシステムが小さい
  3. Python — requests/aiohttp利用可能だが型安全性が弱い
- **Selected Approach**: Node.js (TypeScript)
- **Rationale**: APIレスポンスのJSONパース（特に二重ネスト）を型安全に処理でき、わんコメ公式SDKも@onecomme.com/onesdkとしてnpmで提供されている。
- **Trade-offs**: Node.jsの起動コストはあるが、長時間動作アプリケーションには無関係。

### Decision: 重複検出方式 — インメモリSet (UUID)
- **Context**: 同一コメントの重複送信防止メカニズム
- **Alternatives Considered**:
  1. インメモリSet — メッセージUUIDをSetに保存
  2. SQLite — 永続化された重複チェック
  3. ファイルベース — JSONファイルにID記録
- **Selected Approach**: インメモリSet
- **Rationale**: ライブ配信セッション中のみ動作するため、永続化は不要。UUIDは一意性が保証されており、Setのルックアップは O(1)。メモリ使用量は数千コメントでも数KB程度。
- **Trade-offs**: アプリ再起動時にSetがクリアされるが、cursorベースのポーリングで既読位置を保持するため、再接続時にも重複は発生しにくい。

### Decision: わんコメtimestampフィールド — number型で送信（2026-02-26訂正）
- **Context**: 実装テストでtimestampバリデーションエラーが発生。初期調査では「timestampはstring型（ミリ秒エポック）」と判断したが、実際のAJVスキーマは`oneOf[number, date-time]`であった。
- **Alternatives Considered**:
  1. `number`型でエポックミリ秒をそのまま送信
  2. ISO 8601 date-time文字列に変換して送信（例: `"2024-02-27T06:13:20.000Z"`）
  3. timestampフィールドを省略（サーバー側で自動補完される可能性あり）
- **Selected Approach**: `number`型でエポックミリ秒をそのまま送信
- **Rationale**: コメントログドキュメントの実例が`number`型を使用。`ParsedComment.timestamp`が既に`number`（エポックミリ秒）のため、変換不要で最もシンプル。ISO 8601変換はタイムゾーンの曖昧さが生じる可能性がある。
- **Trade-offs**: なし（元のデータ型と一致するため変換コストゼロ）
- **Follow-up**: 実装テストで送信成功を確認する

### Decision: 400エラーハンドリングの改善（2026-02-26追加）
- **Context**: わんコメの400レスポンスをすべて「枠ID無効」と判断していたが、実際にはtimestampバリデーションエラーでも400が返される。誤ったエラーメッセージがユーザーに表示されていた。
- **Alternatives Considered**:
  1. レスポンスボディを解析して具体的なエラー原因を特定する
  2. 400レスポンスの詳細をそのままログ出力する（分類しない）
- **Selected Approach**: レスポンスボディを解析し、service.id関連のエラーとcommentバリデーションエラーを区別する
- **Rationale**: ユーザーに正確なエラー情報を提供し、問題の原因を特定しやすくする。わんコメはAJVバリデーションエラーをJSON形式（`errors`配列、`instancePath`フィールド）で返すため、パース可能。
- **Trade-offs**: レスポンスボディのパースが必要になるが、エラーケースのみなのでパフォーマンスへの影響はない。

## Risks & Mitigations

- **Risk 1: APIエンドポイントの変更** — X/Periscopeの内部APIは予告なく変更される可能性がある。
  - Mitigation: エンドポイントURLを設定ファイルで管理し、変更時に容易に更新可能にする。GraphQL operation IDの変更に備え、broadcasts/show.json（REST）をフォールバックとして用意。
- **Risk 2: レート制限** — 過剰なポーリングによりIPレベルでブロックされる可能性。
  - Mitigation: ポーリング間隔を3秒以上に設定し、指数バックオフを実装。429レスポンス検知時は自動的に間隔を延長。
- **Risk 3: トークン失効** — chatTokenやaccess_tokenが有効期限切れになる可能性。
  - Mitigation: JWT expフィールドを監視し、期限の80%経過時点で自動リフレッシュ。リフレッシュ失敗時はフルフロー（Step 1から）で再取得。
- **Risk 4: 配信終了の検出漏れ** — 配信終了を検知できず無限ポーリングになる可能性。
  - Mitigation: broadcasts/show.jsonのstateフィールド（"RUNNING" → "ENDED"）を定期チェック。chatapi/v1/historyが空レスポンスを連続で返す場合も終了シグナルとして扱う。

## References
- [X BroadcastQuery GraphQL] — 実ネットワーク解析により発見（operation ID: P11fY-GUGe2MX_a1MQoQKw）
- [Periscope Chat API (pscp.tv)] — proxsee-cf.pscp.tv/api/v2/accessChatPublic, prod-chatman-ancillary-*.pscp.tv/chatapi/v1/history
- [OneComme HTTP API](https://onecomme.com/docs/developer/http-api) — 公式ドキュメント
- [OneComme Postman API](https://documenter.getpostman.com/view/20406518/2s9Y5SX6EE) — 詳細仕様
- [@onecomme.com/onesdk](https://www.npmjs.com/package/@onecomme.com/onesdk) — TypeScript型定義SDK
