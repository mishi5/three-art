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

### 真の根本原因（実機トラックパッドのイベントログで確定）
実機の `pointermove`/`keydown`/`keyup` をログ採取して判明:
- `keyup`（Space）は届き `spaceDown` は false になる。
- しかし**指を離した後も `pointermove` の `buttons` が `1` のまま続き、`pointerup` も `buttons:0` も来ない**（macOS トラックパッド特有）。
- パン判定は `pointerdown` 時に `this.drag = {kind:"pan"}` を立て、`onMove` は drag がある限りパンを続ける。Space を離しても drag は終わらないため、`buttons:1` のまま来る move でパンが残り続ける。

> つまり主因は「Space を離してもパンが終わらない」こと。`spaceDown` の取りこぼし（IME）でも、`buttons===0` の検知でもない（指を離しても buttons は 1 のまま＝`buttons===0` ガードは発火しない）。

### 修正（主因・最終形）
背景ドラッグの「パン/矩形選択」を **pointerdown 時に固定せず、`onMove` で毎フレーム `spaceDown` により切り替える**。
- pan drag に `bySpace`（Space 始動か）を持たせる。
- `onMove`: bySpace パン中に `spaceDown` が false なら **その場で矩形選択 (`rect`) へ切替**（現在地を起点）。矩形選択中に `spaceDown` が true なら **パンへ切替**（現在地基準でジャンプなし）。
- これで pointerup の取りこぼし（trackpad で buttons:1 が残る）に左右されず、「Space 離す→そのまま矩形選択」「Space 再押下→パン再開」「離して新規ドラッグ→矩形選択」がすべて即反応する。

### 試行錯誤の記録（同じ轍を踏まないため）
1. `blur` リセット → 効かず（フォーカスは外れていない）。
2. `e.code === "Space"`（IME 経由 keyup 取りこぼし）→ 本件主因でなく効かず（実機ログで keyup は届いていた）。
3. `onMove` で `buttons === 0` 終了 → 効かず（trackpad は指を離しても buttons:1 のまま）。
4. `onKeyUp` で pan drag を `null` 終了 → 残留パンは消えたが、同じ指のまま再パンできず**無反応**（pointerup 欠落で新規 pointerdown が来ない）。
5. drag 保持＋Space 押下中のみパン（停止中は基準更新）→ 残留・再開は解決したが、パン後の**矩形選択が数回効かない**（stale pan が居座る）。
6. 上記「move ごとに spaceDown でパン/矩形を切替」→ 解決。実機イベントログ採取が突破口だった。

### 併せて入れた defense in depth（別経路の保険・本件の主因ではない）
- `onMove`: ドラッグ中に `e.buttons === 0` の move が来たら `onUp(e)` で終了（通常マウスで pointerup を落とした場合の保険）。
- `onKey`/`onKeyUp`: Space 判定を `e.code === "Space"`（IME で keyup の `e.key` が変わる経路の保険）。
- `window` blur で `spaceDown` リセット。

### 確認（Playwright・ALL_OK / FIXED）
- 実ログ同様「keyup 後も `buttons:1` が続く」状況で、keyup 時に drag=null になりパンしない（FIXED）。
- `buttons:0` stray move でも drag 解除 / 通常 space+drag→素drag は矩形 / IME 風 keyup で spaceDown 解除 / #166 メニュートグル。
