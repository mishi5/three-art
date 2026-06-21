import { expect, test, describe } from "bun:test";
import { buildOutputHtml, OUTPUT_CAPTURE_FPS } from "./output-window";

describe("buildOutputHtml (#148)", () => {
  const html = buildOutputHtml();

  test("映像のみ全画面: 黒背景・余白なし・object-fit:contain の video", () => {
    expect(html).toContain("<video");
    expect(html).toContain("object-fit: contain");      // アスペクト比維持
    expect(html).toContain("background:#000");          // 黒背景
    expect(html).toMatch(/margin:\s*0/);                // 余白なし
  });

  test("自動再生に必要な属性（autoplay/muted/playsinline）", () => {
    expect(html).toContain("autoplay");
    expect(html).toContain("muted");
    expect(html).toContain("playsinline");
  });

  test("クリックで全画面化する導線（requestFullscreen）を含む", () => {
    expect(html).toContain("requestFullscreen");
  });

  test("video 要素は id で参照できる", () => {
    expect(html).toMatch(/id=["']?out["']?/);
  });
});

describe("OUTPUT_CAPTURE_FPS (#148)", () => {
  test("妥当なフレームレート（1〜60）", () => {
    expect(OUTPUT_CAPTURE_FPS).toBeGreaterThan(0);
    expect(OUTPUT_CAPTURE_FPS).toBeLessThanOrEqual(60);
  });
});
