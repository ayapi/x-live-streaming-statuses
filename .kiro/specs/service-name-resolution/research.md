# Research & Design Decisions

---
**Purpose**: サービス名によるID自動解決機能の技術設計に必要な調査結果を記録する。
---

## Summary
- **Feature**: `service-name-resolution`
- **Discovery Scope**: Extension（既存CLIとわんコメ連携への機能追加）
- **Key Findings**:
  1. わんコメの `GET /api/services` エンドポイントは `Service[]` 配列を返し、各要素に `id: string` と `name: string` が含まれる
  2. `Service` インターフェースは `@onecomme.com/onesdk` v9.0.0-alpha.1 で型定義されている
  3. 既存の `cli-config.ts` は `--service-id` を必須引数として処理しており、拡張ポイントが明確

## Research Log

### わんコメ GET /api/services エンドポイント
- **Context**: `--service-name` で指定された名前からサービスIDを解決するため、わんコメAPIのサービス一覧取得エンドポイントの仕様を調査
- **Sources Consulted**:
  - OneComme公式ドキュメント: https://onecomme.com/docs/developer/http-api
  - OneCommeフォーラム: https://forum.onecomme.com/t/topic/1531, https://forum.onecomme.com/t/topic/1878
  - `@onecomme.com/onesdk` v9.0.0-alpha.1 型定義 (`dist/types/Service.d.ts`, `dist/types/ApiActions.d.ts`)
- **Findings**:
  - エンドポイント: `GET http://{host}:{port}/api/services`
  - レスポンス: `Service[]` — わんコメに登録された枠（フレーム）の配列
  - `Service` インターフェース（名前解決に必要なフィールドのみ抜粋）:
    ```typescript
    interface Service {
      id: string;       // 枠の一意識別子（UUID）
      name: string;     // 枠の表示名（ユーザーが設定した名前）
      url: string;
      enabled: boolean;
      // ... 他フィールド省略
    }
    ```
  - `name` フィールドはわんコメUIで枠に設定される表示名で、ユーザーが自由に命名可能
  - 同じ名前を複数の枠に設定可能（nameはユニーク制約なし）
  - localhostからのアクセスはデフォルトで許可（外部IPは設定が必要）
- **Implications**: `name` フィールドで完全一致検索することで、IDを一意に特定可能。ただし同名の枠が複数存在する可能性があるため、複数ヒット時のエラーハンドリングが必要。

### 既存コードの拡張ポイント分析
- **Context**: 変更対象ファイルと影響範囲の特定
- **Sources Consulted**: `src/cli-config.ts`, `src/types.ts`, `src/index.ts`, `src/onecomme-client.ts`
- **Findings**:
  - `cli-config.ts`: `parseArgs()` が `--service-id` を解析し `CLIConfig.oneCommeServiceId` に格納。forループ内にオプション追加は容易
  - `types.ts`: `CLIConfig.oneCommeServiceId` は `string` 型で必須。`ConfigError` はdiscriminated union。両方とも拡張が必要
  - `index.ts`: `config.oneCommeServiceId` を直接 `createOneCommeClient()` に渡している（L78-82）。サービス解決ステップの挿入ポイントはここ
  - `onecomme-client.ts`: `OneCommeClientConfig.serviceId` は変更不要（解決済みIDを受け取る）
- **Implications**: 主に3ファイルの変更（cli-config, types, index）と1ファイルの新規作成（service-resolver）で実現可能。onecomme-clientは変更不要。

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| 起動時1回解決 | CLI解析後、パイプライン開始前にサービス名→ID解決を1回実行 | シンプル、既存パイプラインに影響なし | 起動後にわんコメ側で枠が変更されても追従しない | 現ユースケースに最適 |
| 遅延解決 | 最初のコメント送信時に解決 | わんコメの起動タイミングに柔軟 | エラー発生タイミングが遅い、コメント送信パスが複雑化 | 過剰設計 |

**選択**: 起動時1回解決 — CLIツールは配信セッション単位で起動するため、起動時にIDを確定して以降は固定するのが最もシンプルかつ確実。

## Design Decisions

### Decision: サービス名解決の実行タイミング
- **Context**: `--service-name` 指定時のID解決をいつ実行するか
- **Alternatives Considered**:
  1. CLI引数解析時（`parseArgs`内） — 同期的なAPI呼び出しが必要になり、関心分離が崩れる
  2. パイプライン開始前（`index.ts`内、ブロードキャスト解決と並行） — 明確なフェーズ分離
  3. コメント送信時（遅延解決） — 複雑化、エラー検知が遅い
- **Selected Approach**: パイプライン開始前にindex.ts内で実行
- **Rationale**: CLI引数解析は同期・純粋関数であるべき（既存パターン踏襲）。サービス解決はネットワーク通信を伴うため、index.tsの初期化フェーズで実行するのが自然。
- **Trade-offs**: `--service-name` 使用時はわんコメが起動済みでないとエラーになるが、これはユーザーにとって明確なフィードバック。

### Decision: 名前の照合方式
- **Context**: ユーザー指定の名前とサービス一覧の照合方法
- **Alternatives Considered**:
  1. 完全一致のみ
  2. 部分一致（前方一致・含む）
  3. あいまい一致（ファジー検索）
- **Selected Approach**: 完全一致のみ
- **Rationale**: 要件定義で「完全一致」と明記。枠の名前は短く明確であることが多く、部分一致はユーザーの意図しない枠にマッチするリスクがある。
- **Trade-offs**: ユーザーは枠名を正確に入力する必要があるが、不一致時にサービス名一覧を表示することで入力ミスへのフォローを行う。

## Risks & Mitigations
- **Risk 1: わんコメ未起動** — `--service-name` 指定時にわんコメが起動していないと接続エラーになる
  - Mitigation: 接続拒否時に「わんコメが起動しているか確認してください」と案内するエラーメッセージを表示（要件3.1）
- **Risk 2: 同名枠の存在** — 同じ名前の枠が複数ある場合にIDを一意特定できない
  - Mitigation: 複数ヒット時はエラーとし、該当する枠のIDリストを表示して`--service-id`での直接指定を案内（要件2.4）

## References
- [OneComme HTTP API](https://onecomme.com/docs/developer/http-api) — 公式ドキュメント
- [OneComme Postman API](https://documenter.getpostman.com/view/20406518/2s9Y5SX6EE) — 詳細仕様
- [@onecomme.com/onesdk v9.0.0-alpha.1](https://www.npmjs.com/package/@onecomme.com/onesdk) — TypeScript型定義（Service.d.ts）
- [OneCommeフォーラム: service.idの取得方法](https://forum.onecomme.com/t/topic/1531) — API使用例
- [OneCommeフォーラム: ServiceIdの指定方法](https://forum.onecomme.com/t/topic/1878) — GET /api/servicesの言及
