# node-vj エディタ操作系バグ修正（#166 / #167）

対象 Issue:
- https://github.com/mishi5/three-art/issues/166
- https://github.com/mishi5/three-art/issues/167

両件とも `src/apps/node-vj/editor/NodeEditor.ts` のイベント処理に閉じるため、1 本のバンドルブランチ（`bundle/editor-interaction-fixes`）でまとめて対応する。DOM イベントの順序・状態に依存する不具合のため、ユニットテストではなく Playwright で再現確認する。

## #166 メニューボタン再クリックで閉じない

### 原因
`showCategoryDropdown` に再押下クローズのガード（`if (this.contextMenu) { closeContextMenu(); return; }`）はあるが、メニュー外クリック監視 `closeOnOutside` が **capture フェーズの `pointerdown`** で登録されているため、トグルボタンの `click` ハンドラより先に発火してメニューを閉じる。その後 `click` が走ると `this.contextMenu` は既に `null` で、ガードをすり抜けて再オープンしてしまう。

### 修正
- メニューを開いたトグルボタンを `this.menuAnchor` に保持。
- `closeOnOutside` で、`pointerdown` の対象がそのアンカー内なら閉じない（`click` のトグルに委ねる）。
- `closeContextMenu` で `menuAnchor` を `null` に戻す。

### 確認（Playwright）
ボタン1回目クリック→開く / 2回目→閉じる / 3回目→再び開く。

## #167 Space+ドラッグのパンが残る

### 原因
パン判定は `pointerdown` 時の `this.spaceDown` 依存。`spaceDown` は `keyup` で `false` に戻すが、ドラッグ中のフォーカス移動・ウィンドウ blur 等で space の `keyup` を取りこぼすと `true` のまま残り、以降の素ドラッグもパンになる。

### 修正
- `window` の `blur` で `spaceDown = false` にリセットする（`onBlur` を追加、`dispose` で解除）。

### 確認（Playwright）
`keydown(' ')` で `spaceDown=true` → `window` blur で `spaceDown=false`。
