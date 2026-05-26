import { describe, it, expect } from "bun:test";
import { KaleidoscopeEffect } from "./KaleidoscopeEffect";
import { makeDefaultSettings } from "../../settings";

const ZERO_AUDIO = { volume: 0, bass: 0, mid: 0, treble: 0 };

describe("KaleidoscopeEffect", () => {
  it("id is 'kaleidoscope'", () => {
    const e = new KaleidoscopeEffect();
    expect(e.id).toBe("kaleidoscope");
    e.dispose();
  });

  it("has exactly one ShaderPass", () => {
    const e = new KaleidoscopeEffect();
    expect(e.passes.length).toBe(1);
    e.dispose();
  });

  it("pass disabled initially", () => {
    const e = new KaleidoscopeEffect();
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=false keeps pass disabled even with mix > 0", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = false;
    s.post.kaleidoscope.mix = 1;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=true and mix > 0 enables pass and propagates uniforms", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = true;
    s.post.kaleidoscope.segments = 8;
    s.post.kaleidoscope.centerX = 0.1;
    s.post.kaleidoscope.centerY = -0.2;
    s.post.kaleidoscope.rotation = 0.5;
    s.post.kaleidoscope.mix = 0.75;
    e.update(s, ZERO_AUDIO);
    const u = e.passes[0]!.uniforms;
    expect(e.passes[0]!.enabled).toBe(true);
    expect(u.uSegments!.value).toBe(8);
    expect((u.uCenter!.value as { x: number; y: number }).x).toBeCloseTo(0.1, 6);
    expect((u.uCenter!.value as { x: number; y: number }).y).toBeCloseTo(-0.2, 6);
    expect(u.uRotation!.value).toBeCloseTo(0.5, 6);
    expect(u.uMix!.value).toBeCloseTo(0.75, 6);
    e.dispose();
  });

  it("update with mix === 0 disables pass (early-out)", () => {
    const e = new KaleidoscopeEffect();
    const s = makeDefaultSettings();
    s.post.kaleidoscope.enabled = true;
    s.post.kaleidoscope.mix = 0;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("setSize updates uAspect uniform", () => {
    const e = new KaleidoscopeEffect();
    e.setSize(1600, 900, 1);
    expect(e.passes[0]!.uniforms.uAspect!.value).toBeCloseTo(1600 / 900, 6);
    e.dispose();
  });

  describe("createPassesForTarget", () => {
    it("returns [] when disabled", () => {
      const e = new KaleidoscopeEffect();
      expect(e.createPassesForTarget(256, 144, 1600)).toEqual([]);
      e.dispose();
    });

    it("returns 1 pass when enabled, with target aspect", () => {
      const e = new KaleidoscopeEffect();
      const s = makeDefaultSettings();
      s.post.kaleidoscope.enabled = true;
      s.post.kaleidoscope.segments = 6;
      e.update(s, ZERO_AUDIO);
      const passes = e.createPassesForTarget(256, 144, 1600);
      expect(passes.length).toBe(1);
      expect(passes[0]!.uniforms.uSegments!.value).toBe(6);
      expect(passes[0]!.uniforms.uAspect!.value).toBeCloseTo(256 / 144, 6);
      e.dispose();
    });
  });

  describe("fragment shader sanity", () => {
    it("is ASCII only (Three.js GLSL parser quirks)", () => {
      const src = KaleidoscopeEffect.FRAGMENT_SHADER;
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(src)).toBe(true);
    });

    it("does not use integer modulo (%) at top level (WebGL1)", () => {
      const src = KaleidoscopeEffect.FRAGMENT_SHADER;
      expect(src.includes("%")).toBe(false);
    });
  });
});
