# #174 出力シーンをエディタ編集シーンと分離

Issue: https://github.com/mishi5/three-art/issues/174

## 背景・現状

- 出力ウィンドウ（#148）は `previewCanvas`（= 編集中＝アクティブシーンを描く WebGL canvas）を
  `captureStream()` でミラーしている。編集シーンを切り替えると出力も同時に変わる。
- ライブ運用では「現在のシーンを出力したまま、次のシーンを別途編集したい」。

## やりたいこと

- 出力ウィンドウに表示する**出力シーン**を、エディタで編集中のシーン（アクティブシーン）とは
  独立に指定・切替できるようにする。
- 既定は「編集に追従（従来互換）」。出力シーンを明示指定すると、編集中は別シーンを編集しても
  出力はピン留めしたシーンを描き続ける。

## 設計方針

### レンダリング（GraphRuntime）

WebGL renderer/canvas は 1 つしか持てない。出力シーンと編集シーンで描画内容が異なるため、
**1 フレーム内で 2 パス描く**：

1. `renderReferencedScenes()` を「出力シーンも追加ルートとして」評価するよう拡張。
   出力シーン（と、その参照先シーン）の合成結果が `sceneTextureCache` に載る（専用 RT）。
2. tick 末尾で:
   - **出力が編集と別シーンのとき**: 先に出力シーンの合成テクスチャを WebGL canvas に blit →
     `outputCanvas`（2D）へ `drawImage` でコピー → その後アクティブシーンを WebGL canvas に
     描き直す（画面プレビューは従来どおりアクティブシーンを表示）。
   - **出力が編集に追従のとき**: アクティブシーンを描いた後の WebGL canvas を `outputCanvas` に
     `drawImage`（従来と同じ映像）。
3. 出力ウィンドウは `previewCanvas` ではなく runtime の `outputCanvas`（2D）を `captureStream`。

`drawImage(webglCanvas)` は GPU 間コピーで、`readPixels` のような CPU 読み戻しストールは無い。
2 パス描画は出力≠編集のときだけ発生する（追従時は単純コピーのみ）。

新 API:
- `setOutputSceneId(id: string | null)` … null = 編集に追従
- `setOutputActive(on: boolean)` … 出力ウィンドウ表示中だけ outputCanvas を更新
- `getOutputCanvas(): HTMLCanvasElement`

### 評価順（純関数, scene-refs.ts）

`sceneRenderOrder(activeSceneId, scenes, registry, extraRoots = [])` に `extraRoots` を追加。
出力シーン id を追加ルートとして渡すと、出力シーン（active でなければ）と未評価の参照先が
依存順に追記される。既存呼び出しは extraRoots 省略で挙動不変。

### 出力シーンの解決（純関数, output-scene.ts 新規）

`effectiveOutputSceneId(outputId, activeId, existingIds)`:
- `outputId` が null / 存在しない id → `activeId`（追従）
- それ以外 → `outputId`

runtime と シーンパネル表示の両方で使う（ピン先が削除されたら追従へフォールバック）。

### 状態管理・永続化（SceneManager / SceneStore）

- `SceneSet.outputId?: string | null` を追加（省略時 null = 追従, 後方互換）。
- `SceneManager`: `outputId()` / `setOutput(id | null)`。シーン削除で出力先が消えたら null に戻す。
- `SceneStore`: outputId を round-trip。旧データ（outputId なし）は null として読む。

### UI（scene-panel）

- 各シーン行に「出力」トグルボタン（モニターアイコン）。
- 実効出力シーンの行に「● 出力」バッジ（追従中は「● 出力(編集に追従)」）。
- ボタン挙動: そのシーンが既に出力先ならクリックで追従（null）に戻す。別シーンならそのシーンを
  出力先にピン留め。
- `ScenePanelActions` に `outputId(): string | null` と `setOutput(id: string | null)` を追加。

## テスト

- 純関数（bun）:
  - `scene-refs.test.ts`: `sceneRenderOrder` の extraRoots（出力シーン追加・重複排除・active 除外）
  - `output-scene.test.ts`（新規）: `effectiveOutputSceneId` の追従/ピン/存在しないidフォールバック
  - `scene-manager.test.ts`: outputId 既定 null・setOutput・削除フォールバック・persist
  - `scene-store.test.ts`: outputId round-trip・旧データ後方互換
- Playwright スモーク:
  - 2 シーン（別色の Screen）を用意、出力を別シーンにピン → outputCanvas と previewCanvas の
    画素が異なる（編集はアクティブ、出力はピン先）ことを確認。
  - 追従に戻すと両者一致。
