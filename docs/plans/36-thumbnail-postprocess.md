# Issue #36: プリセットのサムネイルが実画面より明るく/白飛びする

対象 Issue: https://github.com/mishi5/three-art/issues/36

## 問題

`src/pose-particles/presets/thumbnail-capture.ts:25` の `captureThumbnail()` は
`renderer.render(scene, camera)` を `WebGLRenderTarget(UnsignedByteType)` に直接描画して
ピクセル読み出ししているため、実画面で経由している post-process パイプライン
(`BlurPipeline` = `EffectComposer { RenderPass + Blur*N + OutputPass }`) を素通りしている。

特に **`OutputPass` を通らない = `renderer.outputColorSpace` (= sRGB) と
`renderer.toneMapping` の適用がない** ため、サムネはリニア色空間のままピクセル化される。
linear → sRGB の変換は中明度〜高明度を圧縮する操作なので、これが省かれると
全体が一段明るく、加算合成のホットスポットが白飛びしやすくなる。

## 設計

### 採用方針: サムネ生成内に専用 EffectComposer を一時構築

`captureThumbnail()` のデフォルト描画ステップを次に置き換える:

1. `WebGLRenderTarget(w, h, { type: UnsignedByteType, format: RGBAFormat })` を作る
2. `new EffectComposer(renderer, target)` を作り、`renderToScreen = false`
3. `RenderPass(scene, camera)` と `OutputPass()` を addPass
4. `composer.render()`
5. `renderer.readRenderTargetPixels(composer.readBuffer, ...)` で読み出し
6. `composer.dispose()` + pass の dispose

`EffectComposer` 内部の swap 後に最終出力が書かれているのは `readBuffer` 側
(`EffectComposer.js` 内 `render()` ループ末で `swapBuffers()` が走るため)。

### Blur 再現は本 PR では対象外

`BlurPipeline` の blur 半径は texel 単位 (`uTexel = 1/screenWidth`) で表現されているため、
サムネサイズ (256×144) に composer をリサイズすると blur が空間的に過剰に効く / 効かなく
なってしまう。本 PR では「OutputPass による sRGB / tone mapping 適用」のみを優先する。

Blur 再現は別途必要なら follow-up Issue 化する。

### テスト容易性

`bun` + `happy-dom` 環境では本物の WebGL コンテキストが無いので、本物の
`EffectComposer` 経路はテストできない。`__captureForTest` フックを追加し、
テストでは `renderer` / `scene` / `camera` から `Uint8Array` バッファを生成する
fake を差し込めるようにする。既存の `encode` フックと同様の慣習。

### シグネチャ変更

```ts
export interface ThumbnailCaptureOptions {
  width?: number;
  height?: number;
  mime?: "image/webp" | "image/png";
  quality?: number;
  encode?: (buf, w, h, mime, quality) => string;
  /** テスト用フック。指定時は EffectComposer 経由の描画をスキップし、
   *  この関数が返した w*h*4 バイトのバッファを encode に渡す。 */
  __captureForTest?: (renderer, scene, camera, w, h) => Uint8Array;
}
```

外部 (App.ts) からの呼び出し方は変更なし: `captureThumbnail(renderer, scene, camera)`.

## テスト計画

`src/pose-particles/presets/thumbnail-capture.test.ts` を新仕様に合わせて更新。

| # | 検証内容 |
|---|---|
| T1 | `__captureForTest` が指定された場合、それが `renderer, scene, camera, w, h` の順で呼ばれ、戻り値が `encode` に正しく渡される |
| T2 | デフォルト size が 256×144 |
| T3 | `__captureForTest` 戻り値が空配列でも `encode` が呼ばれる (エラーパスなし) |
| T4 | `encode` の戻り値が `captureThumbnail` の戻り値になる |

既存テスト (T1 旧版の `setRenderTarget → render → readRenderTargetPixels → null` 順序検証) は
仕様変更により無意味になるので削除し、上記に置換する。

## 実装ステップ

1. テストを新仕様に更新 (RED)
2. テスト実行で fail を確認
3. `thumbnail-capture.ts` を新実装に更新 (GREEN)
4. 全テスト pass を確認
5. 実機で実画面とサムネの一致を目視確認 (ユーザ動作確認時)

## 影響範囲

- `src/pose-particles/presets/thumbnail-capture.ts` 本体
- `src/pose-particles/presets/thumbnail-capture.test.ts` 全更新
- `App.ts` の呼び出しは変更なし
- 新規依存なし (`three/examples/jsm/postprocessing/*` は既に `BlurPipeline.ts` で利用済)
