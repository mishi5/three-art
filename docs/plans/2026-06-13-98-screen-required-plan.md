# #98 表示モデル: Screen 接続を必須化（自動表示フォールバック廃止）

対象 Issue: https://github.com/mishi5/three-art/issues/98

## 背景・課題

これまで Visual 系ノードは Screen に接続しなくても、終端（texture 出力が未接続）の
Visual が自動的に画面表示される「フォールバック」挙動だった。一方で Camera/Video/Blur など
texture を中継するノードは自動表示されず、「何が画面に出るか」のルールがノード種別ごとに
非対称で分かりにくかった。

表示対象は **Screen ノードに接続したものだけ** に統一し、挙動を予測しやすくする。

## 方針

- `graph/texture-screen.ts` の `pickScreenTextures` から終端 Visual の自動表示フォールバックを削除。
  Screen（category="output"）が記録した `_screenTexture` のみを返す。
- 既定グラフ（`main.ts`）に Screen ノードを含め、`RainVisual.texture → Screen.texture` を初期配線。
  これまでフォールバックで出ていた既定の雨表示を、明示的な Screen 接続で再現する。
- エディタのヒント文に「画面表示は Screen に接続」を追記。

## 影響

- Screen 不在のグラフは黒画面になる（仕様変更）。プリセットはテスト段階のみのため移行対応は不要。

## テスト

- `texture-screen.test.ts`: フォールバック系テストを「Screen 必須」仕様へ置換。
  - Screen なし → 空（Visual があっても表示しない）
  - Screen 未記録（未評価相当）→ 空
  - Screen 複数 → それぞれの記録テクスチャ
- E2E: 既定グラフが Screen 経由で雨表示 / Screen 削除で黒画面。
