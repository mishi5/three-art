// #282: ワープ転写（フルスクリーンクアッド＋逆 homography シェーダ）のテスト。
// GL なしで検証できる範囲: シェーダソースの健全性と uniform 更新ロジック。
import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import { WarpBlitter, WARP_FRAGMENT_SHADER, WARP_VERTEX_SHADER } from "./warp-blit";
import { IDENTITY_MAT3 } from "./warp-logic";

describe("ワープシェーダソース (#282)", () => {
  test("GLSL ソースは ASCII のみ（非 ASCII コメントはドライバによって silent fail する）", () => {
    // eslint-disable-next-line no-control-regex
    expect(/^[\x00-\x7f]*$/.test(WARP_VERTEX_SHADER)).toBe(true);
    expect(/^[\x00-\x7f]*$/.test(WARP_FRAGMENT_SHADER)).toBe(true);
  });

  test("逆 homography（uInvH）でソース UV を引き、[0,1] 外は黒にする", () => {
    expect(WARP_FRAGMENT_SHADER).toContain("uniform mat3 uInvH");
    expect(WARP_FRAGMENT_SHADER).toContain("uniform sampler2D uTex");
    // 同次除算と範囲外の黒フォールバック
    expect(WARP_FRAGMENT_SHADER).toMatch(/\.xy\s*\/\s*\w+\.z/);
    expect(WARP_FRAGMENT_SHADER).toContain("vec4(0.0, 0.0, 0.0, 1.0)");
  });
});

describe("WarpBlitter.setWarp (#282)", () => {
  test("texture と逆 homography を uniform へ反映する（row-major → THREE 列優先）", () => {
    const b = new WarpBlitter();
    const tex = new THREE.Texture();
    // row-major: [a b c; d e f; g h i]
    const invH = [1, 2, 3, 4, 5, 6, 7, 8, 9] as const;
    b.setWarp(tex, invH);
    expect(b.uniforms.uTex.value).toBe(tex);
    const el = (b.uniforms.uInvH.value as THREE.Matrix3).elements;
    // THREE.Matrix3.elements は column-major
    expect([...el]).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  test("恒等行列で初期化される", () => {
    const b = new WarpBlitter();
    const el = (b.uniforms.uInvH.value as THREE.Matrix3).elements;
    expect([...el]).toEqual([...IDENTITY_MAT3]); // 恒等は転置しても同じ
  });
});
