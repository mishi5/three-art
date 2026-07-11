// #281: ImageTextureSurface の fade 対応（#241 の VideoTextureSurface と同じ知覚補正付き輝度乗算）のテスト。
// 既定値 fade=1 で従来挙動（色=白）を保つこと（既存呼び出し元 ImageFileInput は挙動不変）を検証する。
import * as THREE from "three";
import { expect, test, describe } from "bun:test";
import { ImageTextureSurface } from "./image-surface";
import { FADE_GAMMA } from "../nodes/video-fade-logic";

/** GPU を触らない範囲の fake renderer（render/RT 切替は no-op）。 */
function fakeRenderer(w = 64, h = 48): THREE.WebGLRenderer {
  return {
    domElement: { width: w, height: h },
    getRenderTarget: () => null,
    setRenderTarget() { /* no-op */ },
    clear() { /* no-op */ },
    render() { /* no-op */ },
  } as unknown as THREE.WebGLRenderer;
}

/** Texture の image になるだけの fake 画像要素。 */
function fakeImage(w = 320, h = 240): HTMLImageElement {
  return { naturalWidth: w, naturalHeight: h } as unknown as HTMLImageElement;
}

type Internals = { material: THREE.MeshBasicMaterial };

describe("#281 ImageTextureSurface の fade 反映", () => {
  test("fade 省略時は従来挙動（color=白のまま）", () => {
    const s = new ImageTextureSurface();
    s.render(fakeRenderer(), fakeImage());
    const mat = (s as unknown as Internals).material;
    expect(mat.color.r).toBe(1);
    expect(mat.color.g).toBe(1);
    expect(mat.color.b).toBe(1);
    s.dispose();
  });

  test("fade は f^2.2 の知覚補正付きで material.color に乗る", () => {
    const s = new ImageTextureSurface();
    s.render(fakeRenderer(), fakeImage(), 0.25);
    const mat = (s as unknown as Internals).material;
    const expected = Math.pow(0.25, FADE_GAMMA);
    expect(mat.color.r).toBeCloseTo(expected);
    s.render(fakeRenderer(), fakeImage(), 0); // 全黒
    expect(mat.color.r).toBe(0);
    s.render(fakeRenderer(), fakeImage(), 1); // 原状
    expect(mat.color.r).toBe(1);
    s.dispose();
  });

  test("範囲外・NaN は安全側に丸める（clampFade）", () => {
    const s = new ImageTextureSurface();
    s.render(fakeRenderer(), fakeImage(), 2);
    const mat = (s as unknown as Internals).material;
    expect(mat.color.r).toBe(1);
    s.render(fakeRenderer(), fakeImage(), -1);
    expect(mat.color.r).toBe(0);
    s.render(fakeRenderer(), fakeImage(), Number.NaN); // 不正値は既定 1（従来描画）
    expect(mat.color.r).toBe(1);
    s.dispose();
  });
});
