# Requirements Document

## Introduction

本仕様は、CLIオプション `--service-id` によるわんコメのサービスID直接指定を、枠の名前による指定に置き換える機能を定義する。ユーザーは覚えにくいサービスIDの代わりに枠の表示名を指定し、システムがわんコメAPI（`GET /services`）から名前検索でIDを自動解決する。これにより、CLI起動時の操作負担を大幅に軽減する。

## Requirements

### Requirement 1: サービス名によるCLI指定

**Objective:** ユーザーとして、CLIオプションで枠の名前を指定したい。サービスIDを毎回調べて入力する手間をなくすため。

#### Acceptance Criteria

1. The CLI shall `--service-name <名前>` オプションを受け付ける
2. When `--service-name` が指定された場合, the CLI shall サービスIDの自動解決を実行する
3. When `--service-id` と `--service-name` が同時に指定された場合, the CLI shall エラーを返し、どちらか一方のみ指定するよう案内する
4. When `--service-id` も `--service-name` も指定されない場合, the CLI shall エラーを返し、いずれか一方の指定が必要であることを案内する

### Requirement 2: わんコメAPIによるサービスID自動解決

**Objective:** システムとして、わんコメAPIの `GET /services` エンドポイントから枠の名前でサービスIDを検索・特定したい。ユーザーがIDを意識せずに済むようにするため。

#### Acceptance Criteria

1. When `--service-name` が指定された場合, the system shall わんコメAPI `GET /services` を呼び出してサービス一覧を取得する
2. When サービス一覧の中に指定された名前と完全一致するサービスが1件見つかった場合, the system shall そのサービスのIDを自動的に採用し、以降の処理に使用する
3. When 指定された名前に完全一致するサービスが見つからない場合, the system shall エラーを返し、指定された名前と利用可能なサービス名の一覧を表示する
4. When 指定された名前に完全一致するサービスが複数見つかった場合, the system shall エラーを返し、該当するサービスの名前とIDの一覧を表示して `--service-id` での直接指定を案内する

### Requirement 3: エラーハンドリングとAPI通信失敗

**Objective:** ユーザーとして、わんコメAPIとの通信に問題があった場合に分かりやすいエラーメッセージを受け取りたい。問題の原因を素早く特定して対処するため。

#### Acceptance Criteria

1. If わんコメAPIへの接続が拒否された場合, the system shall わんコメが起動しているか確認するよう促すエラーメッセージを表示する
2. If わんコメAPIがタイムアウトした場合, the system shall タイムアウトした旨のエラーメッセージを表示する
3. If わんコメAPIが2xx以外のステータスコードを返した場合, the system shall ステータスコードとレスポンス内容を含むエラーメッセージを表示する

### Requirement 4: 後方互換性

**Objective:** 既存ユーザーとして、`--service-id` オプションを引き続き使用できるようにしたい。既存のスクリプトやワークフローが壊れないようにするため。

#### Acceptance Criteria

1. The CLI shall `--service-id` オプションを引き続きサポートする
2. When `--service-id` が指定された場合, the system shall 従来通りそのIDを直接使用し、わんコメAPIへのサービス名検索を行わない
3. The CLI shall ヘルプメッセージ（usage）に `--service-name` と `--service-id` の両方のオプションを記載する
