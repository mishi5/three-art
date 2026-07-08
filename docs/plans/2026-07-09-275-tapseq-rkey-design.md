# #275 TapSequencer の録音トリガをボタンから r キーホールドへ統一

対象 Issue: https://github.com/mishi5/three-art/issues/275

## 経緯

`#204 TapSequencer` は録音トリガに「ノード上の『● 録音』ボタンをポインタでホールド
（pointerdown〜pointerup）」という UI を採用していた。その後 `#186 Automation` では
「ノードを選択して物理キー 'r' をホールド」という別方式を新規実装し、実機確認の結果こちらの
ほうが操作性がよいと判明した（ポインタでノード上の小さなボタンを押し続けるより、ノードを選択して
物理キーをホールドするほうが誤操作が少なく、録音中も画面のどこを見ていてもよい）。

本 Issue は、TapSequencer の録音トリガも Automation と同じ「選択中ノードで 'r' キーホールド」
方式に統一する。TapSequencer のタップ入力自体（録音中にスペースキーを叩いてタイミングを記録する
機能）や、ランタイムの状態機械（`nodes/TapSequencerNode.ts` / `nodes/tap-sequencer-logic.ts`）は
一切変更しない。変えるのは「録音の開始/終了トリガ」だけ。

## 変更方針（#186 の実装パターンをそのまま踏襲）

- `NodeEditor` に `tapSeqRecordingNodeId: string | null`（Automation の
  `automationRecordingNodeId` に相当）を新設する。TapSequencer と Automation は別ノードで、
  同時に両方選択されることはない（`selectedIds.size !== 1` で弾く単一選択判定）が、念のため
  独立したプロパティとして持つ。
- `onTapSeqKeyDown`/`onTapSeqKeyUp`（`onAutomationKeyDown`/`onAutomationKeyUp` と同一ロジック）
  を新設する。`e.code !== "KeyR"` で早期 return、INPUT/SELECT/TEXTAREA なら return、
  `e.repeat` なら return、`selectedIds.size !== 1` なら return、選択中ノードの
  `def.tapSequencer` で判定、`preventDefault` + `stopImmediatePropagation`。
- 呼び出し先は既存の `onTapRecordStart`/`onTapRecordStop`（main.ts で
  `runtime.getState(id).startRecording(tapNowSec())` のように wall clock を渡す実装はそのまま）。
  プロパティの型・main.ts 側の配線は一切変更しない。
- ノード上の「● 録音」ボタン（ポインタホールド）を撤去する。
  - `Drag` 型から `{ kind: "tapRecord"; nodeId: string }` を削除（ポインタドラッグでの録音が
    なくなるため不要）。
  - `onDown` 内の録音ボタンのヒットテスト＋`drag = { kind: "tapRecord", ... }` を削除。クリア
    ボタンのヒットテストのみ残す。
  - `onUp` 内の `drag.kind === "tapRecord"` の録音停止処理を削除。
  - `onBlur` 内の録音ボタンホールド中の停止処理を、`tapSeqRecordingNodeId` ベースの停止処理へ
    差し替える（'r' キーをホールドしたままフォーカスが外れたら録音停止・#186 と同じ）。
  - `onKeyCapture`（録音中の Space キャプチャ＝タップ記録）の判定条件を
    `this.drag?.kind !== "tapRecord"` から `this.tapSeqRecordingNodeId === null` に変更する。
    **これはタップ入力機能自体なので撤去しない**（トリガー方式が変わるだけ）。
- 「✕ クリア」ボタンは維持する。

## layout.ts の変更

`tapControlRowRect`（コントロール行の領域）と `tapStatusRowRect`/`tapStatusLabel`（ステータス行）
は変更しない。`tapControlLayout` のみ、録音ボタンを撤去してクリアボタンだけのレイアウトに変える
（`#186 automationControlLayout` の `clear` 部分と同型: `pad=6, clearW=54`）。

```
// Before
tapControlLayout(rect) => { rec: {...}, clear: {...} }
// After
tapControlLayout(rect) => { clear: {...} }
```

## 描画

`NodeEditor` の `hasTapRows(def)` 描画ブロックから、録音ボタン（●録音/●録音中…の描画・
`node.tap.recordBtn`/`node.tap.recordingBtn` の参照）を削除し、クリアボタンのみ描画する。
ステータス行の描画はそのまま維持する。

## i18n

`node.tap.recordBtn` / `node.tap.recordingBtn` は参照元がなくなるため `i18n.ts` から削除する。
`node.TapSequencer.desc`（i18n-nodes.ts）の説明文を「録音ボタンを押している間」から「ノードを
選択して物理キー 'r' をホールドしている間」に更新する。

## スコープ外

- ランタイムの状態機械・タップ入力ロジック（`tap-sequencer-logic.ts` / `TapSequencerNode.ts`）。
- main.ts の `onTapRecordStart`/`onTapRecordStop`/`onTap`/`onTapClear`/`tapSeqInfo` 配線
  （呼び出しは NodeEditor 内部のトリガー元が変わるだけで、引数・シグネチャは不変）。
