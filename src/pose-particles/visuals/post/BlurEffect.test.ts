import { describe, it, expect } from "bun:test";
import * as THREE from "three";
import { BlurEffect } from "./BlurEffect";
import { makeDefaultSettings } from "../../settings";
import { MAX_BLUR_ITERATIONS } from "../blur";

function makeAudio(bass = 0) {
  return { volume: 0, bass, mid: 0, treble: 0 };
}

describe("BlurEffect", () => {
  it("id is 'blur'", () => {
    const e = new BlurEffect();
    expect(e.id).toBe("blur");
    e.dispose();
  });

  it("creates MAX_BLUR_ITERATIONS pairs of passes (H + V) = 2 * MAX", () => {
    const e = new BlurEffect();
    expect(e.passes.length).toBe(MAX_BLUR_ITERATIONS * 2);
    e.dispose();
  });

  it("all passes are disabled initially", () => {
    const e = new BlurEffect();
    for (const p of e.passes) expect(p.enabled).toBe(false);
    e.dispose();
  });

  it("update with blur.enabled=false leaves all passes disabled", () => {
    const e = new BlurEffect();
    const s = makeDefaultSettings();
    s.blur.enabled = false;
    s.blur.strength = 5;
    e.update(s, makeAudio());
    for (const p of e.passes) expect(p.enabled).toBe(false);
    e.dispose();
  });

  it("update with blur.enabled=true and strength>0 enables iterations*2 passes", () => {
    const e = new BlurEffect();
    const s = makeDefaultSettings();
    s.blur.enabled = true;
    s.blur.strength = 4;
    s.blur.iterations = 3;
    s.blur.bassDrive = 0;
    e.update(s, makeAudio());
    const enabledCount = e.passes.filter((p) => p.enabled).length;
    expect(enabledCount).toBe(3 * 2);
    e.dispose();
  });

  it("setSize updates uTexel uniform on all passes", () => {
    const e = new BlurEffect();
    e.setSize(800, 600, 2);
    const expectedTexelW = 1 / 1600;
    for (const p of e.passes) {
      const texel = p.uniforms.uTexel!.value as THREE.Vector2;
      expect(texel.x).toBeCloseTo(expectedTexelW, 8);
    }
    e.dispose();
  });

  describe("createPassesForTarget", () => {
    it("returns [] when no passes enabled", () => {
      const e = new BlurEffect();
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes).toEqual([]);
      e.dispose();
    });

    it("returns 2 * iterations passes when blur enabled", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 2;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(4);
      e.dispose();
    });

    it("scales radius by targetW/fullSourceW", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 8;
      s.blur.iterations = 1;
      s.blur.bassDrive = 0;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      for (const p of passes) {
        expect(p.uniforms.uRadius!.value as number).toBeCloseTo(1.28, 4);
      }
      e.dispose();
    });

    it("sets uTexel to 1/target for returned passes", () => {
      const e = new BlurEffect();
      const s = makeDefaultSettings();
      s.blur.enabled = true;
      s.blur.strength = 4;
      s.blur.iterations = 1;
      e.update(s, makeAudio());
      const passes = e.createPassesForTarget(256, 144, 1600);
      for (const p of passes) {
        const texel = p.uniforms.uTexel!.value as THREE.Vector2;
        expect(texel.x).toBeCloseTo(1 / 256, 8);
        expect(texel.y).toBeCloseTo(1 / 144, 8);
      }
      e.dispose();
    });
  });
});
