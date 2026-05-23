import { describe, it, expect } from "bun:test";
import {
  RANDOMIZE_DESCRIPTORS,
  randomizeSettings,
  descriptorsForMode,
} from "./randomize";
import { makeDefaultSettings, RENDER_MODES, type RenderMode } from "../settings";
import { settingsLeafPaths } from "./param-docs";

/** Deterministic PRNG so range/clamp assertions are reproducible. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function getByPath(obj: unknown, path: string): unknown {
  let cur: unknown = obj;
  for (const key of path.split(".")) {
    if (cur === null || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[key];
  }
  return cur;
}

describe("RANDOMIZE_DESCRIPTORS", () => {
  it("every descriptor path resolves to a leaf in default settings", () => {
    const def = makeDefaultSettings();
    for (const d of RANDOMIZE_DESCRIPTORS) {
      const v = getByPath(def, d.spec.path);
      expect(v).toBeDefined();
      expect(typeof v).not.toBe("object");
    }
  });

  it("has no duplicate paths", () => {
    const paths = RANDOMIZE_DESCRIPTORS.map((d) => d.spec.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("never targets the render mode itself", () => {
    expect(RANDOMIZE_DESCRIPTORS.some((d) => d.spec.path === "mode")).toBe(false);
  });

  it("never targets auto.* (control system, not 演出)", () => {
    expect(RANDOMIZE_DESCRIPTORS.some((d) => d.spec.path.startsWith("auto."))).toBe(false);
  });

  /**
   * drift 検知: Settings に leaf を追加したのに descriptor を追加し忘れる
   * 事故 (Issue #37 で実際に起きた、edges.wave/rewire が漏れた件) を防ぐ。
   * 明示的に除外する leaf 以外、全 leaf が descriptor に登録されていること。
   */
  it("covers every Settings leaf except explicit exclusions", () => {
    const allLeaves = settingsLeafPaths(makeDefaultSettings());
    const isExcluded = (p: string): boolean =>
      p === "mode" || p.startsWith("auto.");
    const covered = new Set(RANDOMIZE_DESCRIPTORS.map((d) => d.spec.path));
    const missing = allLeaves.filter((p) => !isExcluded(p) && !covered.has(p));
    expect(missing).toEqual([]);
  });
});

describe("descriptorsForMode", () => {
  function paths(mode: RenderMode): string[] {
    return descriptorsForMode(mode).map((d) => d.spec.path);
  }

  it("common params apply to every mode", () => {
    for (const m of RENDER_MODES) {
      const p = paths(m);
      expect(p).toContain("color.saturation");
      expect(p).toContain("twist.strength");
      expect(p).toContain("audioGain.volume");
    }
  });

  it("image mode includes image.* and shared lattice wave, excludes rain/shape/edges", () => {
    const p = paths("image");
    expect(p).toContain("image.gridW");
    expect(p).toContain("image.preset");
    expect(p).toContain("lattice.waveSpeed");
    expect(p).not.toContain("lattice.resolution");
    expect(p).not.toContain("rain.baseSpeed");
    expect(p).not.toContain("shape.radius");
    expect(p).not.toContain("edges.enabled");
  });

  it("bones mode includes joint/edge params, excludes shape/image/rain/lattice", () => {
    const p = paths("bones");
    expect(p).toContain("pointCloud.bassExpansion");
    expect(p).toContain("edges.enabled");
    expect(p).toContain("pointCloud.baseSize");
    expect(p).not.toContain("shape.radius");
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("rain.baseSpeed");
    expect(p).not.toContain("lattice.waveSpeed");
  });

  it("cube/sphere modes include shape, exclude bones-only edges/bassExpansion", () => {
    for (const m of ["cube", "sphere"] as const) {
      const p = paths(m);
      expect(p).toContain("shape.radius");
      expect(p).toContain("pointCloud.baseSize");
      expect(p).not.toContain("edges.enabled");
      expect(p).not.toContain("pointCloud.bassExpansion");
      expect(p).not.toContain("image.gridW");
    }
  });

  it("lattice mode includes full lattice.* incl resolution", () => {
    const p = paths("lattice");
    expect(p).toContain("lattice.resolution");
    expect(p).toContain("lattice.waveAmplitude");
    expect(p).toContain("lattice.waveSpeed");
    expect(p).toContain("pointCloud.baseSize");
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("rain.baseSpeed");
  });

  it("rain mode includes rain.* only for mode-specific group", () => {
    const p = paths("rain");
    expect(p).toContain("rain.count");
    expect(p).toContain("rain.binMapping");
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("shape.radius");
    expect(p).not.toContain("pointCloud.bassExpansion");
  });
});

describe("randomizeSettings", () => {
  it("never changes the render mode", () => {
    for (const m of RENDER_MODES) {
      const base = makeDefaultSettings();
      base.mode = m;
      const out = randomizeSettings(base, m, mulberry32(1));
      expect(out.mode).toBe(m);
    }
  });

  it("does not mutate the base settings object", () => {
    const base = makeDefaultSettings();
    const snapshot = JSON.stringify(base);
    randomizeSettings(base, "bones", mulberry32(42));
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("leaves params outside the current mode untouched", () => {
    const base = makeDefaultSettings();
    base.mode = "rain";
    const out = randomizeSettings(base, "rain", mulberry32(7));
    // shape.* is not part of rain mode → unchanged
    expect(out.shape.radius).toBe(base.shape.radius);
    expect(out.image.gridW).toBe(base.image.gridW);
  });

  it("numeric params stay within [min,max] and align to step (all modes, many seeds)", () => {
    for (const m of RENDER_MODES) {
      for (let seed = 0; seed < 25; seed++) {
        const out = randomizeSettings(makeDefaultSettings(), m, mulberry32(seed * 13 + 1));
        for (const d of descriptorsForMode(m)) {
          if (d.spec.kind !== "number") continue;
          const v = getByPath(out, d.spec.path) as number;
          expect(typeof v).toBe("number");
          expect(v).toBeGreaterThanOrEqual(d.spec.min - 1e-9);
          expect(v).toBeLessThanOrEqual(d.spec.max + 1e-9);
          const steps = (v - d.spec.min) / d.spec.step;
          expect(Math.abs(steps - Math.round(steps))).toBeLessThan(1e-6);
        }
      }
    }
  });

  it("edge rngs (≈0 and ≈1) stay within range", () => {
    for (const m of RENDER_MODES) {
      for (const rng of [() => 0, () => 1 - 1e-12]) {
        const out = randomizeSettings(makeDefaultSettings(), m, rng);
        for (const d of descriptorsForMode(m)) {
          if (d.spec.kind !== "number") continue;
          const v = getByPath(out, d.spec.path) as number;
          expect(v).toBeGreaterThanOrEqual(d.spec.min - 1e-9);
          expect(v).toBeLessThanOrEqual(d.spec.max + 1e-9);
        }
      }
    }
  });

  it("enum params resolve to one of their options; booleans are boolean", () => {
    for (const m of RENDER_MODES) {
      const out = randomizeSettings(makeDefaultSettings(), m, mulberry32(99));
      for (const d of descriptorsForMode(m)) {
        const v = getByPath(out, d.spec.path);
        if (d.spec.kind === "enum") {
          expect(d.spec.options).toContain(v as string);
        } else if (d.spec.kind === "boolean") {
          expect(typeof v).toBe("boolean");
        }
      }
    }
  });

  it("image gridW*gridH never exceeds the 5200 particle budget", () => {
    for (let seed = 0; seed < 200; seed++) {
      const out = randomizeSettings(makeDefaultSettings(), "image", mulberry32(seed + 1));
      expect(out.image.gridW * out.image.gridH).toBeLessThanOrEqual(5200);
      expect(out.image.gridW).toBeGreaterThanOrEqual(8);
      expect(out.image.gridH).toBeGreaterThanOrEqual(8);
    }
  });

  it("image.preset never randomizes to the (uploaded) tag", () => {
    for (let seed = 0; seed < 50; seed++) {
      const out = randomizeSettings(makeDefaultSettings(), "image", mulberry32(seed + 1));
      expect(out.image.preset).not.toBe("(uploaded)");
    }
  });
});
