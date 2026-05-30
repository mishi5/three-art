import { test, expect } from "bun:test";
import { IMAGE_PRESETS, IMAGE_PRESET_URLS, resolveImagePresetUrl } from "./image-presets";
import { makeDefaultSettings } from "../settings";

// Issue #53: public/ は Bun の HTML dev サーバではルート配信されず、未マッチパスに
// index.html (text/html) が 200 で返る。preset 画像は必ず asset import 経由で
// 解決された URL を使い、実在するアセットを指していなければならない。

test("すべての preset id が実在する .svg アセットの URL に解決される", async () => {
  for (const id of IMAGE_PRESETS) {
    const url = IMAGE_PRESET_URLS[id];
    expect(url).toBeTruthy();
    // Bun runtime の file loader は import を絶対パスに解決する。
    const file = Bun.file(url);
    expect(await file.exists()).toBe(true);
    const text = await file.text();
    expect(text).toContain("<svg");
  }
});

test("default settings の image.preset は解決可能な preset である", () => {
  const def = makeDefaultSettings();
  expect(resolveImagePresetUrl(def.image.preset)).toBeTruthy();
});

test("未知の preset id は undefined を返す (誤った /images/... パスを作らない)", () => {
  expect(resolveImagePresetUrl("does-not-exist.svg")).toBeUndefined();
});
