# Implementation Plan

- [x] 1. 型定義の追加と更新
  - `ServiceTarget` discriminated unionを追加し、サービス指定方法（ID直接指定 or 名前指定）を型で表現する
  - `CLIConfig` の `oneCommeServiceId` を `serviceTarget` に置き換える
  - `ConfigError` に `missing_service_target`（両方未指定）と `conflicting_service_options`（両方指定）を追加し、`missing_service_id` を削除する
  - `ServiceResolveError` discriminated unionを追加する（`not_found`, `ambiguous`, `connection_refused`, `timeout`, `api_error`）
  - `OneCommeService` インターフェースを追加する（わんコメAPI `GET /api/services` レスポンスの各要素型）
  - _Requirements: 1.1, 1.3, 1.4, 2.3, 2.4, 3.1, 3.2, 3.3_

- [x] 2. (P) CLI引数解析の拡張とテスト
  - `parseArgs()` のforループに `--service-name` オプションの分岐を追加する
  - `--service-id` と `--service-name` の排他バリデーションを実装する（両方指定→ `conflicting_service_options` エラー、両方未指定→ `missing_service_target` エラー）
  - `parseArgs()` の戻り値で `CLIConfig.serviceTarget` を `{ kind: "id" }` または `{ kind: "name" }` で返すようにする
  - `formatConfigError()` に新エラーkind（`missing_service_target`, `conflicting_service_options`）のユーザー向けメッセージを追加する
  - usageメッセージを `--service-name <名前> | --service-id <id>` の形式に更新する
  - 既存テスト（`cli-config.test.ts`）の `oneCommeServiceId` 参照を `serviceTarget` に更新し、後方互換テストが通ることを確認する
  - 新規テストケースを追加する: `--service-name` パース成功、両方指定エラー、両方未指定エラー
  - _Requirements: 1.1, 1.3, 1.4, 4.1, 4.3_

- [x] 3. (P) サービス名解決コンポーネントの実装とテスト
  - `createServiceResolver()` ファクトリ関数を実装する（`host`, `port`, `fetchFn` を受け取る）
  - `resolve()` メソッドでわんコメ `GET /api/services` を呼び出し、レスポンスから指定名と完全一致するサービスを検索する
  - 完全一致が1件の場合はそのサービスIDを `Ok` で返す
  - 一致なしの場合は `not_found` エラーを返し、利用可能なサービス名一覧を含める
  - 複数一致の場合は `ambiguous` エラーを返し、該当するサービスのID・名前ペア一覧を含める
  - 接続拒否・タイムアウト・APIエラー（非2xx）をそれぞれ対応する `ServiceResolveError` で返す
  - `formatServiceResolveError()` 関数を実装し、各エラー種別に応じたユーザー向けメッセージを生成する（`not_found` 時はサービス名一覧表示、`ambiguous` 時はID一覧表示と `--service-id` 案内、接続拒否時はわんコメ起動確認案内）
  - テストを作成する: 完全一致1件→成功、一致なし→not_found、複数一致→ambiguous、接続拒否→connection_refused、タイムアウト→timeout、APIエラー→api_error（fetchFnモック注入）
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3_

- [x] 4. エントリーポイントへのサービス解決ステップの統合
  - `index.ts` のCLI解析後にサービス解決の分岐を追加する: `serviceTarget.kind === "name"` の場合に `createServiceResolver()` で名前解決を実行し、`kind === "id"` の場合はIDを直接使用する
  - サービス解決エラー時は `formatServiceResolveError()` でメッセージを表示して `process.exit(1)` で終了する
  - 解決済みのサービスIDを `createOneCommeClient()` と `logConfig()` に渡す
  - `logConfig()` の出力を更新し、指定方法（名前 or ID）と解決後のサービスIDを表示する
  - _Requirements: 1.2, 4.2_
