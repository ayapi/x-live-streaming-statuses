# 要件定義書

## はじめに

本仕様は、CLIツールの起動時の利便性を向上させるための2つの改善を定義する。

1. **broadcast-url自動取得**: わんコメHTTP APIの `GET /api/services` エンドポイントからURLを自動で取得し、`--broadcast-url` が省略された場合にそれをデフォルト値として使用する。
2. **service-nameデフォルト化**: `--service-name` と `--service-id` の両方が省略された場合、`--service-name=X` をデフォルトとして適用する。

これにより、ユーザーは引数なしでCLIを起動できるようになり、「ゼロ設定で動作」というプロダクトのバリューがさらに強化される。

## 要件

### 要件 1: service-nameのデフォルト値

**目的:** ユーザーとして、`--service-name` と `--service-id` の両方を省略した場合に自動的に `--service-name=X` が適用されてほしい。これにより、X Liveが主要ユースケースである本ツールの起動手順が簡略化される。

#### 受け入れ基準

1. When `--service-name` と `--service-id` のどちらもCLI引数に指定されていない, the CLIツール shall `--service-name=X` をデフォルト値として適用し、サービス解決を実行する。
2. When `--service-name` がCLI引数に指定されている, the CLIツール shall 指定された値を使用し、デフォルト値を適用しない。
3. When `--service-id` がCLI引数に指定されている, the CLIツール shall 指定された値を使用し、デフォルト値を適用しない。

### 要件 2: わんコメAPIからのbroadcast-url自動取得

**目的:** ユーザーとして、`broadcast-url` を省略した場合にわんコメの `GET /api/services` から配信URLを自動取得してほしい。これにより、わんコメ側で既にサービスが設定されていれば引数なしで起動できるようになる。

#### 受け入れ基準

1. When `broadcast-url` がCLI引数に指定されていない, the CLIツール shall わんコメHTTP APIの `GET /api/services` エンドポイントを呼び出し、対象サービスに紐づくURLを取得する。
2. When `broadcast-url` がCLI引数に指定されている, the CLIツール shall 指定された値を使用し、API自動取得を行わない。
3. The CLIツール shall 自動取得したURLを、CLI引数で直接指定した場合と同様に `broadcastUrl` として扱う。

### 要件 3: エラーハンドリング

**目的:** ユーザーとして、自動取得が失敗した場合に明確なエラーメッセージを受け取りたい。原因を把握して対処できるようにするため。

#### 受け入れ基準

1. If わんコメAPIへの接続に失敗した場合（`broadcast-url` 省略時）, the CLIツール shall 接続先ホスト・ポート情報を含むエラーメッセージを表示して終了する。
2. If わんコメAPIのレスポンスに対象サービスが見つからない場合, the CLIツール shall 指定されたサービス名（またはID）と、利用可能なサービス一覧を含むエラーメッセージを表示して終了する。
3. If わんコメAPIのレスポンスに対象サービスは存在するがURLが含まれていない場合, the CLIツール shall URLが取得できなかった旨のエラーメッセージを表示して終了する。

