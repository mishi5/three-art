import sample01Url from "./assets/sample-01.svg";
import sample02Url from "./assets/sample-02.svg";

/**
 * 利用可能なプリセット画像の識別子。`settings.image.preset` の値 / GUI 選択肢キーに使う。
 * ここを増やす場合は import と {@link IMAGE_PRESET_URLS} も合わせて追加すること。
 */
export const IMAGE_PRESETS = ["sample-01.svg", "sample-02.svg"] as const;
export type ImagePresetId = typeof IMAGE_PRESETS[number];

/**
 * preset 識別子 → バンドル後のアセット URL。
 *
 * Issue #53: Bun の HTML dev サーバは `public/` をルート配信せず、未マッチパスに
 * index.html (text/html) を 200 で返す。そのため `/images/presets/...` のような
 * 文字列 URL は画像として読み込めない。`.svg` を import すると Bun の file loader が
 * dev / build 両方で URL を解決する (build 時は outdir へハッシュ付きでコピー) ので、
 * preset は必ずこのレジストリ経由で参照する。
 */
export const IMAGE_PRESET_URLS: Record<ImagePresetId, string> = {
  "sample-01.svg": sample01Url,
  "sample-02.svg": sample02Url,
};

/** preset 識別子からアセット URL を引く。未知の id は undefined。 */
export function resolveImagePresetUrl(id: string): string | undefined {
  return IMAGE_PRESET_URLS[id as ImagePresetId];
}
