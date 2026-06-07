import { describe, it, expect } from "bun:test";
import { PointCloud } from "./PointCloud";

/**
 * Issue #36: サムネ生成時の解像度ミスマッチ対策。
 * gl_PointSize は drawing buffer pixel 単位で計算されるので、実画面 (例: 2000px)
 * 基準の uPixelRatio / uPixelPerWorld のままサムネ RT (144px) に描くと、粒子が
 * 相対的に巨大化して加算合成で白飛びする。
 *
 * withRenderScale は呼び出し前後で uniform を退避→上書き→復元する。
 */

function getU(pc: PointCloud) {
  // material は private なので Material 経由で uniform にアクセスする
  // (private 越しの読み出しは TS の構造的部分型でいけるはずだが、安全のため any)
  const m = (pc as unknown as { material: { uniforms: Record<string, { value: number }> } }).material;
  return m.uniforms;
}

describe("PointCloud.withRenderScale", () => {
  it("overrides uPixelRatio for the duration of fn", () => {
    const pc = new PointCloud(2.0);
    const u = getU(pc);
    u.uPixelRatio!.value = 2.0;
    let inside = -1;
    pc.withRenderScale(144, 0.15, 50, () => {
      inside = u.uPixelRatio!.value;
    });
    expect(inside).toBe(0.15);
  });

  it("restores uPixelRatio after fn returns", () => {
    const pc = new PointCloud(2.0);
    const u = getU(pc);
    u.uPixelRatio!.value = 2.0;
    pc.withRenderScale(144, 0.15, 50, () => {});
    expect(u.uPixelRatio!.value).toBe(2.0);
  });

  it("updates uPixelPerWorld to match the thumbnail drawing-buffer height while inside fn", () => {
    const pc = new PointCloud(2.0);
    const u = getU(pc);
    pc.setProjection(2160, 50); // 実画面 setup
    const before = u.uPixelPerWorld!.value;
    let inside = -1;
    pc.withRenderScale(144, 0.1, 50, () => {
      inside = u.uPixelPerWorld!.value;
    });
    // サムネ高 144 / (2 * tan(25deg)) ≒ 154.4 -- 実画面値より遥かに小さい
    expect(inside).toBeLessThan(before);
    expect(inside).toBeGreaterThan(0);
  });

  it("restores uPixelPerWorld after fn returns", () => {
    const pc = new PointCloud(2.0);
    const u = getU(pc);
    pc.setProjection(2160, 50);
    const before = u.uPixelPerWorld!.value;
    pc.withRenderScale(144, 0.1, 50, () => {});
    expect(u.uPixelPerWorld!.value).toBe(before);
  });

  it("returns whatever fn returns", () => {
    const pc = new PointCloud(2.0);
    const got = pc.withRenderScale(144, 0.1, 50, () => "sentinel");
    expect(got).toBe("sentinel");
  });

  it("restores uniforms even if fn throws", () => {
    const pc = new PointCloud(2.0);
    const u = getU(pc);
    pc.setProjection(2160, 50);
    const savedPxRatio = u.uPixelRatio!.value;
    const savedPxPerWorld = u.uPixelPerWorld!.value;
    expect(() =>
      pc.withRenderScale(144, 0.1, 50, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(u.uPixelRatio!.value).toBe(savedPxRatio);
    expect(u.uPixelPerWorld!.value).toBe(savedPxPerWorld);
  });
});
