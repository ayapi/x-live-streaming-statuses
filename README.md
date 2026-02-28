# x-live-to-wancome

X（Twitter）ライブ配信のチャットコメントをリアルタイムで取得し、コメント管理アプリ「わんコメ」（OneComme）に転送するブリッジCLIツール。同時視聴者数の取得・配信にも対応。

## 概要

X Liveにはチャットコメントの公式APIが存在せず、わんコメも公式にはX Liveに対応していません。本ツールがその間を橋渡しし、X Liveのコメントをわんコメのコメント表示・読み上げ・管理機能で扱えるようにします。

さらに、同梱のChrome Extensionと連携することで、Media Studio APIから同時視聴者数を取得し、OBSブラウザソースから1秒間隔でポーリングして配信画面に表示できます。

## 必要環境

- Node.js 18以上
- [わんコメ](https://onecomme.com/)（ローカルで起動済み）
- Chrome（視聴者数機能を使用する場合）

## インストール

```bash
npm install
npm run build
```

## 使い方

```bash
npx x-live-to-wancome <broadcast-url> --service-id <id> [options]
```

### 必須引数

| 引数 | 説明 |
|------|------|
| `<broadcast-url>` | Xライブ配信のURL または ブロードキャストID |
| `--service-id <id>` | わんコメの枠ID（サービスフレームのUUID） |

### オプション引数

| 引数 | デフォルト | 説明 |
|------|-----------|------|
| `--host <host>` | `localhost` | わんコメのホスト |
| `--port <port>` | `11180` | わんコメのポート |
| `--viewer-port <port>` | `11190` | 視聴者数HTTPサーバーのポート |
| `--interval <ms>` | `3000` | コメント取得のポーリング間隔（ミリ秒） |

### 使用例

```bash
# URLを指定して起動
npx x-live-to-wancome https://x.com/i/broadcasts/1yKAPMPBOOzxb --service-id 550e8400-e29b-41d4-a716-446655440000

# ブロードキャストIDを直接指定
npx x-live-to-wancome 1yKAPMPBOOzxb --service-id 550e8400-e29b-41d4-a716-446655440000

# カスタムホスト・ポート・間隔を指定
npx x-live-to-wancome 1yKAPMPBOOzxb --service-id my-service-id --host 192.168.1.10 --port 8080 --interval 5000

# 視聴者数サーバーのポートを変更
npx x-live-to-wancome 1yKAPMPBOOzxb --service-id my-service-id --viewer-port 9999
```

### 開発モード

```bash
npm run dev -- <broadcast-url> --service-id <id>
```

## わんコメの枠IDの確認方法

1. わんコメを起動する
2. 接続先として使用するサービスフレームを作成・選択する
3. サービスフレームのIDを `--service-id` に指定する

## 動作の仕組み

### チャット転送

```
X Live Chat API  →  取得  →  パース  →  重複フィルタ  →  わんコメAPI
(Periscope)         (3秒間隔)  (JSON変換)   (UUID照合)      (POST /api/comments)
```

1. 指定されたブロードキャストURLからメタデータを解決
2. チャットアクセス用トークンを取得
3. 3秒間隔でチャットメッセージをポーリング
4. メッセージをパースし、重複を除外してわんコメにPOST
5. 配信終了を検出したら自動停止

### 同時視聴者数

```
Media Studio  →  Chrome Extension  →  CLIサーバー  →  OBS
(API)            (POST /api/         (GET /api/       (ブラウザソース
                  viewer-count)       viewer-count)    1秒ポーリング)
```

1. Chrome ExtensionがMedia Studioページから同時視聴者数を自動取得
2. ExtensionがCLIツール内のHTTPサーバーに視聴者数をPOST送信
3. OBSブラウザソースから1秒間隔でGETポーリングし配信画面に表示

## Chrome Extension

`extension/` ディレクトリに同梱されている Chrome Extension を使用して、X Live の同時視聴者数を取得できます。

### Extension のビルド

```bash
cd extension
npm install
npm run build
```

### Extension のインストール

1. Chrome で `chrome://extensions` を開く
2. 「デベロッパーモード」を有効にする
3. 「パッケージ化されていない拡張機能を読み込む」で `extension/dist` を選択

### Extension の使い方

1. CLIツールを起動する（視聴者数サーバーがポート11190で自動起動）
2. Chrome で Media Studio の配信詳細ページ（`studio.x.com/producer/broadcasts/*`）を開く
3. Extension が自動的に視聴者数の取得・送信を開始
4. OBS ブラウザソースで `http://localhost:11190/api/viewer-count` をポーリング

### Extension の設定

Extension のポップアップUIからサーバー接続先を設定できます。

| 設定 | デフォルト | 説明 |
|------|-----------|------|
| ホスト | `localhost` | CLIサーバーのホスト |
| ポート | `11190` | CLIサーバーのポート |

### 安定性機能

- **トークン自動リフレッシュ**: 有効期限の80%経過時点で自動更新
- **わんコメ接続断時のバッファリング**: 接続不能時はコメントをメモリに蓄積し、回復時にまとめて送信
- **重複コメント防止**: UUID照合で同一コメントの二重送信を防止
- **グレースフルシャットダウン**: Ctrl+C で安全に停止（未送信バッファをフラッシュ、視聴者数サーバーを停止してから終了）

## テスト

```bash
# CLIツールのテスト
npm test

# Chrome Extensionのテスト
cd extension && npm test
```

## ライセンス

ISC
