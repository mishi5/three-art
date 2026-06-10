import { expect, test, describe } from "bun:test";
import { buildPointCloudParams, DEFAULT_CURATED } from "./pointcloud-params";

describe("buildPointCloudParams", () => {
  test("既定で完全な PointCloudUpdateParams を構築", () => {
    const p = buildPointCloudParams({});
    expect(p.mode).toBe("bones");
    expect(p.shape.radius).toBe(0.4);
    expect(p.pointCloud.baseSize).toBe(3.0);
    expect(p.lattice.resolution).toBe(12);
    expect(p.image.gridW).toBe(80);
    // 非公開フィールドも既定で埋まる
    expect(p.pointCloud.trebleShimmer).toBe(0.05);
    expect(p.outlier.fraction).toBe(0.1);
    expect(p.color.bassHueShift).toBe(0);
  });

  test("curated 値が反映される", () => {
    const p = buildPointCloudParams({ mode: "lattice", radius: 1.2, gridW: 40, bassExpansion: 7 });
    expect(p.mode).toBe("lattice");
    expect(p.shape.radius).toBe(1.2);
    expect(p.image.gridW).toBe(40);
    expect(p.pointCloud.bassExpansion).toBe(7);
  });

  test("polyhedron は enum(select) 由来の文字列を数値へ正規化", () => {
    const p = buildPointCloudParams({ polyhedron: "8" as unknown as 8 });
    expect(p.shape.polyhedron).toBe(8);
    expect(buildPointCloudParams({}).shape.polyhedron).toBe(6);
  });

  test("twist は strength>0 で enabled", () => {
    expect(buildPointCloudParams({ twistStrength: 0 }).twist.enabled).toBe(false);
    const t = buildPointCloudParams({ twistStrength: 2, twistAxis: "x" }).twist;
    expect(t.enabled).toBe(true);
    expect(t.strength).toBe(2);
    expect(t.axis).toBe("x");
  });

  test("DEFAULT_CURATED は全 curated キーを持つ", () => {
    expect(Object.keys(DEFAULT_CURATED).length).toBe(16);
  });
});
