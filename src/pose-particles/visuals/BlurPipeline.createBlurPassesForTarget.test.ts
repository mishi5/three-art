import { describe, it, expect } from "bun:test";
import * as THREE from "three";
import { BlurPipeline } from "./BlurPipeline";
import { MAX_BLUR_ITERATIONS, type BlurSettings } from "./blur";

/**
 * Issue #36: サムネに実画面の Blur を再現するため、現在の blur 設定を
 * サムネ RT サイズ向けにスケーリングした blur パス列を生成する API。
 *
 * テスト戦略: BlurPipeline は EffectComposer / ShaderPass を内部に持つが、
 * いずれも WebGL コンテキストなしで構築可能 (ShaderMaterial は uniform オブジェクト
 * の集合体としてのみ存在)。よって BlurPipeline の構築～createBlurPassesForTarget は
 * happy-dom 環境でも検査できる。
 */

function makeFakeRenderer(pixelRatio = 1): THREE.WebGLRenderer {
  // BlurPipeline コンストラクタは renderer.getPixelRatio() のみ呼ぶ
  // (EffectComposer 内で getSize / getPixelRatio が呼ばれる)
  return {
    getPixelRatio: () => pixelRatio,
    getSize: (target: THREE.Vector2) => target.set(800, 600),
  } as unknown as THREE.WebGLRenderer;
}

function makeBlurPipeline(): BlurPipeline {
  const renderer = makeFakeRenderer(1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return new BlurPipeline(renderer, scene, camera);
}

describe("BlurPipeline.createBlurPassesForTarget", () => {
  it("returns an empty array when blur is disabled (radius=0)", () => {
    const bp = makeBlurPipeline();
    const settings: BlurSettings = { enabled: false, strength: 4, bassDrive: 0, iterations: 3 };
    bp.update(settings, 0);
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(0);
  });

  it("returns 2 passes per enabled iteration (horizontal + vertical)", () => {
    const bp = makeBlurPipeline();
    const settings: BlurSettings = { enabled: true, strength: 4, bassDrive: 0, iterations: 3 };
    bp.update(settings, 0);
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(6); // 3 iterations × 2 (H+V)
  });

  it("caps at the number of enabled pairs (does not exceed MAX_BLUR_ITERATIONS)", () => {
    const bp = makeBlurPipeline();
    const settings: BlurSettings = { enabled: true, strength: 4, bassDrive: 0, iterations: MAX_BLUR_ITERATIONS + 10 };
    bp.update(settings, 0);
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(MAX_BLUR_ITERATIONS * 2);
  });

  it("sets uTexel to (1/targetW, 1/targetH) on every pass", () => {
    const bp = makeBlurPipeline();
    bp.update({ enabled: true, strength: 4, bassDrive: 0, iterations: 2 }, 0);
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    for (const p of passes) {
      const t = p.uniforms.uTexel!.value as THREE.Vector2;
      expect(t.x).toBeCloseTo(1 / 256, 6);
      expect(t.y).toBeCloseTo(1 / 144, 6);
    }
  });

  it("scales uRadius by targetW / fullSourceW so the relative blur matches the full screen", () => {
    const bp = makeBlurPipeline();
    bp.update({ enabled: true, strength: 8, bassDrive: 0, iterations: 1 }, 0);
    // 期待値: 元の radius * (256/1600)
    // 内部の blurPair の uRadius を見て元の値を読み取る
    const internal = (bp as unknown as { blurPairs: Array<{ horizontal: { uniforms: Record<string, { value: number }> } }> }).blurPairs;
    const originalRadius = internal[0]!.horizontal.uniforms.uRadius!.value;
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(2);
    const scale = 256 / 1600;
    for (const p of passes) {
      const r = p.uniforms.uRadius!.value as number;
      expect(r).toBeCloseTo(originalRadius * scale, 6);
    }
  });

  it("alternates uDirection between (1,0) and (0,1) for horizontal/vertical pairs", () => {
    const bp = makeBlurPipeline();
    bp.update({ enabled: true, strength: 4, bassDrive: 0, iterations: 2 }, 0);
    const passes = bp.createBlurPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(4);
    const dir = (i: number) => passes[i]!.uniforms.uDirection!.value as THREE.Vector2;
    expect(dir(0).x).toBe(1); expect(dir(0).y).toBe(0);
    expect(dir(1).x).toBe(0); expect(dir(1).y).toBe(1);
    expect(dir(2).x).toBe(1); expect(dir(2).y).toBe(0);
    expect(dir(3).x).toBe(0); expect(dir(3).y).toBe(1);
  });
});
