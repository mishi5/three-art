# preset import/export YAML 化 実装計画

**Goal:** Issue #9 (https://github.com/mishi5/three-art/issues/9) — pose-particles の preset import/export 形式を JSON から YAML に変更する。人間可読性とコメント挿入のしやすさのため。

**Architecture:** SettingsPanel.ts の export/import ロジックから直列化部分を純関数 `serializePresetYaml(settings): string` / `parsePresetYaml(text): Partial<Settings>` として `src/pose-particles/ui/preset-yaml.ts` に切り出し、Bun test で単体テストする。SettingsPanel 側はブラウザ依存（Blob/`<input type=file>`/`<a download>`）なのでラッパとしてのみ利用し、ラベルと関数名を `*.yaml` に更新する。yaml ライブラリ (`yaml@^2.8.4`) は既存依存。旧 `.json` preset の読み込みは行わない。

**Tech Stack:** TypeScript, `yaml` (npm), Bun test runner.

**Spec:** インラインで定義（軽量タスクのため）。

## File Structure

| パス | 役割 | 種別 |
|------|------|------|
| `src/pose-particles/ui/preset-yaml.ts` | 純関数 `serializePresetYaml` / `parsePresetYaml` を提供 | Create |
| `src/pose-particles/ui/preset-yaml.test.ts` | 上記純関数の単体テスト | Create |
| `src/pose-particles/ui/SettingsPanel.ts` | `exportJson/importJson` → `exportYaml/importYaml` にリネーム、ラベル `(.json)` → `(.yaml)`、accept を `.yaml,.yml`、ロジックは純関数に委譲 | Modify |

## Task 1: `serializePresetYaml` を TDD で追加

- RED: `preset-yaml.test.ts` で「Settings を YAML.stringify した文字列を返す」テストを書き、import 失敗で落ちることを確認。
- GREEN: `preset-yaml.ts` で `YAML.stringify(settings)` を返す純関数を実装。
- 検証: `YAML.parse` で round-trip すると元の Settings に一致すること。

## Task 2: `parsePresetYaml` を TDD で追加

- RED: 「YAML 文字列を `Partial<Settings>` として返す」テスト + 「壊れた YAML は throw する」テスト。
- GREEN: `YAML.parse(text) as Partial<Settings>` を返す。

## Task 3: SettingsPanel をリファクタ

- `exportJson` → `exportYaml`：拡張子 `.yaml`、MIME `application/x-yaml`、ファイル名 `pose-particles-preset-<ts>.yaml`、本文は `serializePresetYaml(this.settings)`。
- `importJson` → `importYaml`：`accept = ".yaml,.yml,application/x-yaml,text/yaml"`、本文は `parsePresetYaml(text)` に委譲。
- アクション名 / ラベル: `export preset (.yaml)` / `import preset (.yaml)`。
- 旧 JSON を import する経路は削除（互換性なし）。
- 既存の `bun test` 全件パスを再確認。

## 互換性 / スコープ外

- localStorage 永続化 (`saveSettings/loadSettings`) は引き続き JSON。
- `AnalysisCache.ts` の `JSON.stringify/parse` は対象外。
- 旧 `.json` preset の読み込みはサポートしない。
