# #136 プレビュー拡大時は全画面表示にする

対象 Issue: https://github.com/mishi5/three-art/issues/136
関連: Epic #56 / #77 / #79

## 現状

出力 PiP プレビュー（`#preview`・320×180、右下固定）はクリックで拡大するが、
ビューポート 85% かつ右下基準のままで中途半端なサイズだった（`main.ts` の applyPreviewSize）。

## 変更

- 拡大時を **全画面（100vw×100vh・inset:0・最前面 z-index:200・border なし）** に変更。
  renderer は `setSize(vw,vh)` で camera aspect を合わせるため画面いっぱい（黒帯なし）。
- 小窓時は従来どおり右下 PiP（320×180・right:12/bottom:56・z:120）。
- 終了手段: 再クリック（従来）に加え **Esc** で全画面解除。
- サイズ計算は純関数 `preview-size.ts` の `previewSize(large, vw, vh)` に切り出し TDD。

## テスト
- `preview-size.test.ts`: 小窓固定 / 拡大=ビューポート全体。
- Playwright スモーク: クリックで全画面（width=vw, left:0, z:200）、Esc で小窓復帰、エラーなし。

## 動作確認
- PiP をクリックで全画面、再クリック / Esc で小窓に戻る。
