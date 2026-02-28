# 実装計画

- [x] 1. 型定義の拡張
  - `CLIConfig.broadcastUrl` を必須（`string`）からオプション（`string | undefined`）に変更する
  - `ConfigError` から `missing_broadcast_url` と `missing_service_target` バリアントを削除する
  - `OneCommeService` に `url: string` フィールドを追加する
  - `ResolvedService` インターフェースを新規追加する（`serviceId: string` と `url: string`）
  - `ServiceResolveError` に `id_not_found`（IDでサービス未検出）と `url_not_found`（サービス存在するがURL空）のバリアントを追加する
  - _Requirements: 1.1, 2.1, 3.2, 3.3_

- [x] 2. (P) CLI引数のデフォルト値適用とバリデーション変更
  - `broadcastUrl` を必須引数からオプション引数に変更し、未指定時に `undefined` を返すようにする
  - `--service-name` と `--service-id` の両方が省略された場合、`--service-name=X` をデフォルト値として適用する
  - `broadcastUrl` が指定された場合のみURL形式バリデーションを実行し、省略時はスキップする
  - USAGE文字列を `<broadcast-url>` → `[broadcast-url]`、`--service-name | --service-id` → `[--service-name] [--service-id]` に更新する
  - `formatConfigError` から削除されたエラー種別のcase分岐を除去する
  - テスト: 引数なし時のデフォルト値適用、明示的指定時のデフォルト不使用、broadcastUrl省略時のバリデーションスキップを検証する
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 3. (P) ServiceResolverの入出力拡張
  - `resolve` メソッドの入力を `serviceName: string` から `target: ServiceTarget` に変更し、名前検索とID検索の両方に対応する
  - 戻り値を `Result<string, ...>` から `Result<ResolvedService, ...>` に変更し、サービスIDに加えてURLも返す
  - `kind=name` 時の既存名前検索ロジックを維持しつつ、マッチしたサービスのURLも返すようにする
  - `kind=id` 時にIDで完全一致するサービスを検索し、見つからない場合は `id_not_found` エラーを返す
  - 名前/ID検索でサービスが見つかったがURLが空文字の場合は `url_not_found` エラーを返す
  - `formatServiceResolveError` に `id_not_found` と `url_not_found` のエラーメッセージを追加する
  - テスト: 既存テストの戻り値型適合、ID検索の成功と失敗、URL空文字時のエラー、新規エラーメッセージのフォーマットを検証する
  - _Requirements: 2.1, 3.1, 3.2, 3.3_

- [x] 4. 起動フローの統合
  - サービス解決の呼び出し条件を変更し、`kind=name` だけでなく `broadcastUrl` 未指定時にも解決を実行するようにする
  - `broadcastUrl` をCLI引数の値またはServiceResolverから取得したURLで決定する
  - `broadcastUrl` 確定後に `extractBroadcastId` によるURL形式バリデーションを実行し、不正な場合はエラーメッセージを表示して終了する
  - `ServiceResolver.resolve` の呼び出しを新しいインターフェース（`ServiceTarget` 入力、`ResolvedService` 戻り値）に適合させる
  - `logConfig` の呼び出しを `broadcastUrl` がオプションになった `CLIConfig` に適合させる
  - _Requirements: 2.1, 2.2, 2.3_
