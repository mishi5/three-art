# 実装計画: Visual ノードのテクスチャ出力と画像入力チェーン（コンポジット基盤）

- 対象 Issue: https://github.com/mishi5/three-art/issues/76
- 親 Epic: https://github.com/mishi5/three-art/issues/56
- 関連: #85（合成ノード・本基盤の上に実装）/ #64（ポストエフェクト）/ #77（ノードプレビュー）

## 確定方針（#76 ブレインストーミング）

- **案A: 常に RT（RenderTarget）方式**。全 Visual ノードは常に「自分専用シーン →
  自分の RT」へ描画し、`texture` 出力ポートから結果を渡す。
- 画面への表示は **Screen ノード**（texture 入力の sink）が担う。Screen が無い場合は
  **終端 Visual（texture 出力が未接続）を自動で画面表示**（既存グラフ互換）。
- 合成ノード（Blend/Mix）は #85。#76 は基盤＋Screen まで。

## アーキテクチャ

```
[RainVisual] ─ 専用 scene ─render→ RT-A ─ texture ─▶ [Screen]（画面へ転写）
[PointCloud] ─ 専用 scene ─render→ RT-B ─ texture ─▶ （未接続なら自動表示）
```

- 評価（pull）中: Visual は params 更新 → 専用 scene を env.renderer で**自分の RT に描画**
  → `{ texture }` を返す。Screen は入力 texture を state に記録するだけ。
- 評価後: runtime が「Screen が記録した texture（なければ終端 Visual の texture）」を
  画面へ転写（1 枚目は clear、2 枚目以降は加算合成）。**canvas への書き込みは runtime に集約**
  し、クリア順序のバグを防ぐ。
- 共有シーンは廃止（NodeEnv から scene を削除）。camera/renderer/audio は維持
  （OrbitControls は各 Visual の描画カメラとして引き続き有効）。
- RT サイズ = renderer の drawing buffer サイズ。リサイズは evaluate 時に
  rt.setSize で追従。PointCloud の setProjection も同サイズなので従来式のまま。

## 実装ステップ

1. `graph/texture-screen.ts`（純粋・TDD）: 画面に出すテクスチャの選択ロジック
   `pickScreenTextures(graph, registry, outputs)` — Screen ノードの記録 texture を優先、
   無ければ「texture 出力が未接続の Visual」の texture を列挙
2. `graph/blit.ts`: 全画面転写ヘルパ `TextureBlitter`（通常/加算）
3. `nodes/RainVisualNode` / `nodes/PointCloudVisualNode`: 専用 scene + RT 化、
   outputs に `texture` 追加、evaluate 末尾で RT へ render
4. `nodes/ScreenNode`: texture 入力の sink（state に texture を記録）
5. `graph/runtime.ts`: 共有シーン描画を廃し、評価後に pickScreenTextures → blit
6. registry 登録・NodeEnv から scene 削除
7. tsc / 全テスト / build / Playwright（既定グラフの雨が従来通り表示・
   Screen 経由でも表示・PointCloud との 2 終端自動表示）

## テスト

- pickScreenTextures（Screen 優先 / フォールバック / 複数終端）
- ノードのポート定義（texture 型）
- 描画は Playwright スクリーンショットで確認

## リスクと緩和

- 描画パス増のオーバーヘッド → Visual 数個規模では軽微（設計議論済み）。
  将来必要なら「画面に寄与しないノードの描画スキップ」を pull 到達性で実装可能
- クリア/合成順序 → canvas 書き込みを runtime に一元化
- 既存グラフ互換 → Screen 不在時の終端自動表示で維持（Playwright で回帰確認）
