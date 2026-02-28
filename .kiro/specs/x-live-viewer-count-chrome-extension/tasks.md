# Implementation Plan

- [x] 1. CLIツール: 型定義の拡張とCLIオプション追加
- [x] 1.1 (P) CLIConfig と ConfigError の型拡張
  - `CLIConfig` に `viewerCountPort` フィールド（デフォルト: `11190`）を追加する
  - `ConfigError` に `invalid_viewer_port` バリアントを追加する
  - テスト: 型が正しく定義されていることを既存のテストが壊れないことで確認する
  - _Requirements: 2.6, 6.2_

- [x] 1.2 `--viewer-port` CLIオプションのパースとバリデーション
  - `parseArgs` 関数に `--viewer-port <port>` オプションを追加し、1-65535 の整数バリデーションを行う
  - `formatConfigError` に `invalid_viewer_port` のエラーメッセージを追加する
  - ヘルプテキスト（usage 文字列）に `--viewer-port` の説明を追加する
  - `logConfig` で `viewerCountPort` を出力に含める
  - テスト: `--viewer-port` の正常パース、範囲外の値での拒否、未指定時のデフォルト値 `11190` を検証する
  - _Requirements: 2.6, 6.2_

- [x] 2. CLIツール: ViewerCountServer の実装
- [x] 2.1 HTTPサーバーの基盤構築
  - `node:http` を使用してHTTPサーバーを作成するファクトリ関数を実装する
  - サーバーは `127.0.0.1` のみにバインドし、外部ネットワークからのアクセスを防止する
  - `start()` でサーバーを起動し、`stop()` で `server.close()` + `server.closeAllConnections()` によるグレースフルシャットダウンを行う
  - すべてのレスポンスに CORS ヘッダ（`Access-Control-Allow-Origin: *`, `Access-Control-Allow-Methods: GET, POST, OPTIONS`, `Access-Control-Allow-Headers: Content-Type`）を付与する
  - OPTIONS リクエストに対して 204 で応答する（CORS preflight）
  - テスト: サーバーの起動・停止、CORS ヘッダの付与、OPTIONS preflight 応答を検証する
  - _Requirements: 2.1, 2.4, 2.5, 6.3_

- [x] 2.2 視聴者数の受信エンドポイント（POST）
  - `POST /api/viewer-count` で `{ viewerCount: number }` を受け取り、内部状態を更新する
  - 更新時刻を ISO 8601 形式で記録する
  - リクエストボディが不正（JSON パース失敗、`viewerCount` が数値でない）な場合は 400 を返す
  - 正常時は 204 No Content を返す
  - テスト: 正常な POST での内部状態更新、不正ボディでの 400 応答、非数値 viewerCount での 400 応答を検証する
  - _Requirements: 2.3_

- [x] 2.3 視聴者数の取得エンドポイント（GET）
  - `GET /api/viewer-count` で現在の視聴者数と更新時刻を JSON で返す
  - 未受信の場合は `{ viewerCount: null, updatedAt: null }` を返す
  - 1秒間隔のポーリングに対して安定して応答できることを確認する
  - テスト: 初期状態での null 応答、POST 後の最新値取得、連続 GET での安定応答を検証する
  - _Requirements: 2.2, 2.4_

- [x] 3. CLIツール: メインプロセスへの統合
  - CLIのエントリーポイントで ViewerCountServer を初期化し、チャットパイプラインと並行して起動する
  - サーバー起動時にポート番号をログ出力する
  - グレースフルシャットダウン時（SIGINT/SIGTERM）に ViewerCountServer の `stop()` を呼び出し、既存の cleanup 処理と統合する
  - ポート競合時はエラーメッセージを出力し、プロセスを終了する
  - 既存のチャットポーリング、わんコメ転送、バッファリング、トークンリフレッシュ、配信状態監視の動作に一切影響がないことを確認する
  - テスト: サーバー起動とシャットダウンの統合を手動確認する
  - _Requirements: 2.1, 6.1, 6.3_

- [x] 4. Extension: 送信先の変更
- [x] 4.1 (P) ViewerCountClient の実装
  - 旧わんコメクライアントを置き換え、CLIサーバーの `POST /api/viewer-count` に `{ viewerCount: number }` を送信するクライアントを実装する
  - ファクトリ関数パターンで `fetch` を注入可能にする
  - エラーハンドリング: 接続拒否、API エラー（非 2xx ステータス）、タイムアウトを discriminated union で返す
  - テスト: 正しい URL 構築・ペイロード形式・HTTP メソッド（POST）の検証、各エラーパターンのハンドリングを検証する
  - _Requirements: 3.1, 3.2, 3.3_

- [x] 4.2 (P) Extension 型定義と設定ストアの更新
  - `ExtensionSettings` から `serviceId` を削除し、`wancommeHost`/`wancommePort` を `serverHost`/`serverPort` にリネームする（デフォルト: `localhost` / `11190`）
  - `DEFAULT_SETTINGS` を新しいフィールド名・デフォルト値に更新する
  - `WancommeServiceUpdatePayload` 型を削除する
  - 設定ストアの `loadSettings`/`saveSettings` を新しいストレージキーに合わせて更新する
  - テスト: 新しいデフォルト値でのロード、保存・読み取りの round-trip を検証する
  - _Requirements: 4.2, 4.3_

- [x] 5. Extension: Service Worker と Popup UI の更新
- [x] 5.1 Service Worker の送信ロジック切り替え
  - 旧わんコメクライアントの生成を ViewerCountClient に置き換える
  - 視聴者数更新時の送信パラメータから `serviceId` を削除し、`host`/`port`/`viewerCount` のみを渡す
  - `serviceId` 未設定時の「設定未完了」バッジ表示ロジックを削除する（ホスト・ポートにはデフォルト値があるため常に有効）
  - 送信成功時の緑バッジ、送信失敗時の赤バッジ表示は維持する
  - テスト: 新しいクライアントでの送信成功・失敗時のバッジ状態を検証する
  - _Requirements: 3.1, 3.2, 3.3, 5.3_

- [x] 5.2 Popup UI の更新
  - サービスID 入力フィールドを削除する
  - ラベルを「わんコメ設定」→「サーバー設定」に変更する
  - ホストとポートの入力フィールドのデフォルト値を `localhost` / `11190` に変更する
  - 旧 serviceId 空チェックによる保存ボタン無効化ロジックを削除する
  - _Requirements: 4.1, 4.2, 4.3_

- [ ] 6. 全体統合と動作確認（手動テスト）
  - CLI を `--viewer-port 11190` で起動し、Extension が取得した同時視聴者数が `POST /api/viewer-count` で CLI サーバーに送信されることを手動確認する
  - OBS ブラウザソースから `GET http://localhost:11190/api/viewer-count` を1秒間隔でポーリングし、最新の視聴者数が取得できることを手動確認する
  - Extension のバッジに現在の視聴者数が緑背景で表示され、CLIサーバー停止時に赤背景になることを確認する
  - 配信ページの開閉に連動して Extension の自動開始・停止が動作することを確認する
  - 既存のチャット転送機能（わんコメへのコメント送信）が正常に動作し、HTTPサーバーの追加による影響がないことを確認する
  - _Requirements: 1.1, 1.2, 1.3, 1.4, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 4.1, 4.2, 4.3, 5.1, 5.2, 5.3, 5.4, 6.1, 6.2, 6.3_

## Requirements Coverage

| Requirement | Tasks |
|-------------|-------|
| 1.1 | 6 |
| 1.2 | 6 |
| 1.3 | 6 |
| 1.4 | 6 |
| 2.1 | 2.1, 3, 6 |
| 2.2 | 2.3, 6 |
| 2.3 | 2.2, 6 |
| 2.4 | 2.1, 2.3, 6 |
| 2.5 | 2.1, 6 |
| 2.6 | 1.1, 1.2, 6 |
| 3.1 | 4.1, 5.1, 6 |
| 3.2 | 4.1, 5.1, 6 |
| 3.3 | 4.1, 5.1, 6 |
| 4.1 | 5.2, 6 |
| 4.2 | 4.2, 5.2, 6 |
| 4.3 | 4.2, 5.2, 6 |
| 5.1 | 6 |
| 5.2 | 6 |
| 5.3 | 5.1, 6 |
| 5.4 | 6 |
| 6.1 | 3, 6 |
| 6.2 | 1.1, 1.2, 6 |
| 6.3 | 2.1, 3, 6 |
