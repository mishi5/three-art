# #151 シーン管理機能（複数シーンの切替・編集・出力）設計

- Issue: https://github.com/mishi5/three-art/issues/151 （Epic #56）
- 機能リファレンス: `docs/vj-dj-feature-reference.md` #7（シーン管理 & 切替）

## 目的
複数のシーン（グラフ構成）をメモリに常駐させ、ライブ中に切り替えて編集・出力できるようにする。シーンの追加/複製/削除/リネーム、左サイドのシーン一覧 UI、全シーンの自動永続化を提供する。

## スコープ確定事項（ユーザ合意済み）
- **保持/編集モデル: ハイブリッド** — 全シーンを `GraphDoc` としてメモリ常駐。各シーンの編集はその場で保持（切替で失われない）。既存の名前付きプリセット（#65, `GraphStore`）からの読込/書き出しも併用。
- **切替挙動: 単一ランタイム・即時ハードカット** — ランタイムは 1 つ。切替で `replaceGraph` → 旧シーンの state（動画/音声等）を破棄し新シーンを生成。動画/音声は切替で一旦停止・再生成。トランジションは非スコープ。
- **永続化: 全シーンを自動永続化** — 全シーン＋アクティブ位置を localStorage に自動保存し、リロードで復元。初回（未保存）は既定グラフを唯一のシーンとして初期化。
- **undo/redo: シーンごとに保持（切替でクリアしない）** — シーン別トラックを持ち、切替でアクティブトラックを切替。各シーンの履歴は保持。
- **UI: 左サイドの折りたたみ式リストパネル** — アセットパネルと同形。折りたたみ時の再展開トグルボタンはアセットのボタンと縦に重ならない位置に置く。
- **非スコープ**: トランジション/クロスフェード、複数シーン同時再生、シーン横断 undo。

## データモデル
```ts
interface Scene { id: string; name: string; graph: GraphDoc; }
interface SceneSet { version: number; scenes: Scene[]; activeId: string; }
```
- 各 `Scene.graph` は独立した `GraphDoc`。
- editor/runtime は従来どおり**単一の共有 `GraphDoc` 参照**にバインドされ続ける（コンストラクタ束縛のため参照は不変）。アクティブシーンの内容は `replaceGraph(共有, クローン)` で共有グラフに反映する。
- `GraphDoc` は純データのため deep copy は `structuredClone`（history と同方式）。

## 中心モジュール

### `scene/scene-manager.ts`（純ロジック・テスト対象）
DOM/runtime 非依存。`SceneSet` の保持と操作のみを担い、メモリ adapter で TDD する。

```ts
class SceneManager {
  constructor(deps: { store: SceneStore; now?: () => number; genId?: () => string });
  list(): Scene[];
  activeId(): string;
  active(): Scene;
  add(name?: string): Scene;            // 空グラフの新規シーンを末尾に追加し active に
  duplicate(id: string): Scene;          // graph を deep copy して複製、active に
  remove(id: string): void;              // 最低 1 シーンは残す（最後の 1 つは削除不可）
  rename(id: string, name: string): void;
  setActive(id: string): void;
  /** アクティブシーンの graph を与えられた内容で更新（編集スナップショットの書き戻し）。 */
  updateActiveGraph(graph: GraphDoc): void;
  serialize(): string;                   // SceneSet を JSON 文字列へ
  onChange(cb: () => void): () => void;   // 変更通知（永続化/再描画用）
}
```
- 不変条件: `scenes.length >= 1`、`activeId` は必ず実在するシーンを指す。
- `remove` で active を消した場合は隣接シーンを active にする。

### `scene/scene-store.ts`（localStorage 永続化）
`GraphStore` と同パターン。`KvStorage` を注入（テストは memory adapter）。
- キー: `node-vj.scenes.v1`。
- `load(): SceneSet | null` / `save(set: SceneSet): void`。
- 破損データは `null` を返し呼び出し側で既定初期化（堅牢性）。

### `graph/history.ts`（拡張・後方互換）
シーン別トラック対応を**加算的**に導入（既定トラックで既存挙動を維持）。
```ts
useScene(sceneId: string): void;   // アクティブトラック切替（無ければ空で作成）
removeScene(sceneId: string): void; // トラック破棄（シーン削除時）
```
- `record/undo/redo/discardLast/clear/canUndo/canRedo` は現アクティブトラックに作用。
- 既存の単一利用は「既定トラック」で従来どおり動作（既存テスト不変）。

## UI `scene/scene-panel.ts`（DOM・手動/Playwright 確認）
- 左ドックの折りたたみ式リストパネル（`asset-panel.ts` の構造・スタイルに倣う）。
- 各行: シーン名 / アクティブ強調 / クリックで切替 / 複製ボタン / 削除（×、最後の 1 つは不可）/ ダブルクリックでリネーム（インライン input）。
- 下部に「＋ シーン追加」。
- 折りたたみ時の再展開トグルボタンはアセットのトグル（左上 `top:44`）と縦に重ならない位置（例 `top:84`）。
- 純粋な表示判定（`panelDisplay(open)` 等）は切り出して単体テスト可能にする（DOM 本体はテストしない）。

## 切替の副作用配線（`main.ts`）
シーン切替（`scene-panel` → コールバック）で順に実行:
1. 切替前: 編集中の共有グラフを `structuredClone` して `sceneManager.updateActiveGraph(共有)` で現アクティブシーンへ書き戻す。
2. `sceneManager.setActive(nextId)`。
3. `replaceGraph(共有, structuredClone(next.graph))`。
4. `history.useScene(nextId)`（クリアしない）。
5. `runtime.ensureStates()`（旧 state 破棄＆新規生成。#154 で追加済み）。
6. `restoreAssets()`（#154。新シーンの `assetId` を OPFS/IndexedDB から復元）。
7. 永続化（`sceneManager.onChange` → `SceneStore.save`）。

### 自動永続化のタイミング
- シーン操作（add/duplicate/remove/rename/switch）時に書き戻し＋ `save`。
- 編集中（グラフ変更）の保存は、共有グラフを定期的（デバウンス）にアクティブシーンへ書き戻して `save` する（例: 変更検知またはタイマ）。実装では「操作時の確実な保存」＋「編集の軽量な定期保存」の二段で取りこぼしを防ぐ。

### 初期化・移行
- 起動時 `SceneStore.load()`:
  - あり → 復元し、`activeId` のシーンを共有グラフへ反映、`history.useScene(activeId)`、`restoreAssets()`。
  - なし → 既定グラフ（現行 main.ts の初期構築）を唯一のシーン `Scene{ name:"Scene 1" }` として初期化。

## 既存プリセット（graph-io-bar）との関係
- 名前付きプリセットは存続。`buildGraphIoBar` は引き続き**アクティブシーンの共有グラフ**を保存/読込対象とする（= 現在のシーンをプリセットへ保存 / プリセットを現在のシーンへ読込）。読込時は現トラックを `clear`（内容総入れ替えのため妥当）。

## テスト方針
- `scene-manager.test.ts`: add/duplicate(深いコピー独立性)/remove(最後の1つ不可・active 再選択)/rename/setActive/updateActiveGraph/serialize round-trip/onChange 発火。
- `scene-store.test.ts`: save→load round-trip、破損データで null、memory adapter。
- `history.test.ts`: 既存に加え useScene でトラック独立（A で record→B 切替→A 戻りで undo 可能）/removeScene。
- `scene-panel.test.ts`: 純関数（`panelDisplay` 等）のみ。
- ブラウザ依存（DOM/切替配線/runtime/OPFS）は Playwright スモーク＋手動確認。

## ファイル構成
- 追加: `src/apps/node-vj/scene/scene-manager.ts`(+test)、`scene/scene-store.ts`(+test)、`scene/scene-panel.ts`(+test)
- 変更: `graph/history.ts`(+test)、`main.ts`（生成・配線・初期化）

## スコープ外（再掲）
トランジション、複数同時再生、シーン横断 undo、プリセットとシーンの自動同期。
