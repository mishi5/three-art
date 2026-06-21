# #156 フレームフィードバック/ディレイノードを追加

対象 Issue: https://github.com/mishi5/three-art/issues/156
親 Epic: #56

## 目的
前フレームの出力を現フレームに混ぜるフレームフィードバック（ディレイ）を追加する。
無限トンネル・残像・トレイル表現を作れる。VJ 定番。

## 設計
- 新ノード `FeedbackNode`（category: `effect`, isSink: true, `in` texture → `texture`）。
- **ピンポン 2 RT（ダブルバッファ）**で前フレームを保持（ShaderSurface は単一 RT のため自前 state で 2 RT 管理）。
  - 毎フレーム: tCurrent=入力, tPrev=前回出力(rtA) を合成して rtB へ描画 → rtB を返し read/write をスワップ。
  - renderer サイズに追従（変化時 setSize）。
- FRAG: tPrev を scale/rotate/offset した UV でサンプルし `decay` を掛けて現フレームと **max 合成**（飽和せず安定）。
  - scale>1 で無限トンネル、rotate でスパイラル、offset でモーショントレイル、decay で残存度。
- param: enabled / decay(0..1) / offsetX / offsetY / scale(0.9..1.1) / rotate(度)。数値 param は他ノード駆動可。

## テスト
- `feedback.test.ts`: ポート（texture→texture）・category・no-op・params・decay 域・registry 登録。
  全752件パス。
- 実フィードバック（ピンポン蓄積）は Playwright スモークで TextureGenerator(radial)→Feedback(scale1.06,rotate6)
  →Screen のトンネル/スパイラル描画を確認。

## 成果物
- `nodes/FeedbackNode.ts`（新規・2 RT ピンポン）・registry 登録・テスト。

## 備考
- 合成は max（残像が飽和しない）。加算合成や mix は将来のオプションとして拡張余地。
- RT は RGBA8（8bit）。max ベースなので 8bit で十分。
