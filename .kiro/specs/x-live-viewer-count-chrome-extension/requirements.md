# Requirements Document

## Introduction

X Live（旧Twitter Live / Periscope）の同時視聴者数を、Media Studio APIから取得し、OBSから取得可能なHTTPエンドポイント経由で配信画面に反映するシステムの要件を定義する。システムは2つのコンポーネントで構成される:

1. **Chrome Extension** — Media Studio API から同時視聴者数を取得し、ローカルサーバーに送信する
2. **CLIツール（x-live-to-wancome）に統合されたHTTPサーバー** — Extensionから受信した視聴者数をHTTPエンドポイントで公開し、OBSからポーリング可能にする

公開API `broadcasts/show.json` の `total_watching` フィールドは延べ視聴者数（累積値）であり、正確な同時視聴者数は Media Studio API（`studio.x.com/1/analytics/broadcast/live_viewers.json`）からのみ取得可能である。配信者は配信時に必ず Media Studio をブラウザで開くため、Chrome Extension であれば認証情報を自動利用でき、手動操作が不要となる。

### わんコメ Services API の非採用について

当初はわんコメの `PUT /api/services/{serviceId}` エンドポイントに `{ meta: { viewer: number } }` を送信する方式を採用していたが、以下の理由で同時視聴者数がUIに反映されないことが判明した:

- わんコメの `meta` フィールドは内部ポーリングシステムが管理するフィールドであり、外部からのHTTP API経由の書き込みがUI上に反映されない
- 公式APIドキュメント（Postman）では `PUT /api/services/{id}` のリクエスト例が `{ "name": "test2" }` のみで、`meta` フィールドの外部更新に関する記述が存在しない
- v8.0.0の破壊的変更一覧にservices API自体の明示的な変更は記載されていないが、内部的に `meta` の書き込み権限が制限されている可能性がある

このため、わんコメ経由での同時視聴者数の通知は断念し、CLIツールに統合したHTTPサーバーでOBSから直接ポーリングする方式を採用する。

## Requirements

### Requirement 1: 同時視聴者数の取得

**Objective:** 配信者として、X Liveの正確な同時視聴者数をリアルタイムで取得したい。延べ視聴者数ではなく、その時点で視聴している人数を知るためである。

#### Acceptance Criteria
1.1. While Media Studio の配信詳細ページ（`studio.x.com/producer/broadcasts/*`）が開かれている間、the Extension shall Media Studio API（`live_viewers.json`）から同時視聴者数の時系列データを定期的に取得する

1.2. When 同時視聴者数データの取得に成功した場合、the Extension shall `ts`配列の末尾の値を現在の同時視聴者数として抽出する

1.3. The Extension shall ブラウザの認証情報（Cookie）を自動的に利用し、ユーザーに認証トークンの手動入力を求めない

1.4. When ページから`media_key`および`owner_id`を取得できた場合、the Extension shall それらを使用してAPIリクエストを構築する

### Requirement 2: CLIツール統合HTTPサーバーによる視聴者数の公開

**Objective:** 配信者として、取得した同時視聴者数をOBSから取得可能な形で提供したい。OBSのブラウザソース等から1秒間隔で最新の視聴者数を取得し、配信画面に表示するためである。

#### Acceptance Criteria
2.1. The CLI Tool shall 既存のチャット転送機能と並行して、視聴者数を受信・公開するHTTPサーバーを起動する

2.2. The CLI Tool shall GETリクエストに対して現在の同時視聴者数を返すHTTPエンドポイントを提供する

2.3. When Chrome Extensionから新しい視聴者数データをHTTP経由で受信した場合、the CLI Tool shall 内部の視聴者数を即座に更新する

2.4. The CLI Tool shall OBSブラウザソースから1秒間隔でポーリングされても安定して応答する

2.5. The CLI Tool shall CORS（Cross-Origin Resource Sharing）ヘッダを適切に設定し、OBSブラウザソースからのリクエストを許可する

2.6. The CLI Tool shall HTTPサーバーのポート番号をCLIオプションで指定可能にする

### Requirement 3: Chrome Extensionからローカルサーバーへの視聴者数送信

**Objective:** 配信者として、Chrome Extensionが取得した視聴者数がCLIツールのHTTPサーバーに自動的に転送されるようにしたい。手動操作なしで最新の値を反映するためである。

#### Acceptance Criteria
3.1. When 新しい同時視聴者数が取得されるたび、the Extension shall CLIツールのHTTPサーバーに視聴者数データを送信する

3.2. If HTTPサーバーへの送信に失敗した場合、the Extension shall エラーを記録し、次回の取得サイクルで再試行する（クラッシュしない）

3.3. If HTTPサーバーに接続できない状態が続く場合、the Extension shall ポップアップUIまたはバッジで接続エラーを通知する

### Requirement 4: 設定管理

**Objective:** 配信者として、HTTPサーバーの接続先情報をExtensionのUIで設定・保存したい。毎回入力する手間を省くためである。

#### Acceptance Criteria
4.1. The Extension shall ポップアップUIでHTTPサーバーの接続先（ホスト、ポート）を設定できる画面を提供する

4.2. When 設定が保存された場合、the Extension shall 次回以降のブラウザセッションでも設定を保持する

4.3. The Extension shall ホストのデフォルト値を`localhost`、ポートのデフォルト値をCLIツールのHTTPサーバーのデフォルトポートに合わせて設定する

### Requirement 5: 配信の自動検知と動作制御

**Objective:** 配信者として、配信ページを開くだけで自動的に視聴者数転送を開始し、ページを閉じたら停止してほしい。手動操作を最小限にするためである。

#### Acceptance Criteria
5.1. When Media Studio の配信詳細ページが開かれ and 設定が完了している場合、the Extension shall 自動的に同時視聴者数の取得と送信を開始する

5.2. When 配信詳細ページのタブが閉じられた場合、the Extension shall 取得と送信のサイクルを停止する

5.3. While 同時視聴者数の取得・送信が動作中、the Extension shall ツールバーアイコンのバッジに現在の視聴者数を表示する

5.4. When 配信が終了状態（Ended等）になった場合、the Extension shall 取得・送信サイクルを自動停止する

### Requirement 6: 既存機能との共存

**Objective:** 配信者として、CLIツールの既存チャット転送機能とHTTPサーバー機能を同じプロセスで安定して同時利用したい。

#### Acceptance Criteria
6.1. The CLI Tool shall 既存のチャットポーリング・わんコメ転送機能に影響を与えることなく、HTTPサーバーを並行稼働する

6.2. The CLI Tool shall HTTPサーバーのポートを、わんコメのデフォルトポート（11180）と衝突しない値に設定する

6.3. The CLI Tool shall グレースフルシャットダウン時にHTTPサーバーも適切に停止する
