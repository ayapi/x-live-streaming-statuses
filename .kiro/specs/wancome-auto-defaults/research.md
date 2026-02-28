# Research & Design Decisions

---
**Purpose**: CLIデフォルト値自動化機能の技術設計に必要な調査結果を記録する。
---

## Summary
- **Feature**: `wancome-auto-defaults`
- **Discovery Scope**: Extension（既存CLIとServiceResolverの機能拡張）
- **Key Findings**:
  1. わんコメ `GET /api/services` レスポンスの `Service` 型に `url: string` フィールドが存在し、配信URLの自動取得に利用可能
  2. 既存の `ServiceResolver` は名前→ID解決のみ対応しており、ID→URL取得やURL抽出には拡張が必要
  3. `CLIConfig.broadcastUrl` は必須フィールド（`string`）であり、オプション化には型変更とバリデーション移動が必要

## Research Log

### わんコメ Service 型の url フィールド
- **Context**: `broadcast-url` 省略時にわんコメAPIからURLを自動取得する方法の調査
- **Sources Consulted**:
  - `.kiro/specs/service-name-resolution/research.md` の既存調査結果
  - `@onecomme.com/onesdk` v9.0.0-alpha.1 型定義（`Service.d.ts`）
- **Findings**:
  - わんコメの `Service` インターフェースには `url: string` フィールドが存在する
  - このフィールドにはわんコメUIで枠に設定された配信URLが格納される
  - X Liveの枠の場合、`https://x.com/i/broadcasts/{id}` 形式のURLが格納されることが期待される
  - URLが未設定の場合、空文字列（`""`）になる可能性がある
- **Implications**: 既存の `OneCommeService` 型に `url` フィールドを追加し、`ServiceResolver` の戻り値にURLを含めることで自動取得が実現可能

### 既存コードの拡張ポイント分析
- **Context**: 変更対象ファイルと影響範囲の特定
- **Sources Consulted**: `src/cli-config.ts`, `src/types.ts`, `src/index.ts`, `src/service-resolver.ts`
- **Findings**:
  - `cli-config.ts`: `broadcastUrl` は `parseArgs` 内で必須バリデーション → オプション化にはバリデーション削除が必要
  - `cli-config.ts`: `serviceId`/`serviceName` 未指定時に `missing_service_target` エラー → デフォルト適用に変更
  - `cli-config.ts`: `broadcastUrl` のURL形式バリデーション（`extractBroadcastId`）も `parseArgs` 内 → 移動が必要
  - `service-resolver.ts`: `resolve(serviceName: string)` → `resolve(target: ServiceTarget)` に一般化
  - `service-resolver.ts`: 戻り値 `Result<string, ...>` → `Result<ResolvedService, ...>` に拡張
  - `index.ts`: サービス解決は broadcastUrl解決の前に実行済み → フロー順序の変更不要
- **Implications**: 主に4ファイルの変更（cli-config, types, service-resolver, index）。新規ファイル不要。

### 実行フローの変更分析
- **Context**: broadcastUrl省略時の処理フロー設計
- **Sources Consulted**: `src/index.ts` の現在のフロー
- **Findings**:
  - 現在のフロー: parseArgs → service解決(name時のみ) → broadcast解決
  - broadcastUrl省略時: service解決でURLも取得 → それをbroadcastUrlとして使用
  - `--service-id` 指定かつ broadcastUrl省略: API呼び出しが新規に必要（IDでサービスを検索してURLを取得）
  - フロー決定マトリクス:
    - broadcastUrl ✓ + service-id ✓ → API呼び出し不要（現行動作）
    - broadcastUrl ✓ + service-name ✓ → 名前解決のみ（現行動作）
    - broadcastUrl ✗ + service-id ✓ → ID検索 + URL取得（新規）
    - broadcastUrl ✗ + service-name ✓ → 名前解決 + URL取得（新規）
    - broadcastUrl ✗ + 未指定 → デフォルトname=X + 名前解決 + URL取得（新規）
- **Implications**: ServiceResolverが `ServiceTarget`（name/id両方）を受け取れるよう一般化し、常に `{ serviceId, url }` を返す設計が最適

## Architecture Pattern Evaluation

| Option | Description | Strengths | Risks / Limitations | Notes |
|--------|-------------|-----------|---------------------|-------|
| ServiceResolver拡張 | 既存のServiceResolverの入力・出力を拡張 | 最小変更、既存パターン踏襲、API呼び出し1回で完結 | ServiceResolverの責務が「名前解決」から「サービス情報取得」に拡大 | 選択 |
| 新規コンポーネント追加 | BroadcastUrlFetcher等の独立コンポーネントを新設 | 単一責務の維持 | API呼び出し重複、コード重複、過剰設計 | 不採用 |

## Design Decisions

### Decision: ServiceResolverの入力型変更
- **Context**: 名前解決だけでなくID検索も必要になった
- **Alternatives Considered**:
  1. `resolve(serviceName: string)` のまま、ID検索用の別メソッド追加
  2. `resolve(target: ServiceTarget)` に一般化
- **Selected Approach**: `resolve(target: ServiceTarget)` に一般化
- **Rationale**: 内部的にはどちらも `GET /api/services` を呼んでフィルタリングするだけであり、分岐ロジックをresolver内部に閉じ込めることで呼び出し側をシンプルに保てる
- **Trade-offs**: resolverインターフェースの変更が必要だが、呼び出し元は index.ts のみで影響は限定的

### Decision: CLIConfigのbroadcastUrlオプション化
- **Context**: broadcastUrl省略時にAPI自動取得するため、型をオプションにする必要がある
- **Alternatives Considered**:
  1. `broadcastUrl: string | undefined` にする
  2. `broadcastUrl` を空文字列で表現する
  3. CLIConfigを2つの型（broadcastUrl有/無）のunionにする
- **Selected Approach**: `broadcastUrl: string | undefined`
- **Rationale**: 最もシンプルかつ明示的。空文字列はセンチネル値であり意図が不明確。union型は過剰。
- **Trade-offs**: index.tsでのnullチェックが増えるが、フロー上1箇所のみ

### Decision: broadcastUrlバリデーションの移動
- **Context**: broadcastUrlがオプションになると、parseArgs内でのURL形式バリデーション（extractBroadcastId）を省略時にスキップする必要がある
- **Selected Approach**: broadcastUrlが指定された場合のみparseArgs内でバリデーション実行。省略時はバリデーションをスキップし、index.ts側で最終的なbroadcastUrl確定後にバリデーションを実行する。
- **Rationale**: parseArgsに渡された値は従来通り即座にバリデーション。API自動取得したURLのバリデーションはindex.tsの責務。

## Risks & Mitigations
- **Risk 1: わんコメのServiceにURLが未設定** — 枠は存在するがURL欄が空の場合、broadcastUrlを取得できない
  - Mitigation: `url_not_found` エラーを定義し、URLが空の場合に明確なメッセージを表示
- **Risk 2: わんコメ未起動時のゼロ引数起動** — 全デフォルト値で起動した場合、わんコメ接続必須
  - Mitigation: 接続エラー時に「わんコメが起動しているか確認してください」の案内を表示（既存エラーハンドリングで対応済み）
- **Risk 3: わんコメのURL形式がbroadcast URLとして不正** — ユーザーが意図しないURLを枠に設定している場合
  - Mitigation: 取得したURLも `extractBroadcastId` でバリデーションし、不正な場合はエラー表示

## References
- `.kiro/specs/service-name-resolution/research.md` — 前回のわんコメAPI調査結果
- [@onecomme.com/onesdk v9.0.0-alpha.1](https://www.npmjs.com/package/@onecomme.com/onesdk) — Service型定義
