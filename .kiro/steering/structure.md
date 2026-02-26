# プロジェクト構造

## 構成方針

フラット・コンポーネントベース構成。`src/`直下にコンポーネント単位のファイルを配置し、サブディレクトリは使わない。各コンポーネントはインターフェース定義+ファクトリ関数+テストの3点セットで構成される。

## ディレクトリパターン

### ソースコード (`src/`)
**場所**: `src/*.ts`
**目的**: すべてのアプリケーションコード（フラット配置）
**例**: `broadcast-resolver.ts`, `chat-poller.ts`, `onecomme-client.ts`

### テスト (`src/`)
**場所**: `src/*.test.ts`（ソースと同階層にコロケーション）
**目的**: 各コンポーネントの単体テスト
**例**: `broadcast-resolver.test.ts`, `message-parser.test.ts`

### 共通基盤 (`src/`)
**場所**: `src/types.ts`, `src/result.ts`, `src/logger.ts`
**目的**: プロジェクト全体で共有される型定義・ユーティリティ

### エントリーポイント
**場所**: `src/index.ts`
**目的**: CLIエントリーポイント。全コンポーネントを初期化・組み立て・実行

### 仕様 (`.kiro/specs/`)
**場所**: `.kiro/specs/{feature-name}/`
**目的**: 機能仕様書（要件・設計・タスク）

### ステアリング (`.kiro/steering/`)
**場所**: `.kiro/steering/*.md`
**目的**: プロジェクトメモリ（製品・技術・構造のガイダンス）

## 命名規則

- **ファイル**: kebab-case（`broadcast-resolver.ts`、`cli-config.ts`）
- **インターフェース**: PascalCase（`BroadcastResolver`、`ChatPoller`）
- **ファクトリ関数**: camelCase `create` + PascalCase（`createBroadcastResolver`）
- **型**: PascalCase、エラー型は `XxxError` サフィックス
- **テスト**: `{source-name}.test.ts`

## インポート構成

```typescript
// 型インポート（type-onlyを明示）
import type { Result } from "./result.js";
import type { BroadcastInfo, BroadcastError } from "./types.js";

// 値インポート
import { ok, err } from "./result.js";
import { createLogger } from "./logger.js";
```

**パスエイリアス**: なし。相対パス（`./xxx.js`）を使用、`.js`拡張子必須（ESM）

## コード構成の原則

- **1ファイル1コンポーネント**: 各ファイルは単一の責務を持つコンポーネントを定義
- **インターフェースファースト**: `export interface Xxx { ... }` でAPI定義 → `export function createXxx(): Xxx` で実装
- **型定義の集中管理**: ドメインモデル・エラー型・設定型は `types.ts` に集約
- **ロガーの注入**: 各コンポーネントは `createLogger("ComponentName")` でモジュールスコープのロガーを生成

---
_パターンを記述。ファイルツリーではない。パターンに従う新規ファイルはステアリング更新不要_
