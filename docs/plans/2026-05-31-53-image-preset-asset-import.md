# Issue #53: image preset の読み込み失敗 (asset import 化)

- Issue: https://github.com/mishi5/three-art/issues/53
- 関連 (別対応): https://github.com/mishi5/three-art/issues/54

## 根本原因

Bun `--hot html` dev サーバは `public/` をルート配信しない。未マッチの全パスに
index.html を `200 / text/html`（SPA フォールバック）で返す。実証:

```
$ curl -s -D - http://localhost:3000/images/presets/sample-01.svg | grep -i 'content-type\|HTTP/'
HTTP/1.1 200 OK
Content-Type: text/html;charset=utf-8       # 本文は pose-particles.html
# 存在しない DOES-NOT-EXIST.svg も同一 etag → ファイル配信ではなくフォールバック
```

`App.loadImage()` の `new Image().src = "/images/presets/${path}"` が HTML を受け取り
画像として解釈できず `onerror` → "failed to load image"。`App.ts:647` のコメント
「public/ 配下は dev サーバのルートに直接マップされる」は誤り。

## 方針 (Option 2: asset import)

`.svg` はデフォルトの Bun `file` loader で **dev / build 両方** URL に解決される
(build 時は outdir にハッシュ付きコピー)。`/images/...` のハードコード文字列 URL を
やめ、preset を import 経由のレジストリで参照する。

- Option 1 (dev サーバラップ) は build で public/ が dist にコピーされず壊れたまま → 不採用。
- Option 3 (data URL) はバンドル肥大・preset 追加にコード編集が必要 → 不採用。

## 変更

- `public/images/presets/*.svg` → `src/pose-particles/ui/assets/*.svg` へ移動 (git mv)。
- `src/pose-particles/ui/image-presets.ts` 新規: `IMAGE_PRESETS` / `IMAGE_PRESET_URLS`
  (import で解決) / `resolveImagePresetUrl(id)`。
- `src/pose-particles/assets.d.ts` 新規: `declare module "*.svg"`。
- `SettingsPanel.ts`: ローカル `IMAGE_PRESETS` を image-presets から import に変更。
- `App.ts`: preset の URL 構築を `resolveImagePresetUrl()` 経由に変更、誤コメント削除。
- `src/pose-particles/ui/image-presets.test.ts` 新規 (TDD)。

## 検証

- 全テスト: 412 pass / 0 fail (新規 3 件含む)。
- `bunx tsc --noEmit`: exit 0。
- `bun build ./pose-particles.html --outdir dist --minify`: dist に
  `sample-01-<hash>.svg` / `sample-02-<hash>.svg` がコピーされ JS が参照。
- dev サーバ + Playwright: 起動時の default preset が
  `/_bun/asset/<hash>.svg` で `200 / image/svg+xml` 配信。
  "failed to load image" の console エラー消失、page error なし。
