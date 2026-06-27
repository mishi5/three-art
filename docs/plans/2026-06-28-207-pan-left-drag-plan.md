# #207 エディタのパンを左ドラッグに変更・矩形選択を Shift+左ドラッグへ

対象 Issue: https://github.com/mishi5/three-art/issues/207

## 背景・目的

node-vj エディタのキャンバス操作を一般的なキャンバス系 UI に寄せる。

- 何もない場所の左ドラッグでキャンバスを**パン**（直感的・素早い）。
- 矩形選択は補助操作として **Shift + 左ドラッグ** に寄せる。

現状（#83）は「空白左ドラッグ＝矩形選択 / Space・中・右ドラッグ＝パン」。これを反転する。

## 現状のコード

`src/apps/node-vj/editor/NodeEditor.ts`

- `onDown`（288〜）:
  - 先頭で `e.button !== 0 || this.spaceDown` なら `kind:"pan"` を開始（ノード上でも中/右/Space でパン可能）。
  - ヒットテスト（label / port / param / node）で各ドラッグを開始。
  - いずれにも当たらない「背景」では `kind:"rect"`（矩形選択）を開始（418〜419）。
- `onMove`（422〜）: #167 対策。`e.buttons===0` で drag 終了。`bySpace` パンは Space を離すと rect へ切替、rect 中に Space で pan へ切替。
- `onUp`（505〜）: rect 確定（移動なし＝空矩形で選択解除）。右クリック移動なしはコンテキストメニュー。

## 変更方針

### 1. 背景ドラッグの判定を純関数化（TDD 対象）

新規 `src/apps/node-vj/editor/pan-policy.ts`:

```ts
export type BackgroundDrag = "pan" | "rect";
export function backgroundPointerDrag(opts: {
  button: number; shiftKey: boolean; spaceDown: boolean;
}): BackgroundDrag
```

ルール:
- 中ボタン/右ボタン、または Space 併用 → `"pan"`（従来どおり）。
- 左ボタン単独: Shift → `"rect"` / Shift 無し → `"pan"`（#207）。

### 2. `onDown` 背景分岐の差し替え

`kind:"rect"` 固定だった箇所を `backgroundPointerDrag(...)` の結果で分岐:
- `"rect"` → 従来どおり矩形選択開始（start は world 座標）。
- `"pan"` → `kind:"pan"`, `bySpace:false` でパン開始（start は client 座標）。

先頭の `e.button !== 0 || this.spaceDown` 早期パンは維持（ノード上での中/右/Space パンを残す）。

### 3. 空白クリック（移動なし）の選択解除を維持

従来は「空白左ドラッグ＝rect」で、移動なしの場合に空矩形 → 選択解除になっていた。
左ドラッグがパンに変わるため、`onUp` に「左ボタン・非 Space・移動量 < しきい値のパン」で
`selectedIds` / `selectedLabelId` をクリアする処理を追加し、空白クリック解除を維持する。

### 4. ヒント文・コメント更新

下部ヒントを「空白ドラッグ=パン / Shift+ドラッグ=矩形選択」に更新。関連コメントも #207 を追記。

## #167 リグレッション防止

- `onMove` の `e.buttons===0` での drag 強制終了はそのまま左ドラッグパンにも効く。
- blur / keyup（`e.code==="Space"`）での `spaceDown` リセットも維持。
- 左ドラッグパンは `spaceDown` に依存しないため、Space 取りこぼしの影響を受けにくい。
- 判定は pointerdown 時に確定（Shift の途中変化で挙動を切り替えない）。Space の途中切替は温存。

## テスト

- `pan-policy.test.ts`: `backgroundPointerDrag` を網羅（左/中/右 × Shift × Space）。
- 既存 877 件は維持（入力ハンドラの DOM 配線は手動 / Playwright で確認）。

## 受け入れ条件（Issue より）

- [ ] 何もない場所の左ドラッグでパンできる
- [ ] Shift + 左ドラッグで矩形選択できる
- [ ] ノード移動・エッジ作成など既存操作が壊れない
- [ ] トラックパッドでパン／選択が途中で固着しない（#167 リグレッションなし）
