# 技術スタック

## アーキテクチャ

パイプライン型アーキテクチャ。各コンポーネントはファクトリ関数（`createXxx`）で生成され、インターフェースを通じて疎結合に連携する。エラーハンドリングにはResult型を採用し、例外ではなく明示的な成功/失敗を返す。

## コア技術

- **言語**: TypeScript（strict mode）
- **ランタイム**: Node.js 18+
- **モジュール**: ESM（`"type": "module"`、Node16解決）
- **ターゲット**: ES2022

## 主要ライブラリ

ゼロ依存（`dependencies`なし）。Node.js標準の`fetch`のみ使用。

- **vitest**: テストフレームワーク
- **tsx**: 開発時TypeScript実行

## 開発標準

### 型安全

- TypeScript strict mode有効
- `Result<T, E>`型で成功/失敗を明示（例外を投げない）
- エラー型はdiscriminated union（`kind`フィールドで判別）

### エラーハンドリングパターン

```typescript
// Result型 (result.ts)
type Result<T, E> = Ok<T> | Err<E>;

// Discriminated union error
type BroadcastError =
  | { kind: "invalid_url"; url: string }
  | { kind: "not_found"; broadcastId: string }
  | { kind: "api_error"; status: number; message: string };
```

### テスト

- Vitest使用、コロケーション（`*.test.ts`をソースと同階層に配置）
- 外部依存（fetch）はファクトリ関数のDIで注入・モック

### コード品質

- JSDoc日本語コメントで公開関数を記述
- ログ出力は構造化ロガー（`createLogger(component)`）経由

## 開発環境

### 必須ツール

- Node.js 18+
- npm

### 共通コマンド

```bash
# 開発: npm run dev -- <args>
# ビルド: npm run build
# テスト: npm test
# テスト(watch): npm run test:watch
```

## 主要な技術的判断

- **ゼロ依存**: 外部パッケージに依存せず、Node.js標準APIのみで実装。メンテナンスコスト最小化
- **Result型**: Rust風のResult型を自前実装。try-catchの暗黙的エラーフローを排除
- **ファクトリ関数パターン**: クラスではなく`createXxx`ファクトリ関数でコンポーネント生成。DI容易・テスタブル
- **fetch注入**: 全HTTP通信コンポーネントが`fetchFn`パラメータを受け取り、テスト時にモック可能

---
_標準とパターンを記述。全依存関係のリストではない_
