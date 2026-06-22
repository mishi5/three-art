# #154 アセット管理 UI（永続アセットライブラリ）設計

- Issue: https://github.com/mishi5/three-art/issues/154
- Epic: https://github.com/mishi5/three-art/issues/56
- 作成日: 2026-06-23

## 目的

動画 / 画像 / 音声アセットを **セッションを跨いで永続保存**し、再利用できるライブラリを node-vj に追加する。
読み込んだアセットを一覧表示し、ドラッグ&ドロップで既存のファイル入力ノード（Video/Audio/ImageFileInput）へ割り当てる。
グラフ保存(#65)時にノードが使うアセットの参照を保存し、読込時にライブラリから自動復元する。

## スコープ（確定事項）

- 対象種別: **画像・動画・音声すべて**。
- バイナリ保存: **OPFS + IndexedDB ハイブリッド**（②）。
  - 100〜500MB 程度の動画を多数扱う想定のため、ストリーミング書き込み可能な OPFS にバイナリ本体を置く。
  - メタデータ・サムネは小さいので IndexedDB に置く。
- グラフ保存統合: **フル**。ファイル入力ノードに `assetId` を持たせ、保存・読込で round-trip 復元する。
- 容量管理: **手動削除のみ**（LRU 自動削除はしない / YAGNI）。クォータ超過は catch して警告表示。

## 非スコープ（YAGNI）

- LRU / 自動退避。
- OPFS の Worker 同期アクセスハンドル（`createSyncAccessHandle`）による高速化。書き込みは単発操作なのでメインスレッド `createWritable()` で十分。将来の最適化余地として残す。
- 音声の波形サムネ生成（種別アイコンで代替）。
- SQLite 等の追加 WASM 依存。

## アーキテクチャ

新規 `src/apps/node-vj/asset/` モジュール。既存の `graph-store.ts`（localStorage アダプタ方式）と同じく、
**ストレージをアダプタ境界で抽象化**し、上位ロジック・UI・ノード統合をモックで純粋にテストできる形にする。

### ストレージ層（2 層をアダプタ分離）

- `BinaryStore` インターフェース（バイナリ本体 I/O）
  - `put(id, blob): Promise<void>`
  - `getFile(id): Promise<File | null>`（再生時に `URL.createObjectURL(file)` で使う）
  - `delete(id): Promise<void>`
  - `has(id): Promise<boolean>`
  - 実装: `opfsBinaryStore()`（本番・`navigator.storage.getDirectory()` + `createWritable()`）/
    `memoryBinaryStore()`（テスト用・Map）
- `MetaStore` インターフェース（メタ + サムネ）
  - `AssetMeta { id, kind, fileName, mime, size, thumbnail(Blob|null), createdAt }`
  - `list(): Promise<AssetMeta[]>` / `get(id)` / `put(meta)` / `delete(id)`
  - 実装: `indexedDbMetaStore()`（本番）/ `memoryMetaStore()`（テスト用）

### アプリ層

- `asset-library.ts`: `BinaryStore` と `MetaStore` を束ねる中心。
  - `add(file): Promise<AssetMeta>`（id = 内容ハッシュで重複排除、サムネ生成、両ストアへ保存、イベント発火）
  - `remove(id)` / `list()` / `getFile(id)` / `getObjectUrl(id)`（ObjectURL ライフサイクル管理・キャッシュ）
  - `estimate()`（`navigator.storage.estimate()` ラップ・使用量表示用）
  - 一覧変更イベント（パネル UI が購読）。
- `asset-id.ts`: `File` → 内容ハッシュ（`crypto.subtle.digest('SHA-256')`）の純関数。
- `thumbnail.ts`: 種別別サムネ生成。
  - 画像 = `createImageBitmap` → 縮小 canvas、動画 = シーク後 1 フレームを canvas へ、音声 = 種別アイコン。
  - **サムネ寸法計算（アスペクト維持の縮小寸法）は純関数 `fitThumbnailSize()` に切り出してテスト**。canvas 描画本体は手動確認。
  - `kind` 判定（mime → 'image'|'video'|'audio'）も純関数化。

### UI 層

- `asset-panel.ts`: HTML DOM パネル（`graph-io-bar.ts` と同様の作り）。
  - **表示／非表示を切り替え可能**: 画面隅の常時表示トグルボタン（📦）とパネルヘッダの × で開閉（状態はメモリ保持のみ・永続化しない）。
  - 一覧（サムネ + ファイル名 + 種別 + サイズ）、追加ボタン（ファイルダイアログ）、削除ボタン。
  - OS のファイルエクスプローラからパネルへの **ファイル D&D 受け口**。
  - `estimate()` による使用量表示。クォータ超過時のトースト警告。
  - パネルのサムネ要素を `draggable=true` にし、HTML5 DnD で `dataTransfer` に `assetId` を載せる。

### 既存ノードとの統合

- ファイル入力ノード（Video/Audio/ImageFileInput）に `assetId` param（`noInput`・UI 非表示）を追加。
  - `loadFile(file)` 時に `assetId` をセット（ライブラリ経由割当時は既知 id、直接ダイアログ選択時は add して得た id）。
- `NodeEditor` に **canvas への drop 受け口**を追加。
  - パネルのサムネ（DOM）→ canvas（drop）の HTML5 DnD。drop 座標 → 既存のファイル行 hitTest（`fileRowRect`）で対象ノード特定 → `library.getFile(assetId)` → `loadFileIntoNode(nodeId, file)` + `assetId` 記録。
  - 座標→ノード割当判定は純関数に切り出してテスト。
- `serialize.ts`(#65) は params をそのまま保存するので `assetId` も YAML に乗る（**#65 への変更は param 定義追加のみで最小**）。
- 読込（deserialize）後の復元: runtime が各ノードの `params.assetId` を見て、存在すれば `library.getFile(id)` → `loadFile` 相当で復元。アセットが見つからなければ warning（グラフは壊さない）。

## データフロー

1. パネルにファイル D&D / 追加ボタン → `library.add(file)`（ハッシュ・重複排除・サムネ生成・OPFS+IndexedDB 保存）→ 一覧更新。
2. パネルのサムネを掴んでノードのファイル行へ HTML5 D&D → drop で対象ノード特定 → `loadFile` + `assetId` 記録。
3. グラフ保存 → `params.assetId` が YAML に保存される。
4. グラフ読込 → 各 `assetId` を `library.getFile()` で復元 → `loadFile`。欠落は warning。

## テスト方針（TDD）

- `asset-id`: 同一内容 → 同一 id、異内容 → 別 id。
- `thumbnail`: `fitThumbnailSize()` のアスペクト維持・上限寸法、`kindFromMime()` の分類。
- `memoryBinaryStore` / `memoryMetaStore`: CRUD・`has`・list 整合。
- `asset-library`（メモリアダプタ注入）: add の重複排除、remove、一覧イベント発火、ObjectURL キャッシュ/解放、estimate ラップ。
- ノード統合: `assetId` param の round-trip（serialize → deserialize で保持）。復元時の `loadFile` 呼び出し（runtime をモック）。
- D&D: drop 座標 → ノード割当判定の純関数。
- 本番アダプタ（OPFS / IndexedDB 実体）・canvas 描画・実 D&D・実ファイル再生は **Playwright スモーク / 手動確認**に委ねる。

## 段階コミット（1 PR 内で分割）

1. ストレージ層: `asset-id` / `BinaryStore`(memory+opfs) / `MetaStore`(memory+indexeddb) / `thumbnail` 純関数。
2. アプリ層: `asset-library`（両ストア束ね・イベント・estimate）。
3. UI 層: `asset-panel`（一覧・追加・削除・OS D&D・使用量表示）。
4. ノード統合: `assetId` param 追加・パネル→canvas D&D 割当・読込復元。

## リスク / 留意点

- OPFS は実質 Chrome 想定（node-vj は swiftshader / captureStream など Chrome 前提機能を既に使用）。Safari/Firefox は対応済みだが本番動作確認は Chrome で行う。
- ブラウザ環境に依存する API（OPFS / IndexedDB / canvas / DnD）はユニットテストせず、純関数とメモリアダプタでロジックを覆い、実体は手動 / Playwright で確認する。
- 内容ハッシュ計算は大容量で時間がかかるため、`crypto.subtle.digest` に File 全体を渡す前にサイズ上限や進捗表示の検討余地あり（初期実装は素朴に全体ハッシュ、問題が出たら最適化）。
