# #219 ImageFileInput の画像アスペクト比正規化

Issue: https://github.com/mishi5/three-art/issues/219

## 問題

`ImageFileInput` は素の画像テクスチャ（`THREE.Texture(img)`）をそのまま出力しており、
下流の全画面描画（Screen 等）で出力アスペクトに引き伸ばされる。
一方 `VideoFileInput` は `VideoTextureSurface`（`graph/video-surface.ts`）で画面サイズの
RenderTarget へ contain（レターボックス）描画し、アスペクト比を入口で正規化している。

## 対応方針

`VideoTextureSurface` に倣い、画像用の contain-fit サーフェス `ImageTextureSurface`
（`graph/image-surface.ts`）を新設する。`<video>` 前提の VideoTexture ではなく、
静止画（`HTMLImageElement`）から `THREE.Texture` を生成し、画面サイズ RT へ contain 描画した
texture を出力する。

- 画像は静止のため VideoTexture のような毎フレーム更新は不要。画像要素が変わったときのみ
  texture を作り直す（RT サイズはレンダラサイズに追従して毎回チェック）。
- contain のスケール計算は既存純関数 `editor/fit.ts` の `containRect` を流用。
  全面クアッド(2x2)に対する NDC スケール（`fit.w/dstW, fit.h/dstH`）を返す純関数
  `containScale` を `fit.ts` に追加し、`ImageTextureSurface` と `VideoTextureSurface` で共有する。
- `ImageFileInputRuntime` は出力用の素 `THREE.Texture` 生成をやめ、`ImageTextureSurface` へ委譲。
  `getTexture(renderer)` へシグネチャを変更（VideoFileInput と揃える）。プレビューは従来どおり
  `<img>` を canvas2d へ contain 描画（変更なし）。
- 出力ポート説明「素の画像。アスペクト比は下流で扱う」→「アスペクト比を入口で正規化済み」に更新。

## テスト（TDD）

- `editor/fit.test.ts`: `containScale` の純粋テスト（同比=全面、レターボックス比、不正サイズ）。
- `ImageFileInputNode` の既存テスト（出力ポート・カテゴリ等）は維持。実描画は WebGL 依存のため
  手動確認に委ねる。

## 手動確認

- ImageFileInput に横長/縦長画像を読み込み、Screen 等へ繋いで全画面表示したとき、
  アスペクト比が保たれ黒帯（レターボックス）で表示されること。
