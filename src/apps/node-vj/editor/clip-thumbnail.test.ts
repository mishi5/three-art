import { expect, test, describe } from "bun:test";
import { thumbTransform, type Rect } from "./clip-thumbnail";

describe("thumbTransform (#206 クリップサムネイルの配置変換)", () => {
  test("空集合は等倍・原点", () => {
    expect(thumbTransform([], 100, 50, 4)).toEqual({ scale: 1, ox: 0, oy: 0 });
  });

  test("bbox を内側(pad)に収め、各頂点が枠内に入る", () => {
    const rects: Rect[] = [
      { x: 0, y: 0, w: 100, h: 50 },
      { x: 200, y: 100, w: 100, h: 50 },
    ];
    const W = 116, H = 56, pad = 4;
    const t = thumbTransform(rects, W, H, pad);
    // bbox = (0,0)〜(300,150)。各頂点を変換して [pad, W-pad]/[pad, H-pad] に収まる。
    const tx = (x: number): number => x * t.scale + t.ox;
    const ty = (y: number): number => y * t.scale + t.oy;
    for (const x of [0, 300]) { expect(tx(x)).toBeGreaterThanOrEqual(pad - 1e-6); expect(tx(x)).toBeLessThanOrEqual(W - pad + 1e-6); }
    for (const y of [0, 150]) { expect(ty(y)).toBeGreaterThanOrEqual(pad - 1e-6); expect(ty(y)).toBeLessThanOrEqual(H - pad + 1e-6); }
  });

  test("アスペクト維持（横長 bbox は幅で律速）", () => {
    // bbox 300x30 を 116x56(pad4=内側108x48)へ。scale = min(108/300, 48/30)=0.36。
    const t = thumbTransform([{ x: 0, y: 0, w: 300, h: 30 }], 116, 56, 4);
    expect(t.scale).toBeCloseTo(108 / 300, 6);
  });

  test("単一矩形は中央寄せされる", () => {
    const t = thumbTransform([{ x: 10, y: 10, w: 100, h: 50 }], 120, 60, 4);
    // 中央寄せ: 変換後の bbox 中心が枠中心(60,30)に一致。
    const cx = (10 + 100 / 2) * t.scale + t.ox;
    const cy = (10 + 50 / 2) * t.scale + t.oy;
    expect(cx).toBeCloseTo(60, 6);
    expect(cy).toBeCloseTo(30, 6);
  });
});
