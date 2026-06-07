import { describe, it, expect } from "bun:test";
import { FragmentField } from "./FragmentField";

/**
 * Issue #36: サムネ生成時の解像度ミスマッチ対策 (FragmentField 版)。
 * FragmentField は uPixelRatio のみ持つ (uPixelPerWorld は image モード用で
 * PointCloud にしか無い)。
 */

function getU(ff: FragmentField) {
  const m = (ff as unknown as { material: { uniforms: Record<string, { value: number }> } }).material;
  return m.uniforms;
}

describe("FragmentField.withRenderScale", () => {
  it("overrides uPixelRatio for the duration of fn", () => {
    const ff = new FragmentField(2.0);
    const u = getU(ff);
    u.uPixelRatio!.value = 2.0;
    let inside = -1;
    ff.withRenderScale(0.15, () => {
      inside = u.uPixelRatio!.value;
    });
    expect(inside).toBe(0.15);
  });

  it("restores uPixelRatio after fn returns", () => {
    const ff = new FragmentField(2.0);
    const u = getU(ff);
    u.uPixelRatio!.value = 2.0;
    ff.withRenderScale(0.15, () => {});
    expect(u.uPixelRatio!.value).toBe(2.0);
  });

  it("returns whatever fn returns", () => {
    const ff = new FragmentField(2.0);
    const got = ff.withRenderScale(0.1, () => 42);
    expect(got).toBe(42);
  });

  it("restores uniforms even if fn throws", () => {
    const ff = new FragmentField(2.0);
    const u = getU(ff);
    u.uPixelRatio!.value = 2.0;
    expect(() =>
      ff.withRenderScale(0.1, () => {
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(u.uPixelRatio!.value).toBe(2.0);
  });
});
