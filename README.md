# x-live-to-wancome

X（Twitter）ライブ配信のチャットコメントをリアルタイムで取得し、コメント管理アプリ「わんコメ」（OneComme）に転送するブリッジCLIツール。

## 概要

X Liveにはチャットコメントの公式APIが存在せず、わんコメも公式にはX Liveに対応していません。本ツールがその間を橋渡しし、X Liveのコメントをわんコメのコメント表示・読み上げ・管理機能で扱えるようにします。

## 必要環境

- Node.js 18以上
- [わんコメ](https://onecomme.com/)（ローカルで起動済み）

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
| `--interval <ms>` | `3000` | コメント取得のポーリング間隔（ミリ秒） |

### 使用例

```bash
# URLを指定して起動
npx x-live-to-wancome https://x.com/i/broadcasts/1yKAPMPBOOzxb --service-id 550e8400-e29b-41d4-a716-446655440000

# ブロードキャストIDを直接指定
npx x-live-to-wancome 1yKAPMPBOOzxb --service-id 550e8400-e29b-41d4-a716-446655440000

# カスタムホスト・ポート・間隔を指定
npx x-live-to-wancome 1yKAPMPBOOzxb --service-id my-service-id --host 192.168.1.10 --port 8080 --interval 5000
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

```
X Live Chat API  →  取得  →  パース  →  重複フィルタ  →  わんコメAPI
(Periscope)         (3秒間隔)  (JSON変換)   (UUID照合)      (POST /api/comments)
```

1. 指定されたブロードキャストURLからメタデータを解決
2. チャットアクセス用トークンを取得
3. 3秒間隔でチャットメッセージをポーリング
4. メッセージをパースし、重複を除外してわんコメにPOST
5. 配信終了を検出したら自動停止

### 安定性機能

- **トークン自動リフレッシュ**: 有効期限の80%経過時点で自動更新
- **わんコメ接続断時のバッファリング**: 接続不能時はコメントをメモリに蓄積し、回復時にまとめて送信
- **重複コメント防止**: UUID照合で同一コメントの二重送信を防止
- **グレースフルシャットダウン**: Ctrl+C で安全に停止（未送信バッファをフラッシュしてから終了）

## テスト

```bash
npm test
```

## ライセンス

ISC
