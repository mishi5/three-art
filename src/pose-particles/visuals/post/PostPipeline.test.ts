import { describe, it, expect } from "bun:test";
import * as THREE from "three";
import { PostPipeline } from "./PostPipeline";
import { makeDefaultSettings } from "../../settings";

function makePipeline() {
  // EffectComposer ctor は renderer.getSize / getPixelRatio を呼ぶため両方 stub する。
  const renderer = {
    getPixelRatio: () => 1,
    getSize: (target: THREE.Vector2) => target.set(800, 600),
  } as unknown as THREE.WebGLRenderer;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  return new PostPipeline(renderer, scene, camera);
}

describe("PostPipeline", () => {
  it.skip("constructs with all 3 effects registered", () => {
    const pp = makePipeline();
    expect(pp.hasEffect("blur")).toBe(true);
    expect(pp.hasEffect("kaleidoscope")).toBe(true);
    expect(pp.hasEffect("fractal")).toBe(true);
  });

  it("currentOrder() returns ['blur','kaleidoscope','fractal'] initially", () => {
    const pp = makePipeline();
    expect(pp.currentOrder()).toEqual(["blur", "kaleidoscope", "fractal"]);
  });

  it.skip("syncOrder rebuilds composer when order changes", () => {
    const pp = makePipeline();
    pp.syncOrder(["fractal", "kaleidoscope", "blur"]);
    expect(pp.currentOrder()).toEqual(["fractal", "kaleidoscope", "blur"]);
  });

  it.skip("syncOrder ignores unknown effect ids", () => {
    const pp = makePipeline();
    pp.syncOrder(["nonexistent", "blur", "kaleidoscope", "fractal"]);
    expect(pp.currentOrder()).toEqual(["blur", "kaleidoscope", "fractal"]);
  });

  it.skip("syncOrder is idempotent (same order does not change anything)", () => {
    const pp = makePipeline();
    const before = pp.currentOrder().slice();
    pp.syncOrder(before);
    expect(pp.currentOrder()).toEqual(before);
  });

  describe("update propagates settings.post.order to syncOrder", () => {
    it.skip("changing settings.post.order updates currentOrder after update()", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings();
      s.post.order = ["fractal", "blur", "kaleidoscope"];
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      expect(pp.currentOrder()).toEqual(["fractal", "blur", "kaleidoscope"]);
    });
  });

  describe("createPassesForTarget", () => {
    it("returns empty when all effects disabled", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings();
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      const passes = pp.createPassesForTarget(256, 144, 1600);
      expect(passes).toEqual([]);
    });

    it("returns blur passes when blur enabled, in current order", () => {
      const pp = makePipeline();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 2;
      pp.update(s, { volume: 0, bass: 0, mid: 0, treble: 0 });
      const passes = pp.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(4);
    });
  });
});
