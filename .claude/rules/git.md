# Git ルール

## コミットメッセージ

- コミットメッセージの先頭には必ず関連する Issue 番号を入れる
- Issueと紐づかない軽微な変更は、番号欄に「chore」を記載する
- 形式: `#<番号> <変更種別>: <内容の説明>`
- 例: `#4 fix: カメラパラメータ調整`

## Issue 対応時の worktree フロー

**Issue 対応を指示されたら、必ず以下の手順に従うこと。worktree を使わずに直接 main で作業してはならない。**

1. `gh issue view` で Issue 内容を確認
2. `gh issue view <番号> --repo mishi5/three-art --comments` でコメントを確認し、他者が対応開始済みでないか確認する
   - 「対応開始」等のコメントがあれば、**重複を避けるため対応を取りやめ、ユーザにその旨を報告する**
   - 対応開始コメントがなければ、`gh issue comment <番号> --repo mishi5/three-art --body "対応開始します"` を投稿してから次へ進む
3. `.worktrees/` に worktree を作成（ブランチ名: `fix/<番号>-<slug>` or `feature/<番号>-<slug>`）
4. worktree 内でベースラインテスト実行（全件パス確認）
5. TDD でテスト → 実装 → 全テストパス
   - 設計と実装計画もworktree内で実施してドキュメントもworktreeで管理すること。
   - **plan / spec ドキュメントには必ず対象 Issue の URL（`https://github.com/mishi5/three-art/issues/<番号>`）を記載すること。** 複数 Issue にまたがる場合は全て列挙する。
6. コミット・プッシュ → PR 作成 → マージ
   - **PR 本文に `Closes #xx` / `Fixes #xx` を書かないこと。** マージ時に Issue が自動クローズされてしまうため。
7. ユーザに動作確認を促す
8. ユーザが確認OKを出した後、Issue に対応内容を日本語でコメントしてクローズする
9. worktree・ブランチを削除、main を pull

### コメント＋クローズの手順

```bash
gh issue comment <number> --repo mishi5/three-art --body "..."
gh issue close <number> --repo mishi5/three-art
```

コメント例:
```
## 対応内容
- `src/modules/joint-anchors.js`: 関節平滑化のEMA係数を調整
- `tests/joint-anchors.test.js`: 関連テスト3件追加

コミット: e78d036
```

## 複数 Issue をまとめて対応する場合（バンドルブランチ）

複数の関連 Issue をまとめて対応するよう指示された場合、以下の手順に従う。

### 概要

```
main
 └── bundle/<テーマslug>          ← まとめブランチ（main から作成）
      ├── fix/<番号>-<slug>       ← 各 Issue の作業ブランチ
      ├── feature/<番号>-<slug>
      └── ...
```

### 手順

1. **まとめブランチの作成**: main から `bundle/<テーマslug>` ブランチを作成し、`.worktrees/` に worktree を用意する
2. **各 Issue の対応**: 通常の worktree フローに従い、各 Issue ごとにブランチを作成する
   - ブランチの派生元は `bundle/<テーマslug>` とする（main ではない）
   - 各 Issue の worktree は `.worktrees/` 内に作成する
   - 対応開始コメント・TDD・テスト全件パスなど、通常フローのルールはすべて適用
3. **まとめブランチへのマージ**: 各 Issue の作業が完了したら、PR を `bundle/<テーマslug>` ブランチ向けに作成してマージする
   - PR 本文に `Closes #xx` / `Fixes #xx` を書かないこと（通常フローと同じ）
4. **全 Issue 完了後**: まとめブランチから main 向けの PR を作成する
   - PR タイトルに含まれる Issue 番号を列挙する（例: `#10 #11 #12 bundle: パーティクル表現改善 Phase2`）
   - ユーザに動作確認を促す
5. **main へのマージ**: ユーザの確認OK後、まとめブランチを main にマージする
6. **クローズ処理**: 各 Issue に対応内容をコメントしてクローズする（通常フローと同じ）
7. **後片付け**: 各 Issue の worktree・ブランチ、まとめブランチの worktree・ブランチを削除し、main を pull

### 注意事項

- 各 Issue の作業ブランチ間で競合が発生した場合は、まとめブランチ上で解決する
- まとめブランチへのマージ順序は、依存関係がある場合はそれに従う
- 途中で Issue を追加・除外する場合はユーザに確認する

## 対応中に既存のバグ・エラーを発見した場合

作業中に、現在対応している Issue とは無関係な既存のバグやエラーを発見した場合:

1. 発見したバグ・エラーの内容を**ユーザに報告**し、Issue を作成してよいか確認を促す。
2. ユーザが確認OKを出した後に Issue を作成する。
3. 即時対応するか別途対応するかはユーザの指示に従う。

**現在の作業を中断して勝手に修正しないこと。**
