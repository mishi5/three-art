# #201 プロジェクト全体（全シーン状態）の保存／読み込み 設計

- Issue: https://github.com/mishi5/three-art/issues/201

## 目的

「プロジェクト＝全シーン・全グラフの状態一式」を 1 ファイル（YAML）にまとめて保存／
読み込みできるようにする。既存の単一グラフ YAML 書出/読込（#65）は別機能として残す。

## 保存対象

`SceneSet` 相当（`src/apps/node-vj/scene/scene-store.ts`）を 1 ファイル化する。

- 全シーン（各 `Scene` の `id` / `name` / `graph`＝GraphDoc：ノード配置・接続・param・groups・labels）
- `activeId`（編集中シーン）
- `outputId`（#174 出力シーン選択。null は編集追従）
- `version`（`PROJECT_VERSION=1`）で後方互換を意識

アセットのバイナリはファイルに含めない。ノード params の `assetId` 参照のみが GraphDoc に
含まれ、読込後に既存 `restoreAssets()` が OPFS/IndexedDB から復元する。

## ファイル形式（YAML）

```yaml
version: 1          # PROJECT_VERSION
activeId: scene-...
outputId: null      # or scene id
scenes:
  - id: scene-...
    name: Scene 1
    graph:          # GraphDoc（version:1=GRAPH_VERSION を含む）
      version: 1
      nodes: [...]
      connections: [...]
      groups: [...]
      labels: [...]
```

## 純関数（`src/apps/node-vj/scene/project-file.ts`／新規）

- `serializeProject(set: SceneSet): string`
  - `PROJECT_VERSION` 付きで YAML 化。各シーンの `graph` は GraphDoc をそのまま埋め込む。
- `deserializeProject(text, registry): { project: SceneSet; warnings: string[] }`
  - YAML 破損 → throw（ルートが object でない／version 不一致／scenes 欠落・空 → throw）。
  - 各シーンの `graph` は既存 `serializeGraph`→`deserializeGraph` を再利用して検証し、
    未知ノード・不正接続・未知 param を捨てて warning（`scene <id>:` を前置して集約）。
  - シーン個別の graph が壊れている（version 不一致等）場合はそのシーンを空グラフで再生成し warning。
  - `activeId` が scenes に無ければ先頭シーンへフォールバックし warning。
  - `outputId` は scenes に存在すれば採用、無ければ null（追従）。
  - 有効シーンが 0 件になったら throw（クラッシュではなく明示エラー）。

不正・旧バージョンのファイルは throw または warning に落とし、UI 側で toast 表示する
（クラッシュさせない）。

## SceneManager 拡張

- `replaceAll(set: SceneSet): void` を追加。全シーン・activeId・outputId を差し替えて
  commit（永続化＋onChange 通知）。activeId が scenes に無ければ先頭へフォールバック。

## UI（`src/apps/node-vj/editor/graph-io-bar.ts`）

`buildGraphIoBar` に任意の `project` フックを追加し、右下バーへ 2 ボタンを足す。

- 「Proj保存」: `project.serialize()` を Blob 化し `node-vj-project-YYYYMMDD-HHMMSS.yaml`
  でダウンロード。
- 「Proj開く」: file input → `text()` → `project.apply(text)`（warnings を返す）。失敗時は
  例外メッセージを toast。

ダウンロードファイル名は純関数 `projectFileName(date): string` として project-file.ts に置き
テストする。

## main.ts の配線（読込フロー）

`project.apply(text)` の実装は main.ts に置き、状態を破棄して復元する：

1. `deserializeProject(text, registry)` で `project`/`warnings` を得る（失敗時は throw → toast）。
2. `history` を全クリア（旧シーンのトラックを捨てる）。
3. `sceneManager.replaceAll(project)`（onChange 発火でシーンパネル再描画）。
4. `reflectActiveScene()`（state 移譲・共有 graph へ反映・history.useScene・ensureStates・
   wireSceneProvider・`restoreAssets()`）。
5. `syncOutputScene()`（#174 出力シーン id を runtime へ反映）。

保存（`project.serialize`）は `snapshotActiveScene()` で編集中グラフをアクティブシーンへ
書き戻してから `serializeProject(sceneManager.toSceneSet())` を返す。SceneManager に現在の
集合を取り出す `toSceneSet()` を public 追加（既存 private toSet 相当）。

## テスト（TDD・純ロジック中心）

`src/apps/node-vj/scene/project-file.test.ts`

- 複数シーン round-trip 一致（param・ノード配置・接続・groups・labels・activeId・outputId）。
- outputId null / 指定の双方を round-trip。
- 未知ノード・不正接続を含むシーンは warning しつつ他は復元。
- version 不一致・YAML 破損・ルート非 object・scenes 欠落/空 → throw。
- activeId 不正 → 先頭フォールバック＋warning。
- outputId 不正 → null。
- `projectFileName` の形式。

`scene-manager.test.ts` に `replaceAll` のテストを追加。

UI/DOM・実ファイル I/O は headless 検証困難なため手動確認に委ねる。
