# 技術調査レポート

## 調査日: 2026-02-27 〜 2026-02-28

---

## Summary

### 調査スコープ

1. わんコメ Services API の `meta.viewer` 外部書き込み可否の調査
2. CLIツールへのHTTPサーバー統合のための Node.js `node:http` パターン調査
3. 既存 Extension アーキテクチャの変更影響分析

### 主要な発見

- **わんコメ API の `meta` フィールドは外部書き込みが UIに反映されない**: 内部ポーリングシステムが管理するフィールドであり、HTTP API 経由の書き込みは無視される可能性が高い
- **Node.js `node:http` はゼロ依存でHTTPサーバー構築可能**: 既存のゼロ依存ポリシーを維持したまま HTTPサーバーを追加できる
- **Extension の変更は送信先の切り替えのみ**: 視聴者数取得ロジック（Content Script 3層アーキテクチャ）は完全に維持できる

---

## Research Log

### Topic 1: わんコメ Services API の meta フィールド外部書き込み

**調査日**: 2026-02-28

**Sources**:
- [OneComme HTTP API ドキュメント](https://onecomme.com/docs/developer/http-api)
- [OneComme Postman API ドキュメント](https://documenter.getpostman.com/view/20406518/2s9Y5SX6EE)
- [OneComme v8.0.0 破壊的変更](https://onecomme.com/infomation/breaking-8)
- [@onecomme.com/onesdk npm パッケージ](https://www.npmjs.com/package/@onecomme.com/onesdk) v9.0.0-alpha.1

**Findings**:

1. `PUT /api/services/{id}` の Postman ドキュメントでは、リクエスト例が `{ "name": "test2" }` のみ。`meta` フィールドの外部更新に関する記述が存在しない
2. `ServiceMeta` インターフェースには `viewer?: number | string` が定義されているが、これはわんコメの内部ポーリングで設定されるフィールド
3. `Service` 型に `_internal?: InternalMeta` というプライベートフィールドが存在し、内部管理フィールドと外部設定フィールドの区別がある
4. v8.0.0 の破壊的変更一覧に services API 自体の明示的な変更は記載されていないが、WebSocket API のパーミッション制限等の内部リファクタリングが行われている

**Implications**:
- わんコメ経由での視聴者数通知は断念し、別のルート（HTTPサーバー方式）を採用する

### Topic 2: Node.js `node:http` によるHTTPサーバー構築

**調査日**: 2026-02-28

**Sources**:
- [Node.js http module documentation](https://nodejs.org/docs/latest-v18.x/api/http.html)

**Findings**:

1. `node:http` は Node.js 18+ 標準モジュールで外部依存なし
2. `http.createServer()` でHTTPサーバーを作成し、リクエストハンドラを登録する
3. `server.close()` は既存接続の終了を待つ。`server.closeAllConnections()` (Node.js 18.2+) で即座に全接続を切断可能
4. `server.listen(port, hostname)` で `hostname` を `"127.0.0.1"` に指定することで localhost 限定でバインドできる
5. CORS ヘッダは手動で `Access-Control-Allow-Origin` 等をレスポンスヘッダに設定する

**Implications**:
- ゼロ依存ポリシーを維持したまま HTTPサーバーを追加できる
- グレースフルシャットダウンは `server.close()` + `server.closeAllConnections()` で実現する

### Topic 3: 既存 Extension アーキテクチャの変更影響分析

**調査日**: 2026-02-28

**Findings**:

変更対象と影響範囲:

| ファイル | 変更内容 | 影響 |
|---------|---------|------|
| `wancomme-client.ts` | `viewer-count-client.ts` に置換 | PUT → POST、エンドポイント・ペイロード変更 |
| `types.ts` | `ExtensionSettings` から `serviceId` 削除、`WancommeServiceUpdatePayload` 削除 | 設定構造の簡素化 |
| `settings.ts` | `serviceId` 関連のロジック削除、キー名変更 | ストレージキーの変更 |
| `service-worker.ts` | `createWancommeClient` → `createViewerCountClient` | 送信ロジックの置換 |
| `popup.ts` / `popup.html` | serviceId フィールド削除 | UI の簡素化 |
| Content Scripts | **変更なし** | 影響なし |

**Implications**:
- Content Script 層（視聴者数取得の核心ロジック）に一切変更が不要
- 変更は Extension の Background Layer と UI Layer に限定される

---

## Architecture Decisions

### AD-1: HTTPサーバーの統合先

**Decision**: CLIツール（x-live-to-wancome）のプロセス内にHTTPサーバーを統合する

**Alternatives Considered**:
1. ~~スタンドアロンのHTTPサーバープロセス~~: 配信者が追加プロセスを管理する手間が発生する
2. ~~Extension に Native Messaging Host を追加~~: 構成が複雑化し、インストール手順が増える
3. **CLIツールに統合**: 配信者は既にCLIを起動しているため、追加操作不要。ゼロ依存で実現可能

**Rationale**: CLIツールは配信中に常時稼働しているため、ここにHTTPサーバーを統合するのが最もシンプルで操作負担が少ない。

### AD-2: デフォルトポート番号

**Decision**: `11190` をデフォルトポートとする

**Rationale**: わんコメのデフォルトポート `11180` に近い番号帯で、衝突しない値を選択した。覚えやすく、CLIオプション `--viewer-port` で変更可能。

### AD-3: Extension から serviceId の削除

**Decision**: Extension の設定から `serviceId` を完全に削除する

**Rationale**: わんコメの `PUT /api/services/{serviceId}` を使用しなくなったため、serviceId は不要になった。CLIサーバーのエンドポイントは `/api/viewer-count` 固定であり、サービス識別が不要。

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| CLIサーバーのポートが他サービスと衝突 | 低 | `--viewer-port` で変更可能。起動時にポート競合エラーを明示 |
| OBS ブラウザソースの CORS 制約 | 中 | `Access-Control-Allow-Origin: *` で対応。ローカルホスト限定なのでセキュリティリスクは低い |
| Extension 設定の既存データ移行 | 低 | 旧設定キー（`wancommeHost`/`wancommePort`/`serviceId`）は無視され、新設定キー（`serverHost`/`serverPort`）のデフォルト値が使用される |

---

## 既存調査（v1: Chrome Extension MV3 技術調査）

以下は v1 設計時に実施した Chrome Extension MV3 の技術調査。視聴者数取得ロジック（Content Script 3層アーキテクチャ）は変更なしで引き続き有効。

- MV3 Service Worker の制約（アイドル停止、DOM アクセス不可）
- MAIN world での fetch モンキーパッチ方式
- chrome.storage API によるセッション管理
- chrome.action API によるバッジ制御

詳細は Git 履歴の旧 `research.md` を参照。
