import { describe, it, expect } from "bun:test";
import { FractalEffect } from "./FractalEffect";
import { makeDefaultSettings } from "../../settings";

const ZERO_AUDIO = { volume: 0, bass: 0, mid: 0, treble: 0 };

describe("FractalEffect", () => {
  it("id is 'fractal'", () => {
    const e = new FractalEffect();
    expect(e.id).toBe("fractal");
    e.dispose();
  });

  it("has exactly one ShaderPass, disabled initially", () => {
    const e = new FractalEffect();
    expect(e.passes.length).toBe(1);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("update with enabled=true and mix>0 enables pass and sets uniforms", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.iterations = 4;
    s.post.fractal.scale = 0.6;
    s.post.fractal.centerX = -0.1;
    s.post.fractal.centerY = 0.2;
    s.post.fractal.rotation = 0.3;
    s.post.fractal.fade = 0.5;
    s.post.fractal.mix = 0.8;
    e.update(s, ZERO_AUDIO);
    const u = e.passes[0]!.uniforms;
    expect(e.passes[0]!.enabled).toBe(true);
    expect(u.uIterations!.value).toBe(4);
    expect(u.uScale!.value).toBeCloseTo(0.6, 6);
    expect((u.uCenter!.value as { x: number; y: number }).x).toBeCloseTo(-0.1, 6);
    expect((u.uCenter!.value as { x: number; y: number }).y).toBeCloseTo(0.2, 6);
    expect(u.uRotation!.value).toBeCloseTo(0.3, 6);
    expect(u.uFade!.value).toBeCloseTo(0.5, 6);
    expect(u.uMix!.value).toBeCloseTo(0.8, 6);
    e.dispose();
  });

  it("update disables pass when mix=0", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.mix = 0;
    e.update(s, ZERO_AUDIO);
    expect(e.passes[0]!.enabled).toBe(false);
    e.dispose();
  });

  it("createPassesForTarget returns [] when disabled", () => {
    const e = new FractalEffect();
    expect(e.createPassesForTarget(256, 144, 1600)).toEqual([]);
    e.dispose();
  });

  it("createPassesForTarget returns 1 pass copy when enabled", () => {
    const e = new FractalEffect();
    const s = makeDefaultSettings();
    s.post.fractal.enabled = true;
    s.post.fractal.iterations = 3;
    e.update(s, ZERO_AUDIO);
    const passes = e.createPassesForTarget(256, 144, 1600);
    expect(passes.length).toBe(1);
    expect(passes[0]!.uniforms.uIterations!.value).toBe(3);
    e.dispose();
  });

  describe("fragment shader sanity", () => {
    it("is ASCII only", () => {
      // eslint-disable-next-line no-control-regex
      expect(/^[\x00-\x7F]*$/.test(FractalEffect.FRAGMENT_SHADER)).toBe(true);
    });

    it("uses fixed-bound for loop (WebGL1 ESSL 1.0 constraint)", () => {
      expect(FractalEffect.FRAGMENT_SHADER).toContain("for (int i = 0; i < 6; i++)");
    });

    it("does not use integer modulo (%)", () => {
      expect(FractalEffect.FRAGMENT_SHADER.includes("%")).toBe(false);
    });
  });
});
