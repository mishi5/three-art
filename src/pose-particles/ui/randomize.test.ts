import { describe, it, expect } from "bun:test";
import {
  RANDOMIZE_DESCRIPTORS,
  randomizeSettings,
  descriptorsForMode,
  safeRandomizeSettings,
  DEFAULT_SAFE_EXCLUDED,
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
   *
   * 除外:
   * - `mode`: render mode 自体 (ランダム化対象外)
   * - `auto.*`: 制御系 (演出ではない)
   * - `image.preset`: ファイル欠落でロードエラーになるため (Issue #37)
   */
  it("covers every Settings leaf except explicit exclusions", () => {
    const allLeaves = settingsLeafPaths(makeDefaultSettings());
    const isExcluded = (p: string): boolean =>
      p === "mode" || p.startsWith("auto.") || p === "image.preset";
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

  it("image mode includes image.* and shared lattice wave, excludes rain/shape/edges; never image.preset (Issue #37)", () => {
    const p = paths("image");
    expect(p).toContain("image.gridW");
    expect(p).toContain("lattice.waveSpeed");
    expect(p).not.toContain("image.preset"); // #37: preset 欠落でロードエラーを誘発するため対象外
    expect(p).not.toContain("lattice.resolution");
    expect(p).not.toContain("rain.baseSpeed");
    expect(p).not.toContain("shape.radius");
    expect(p).not.toContain("edges.enabled");
  });

  it("bones mode includes joint/edge/shape params (Issue #37), excludes image/rain/lattice", () => {
    const p = paths("bones");
    expect(p).toContain("pointCloud.bassExpansion");
    expect(p).toContain("edges.enabled");
    expect(p).toContain("edges.wave.amplitude");
    expect(p).toContain("edges.rewire.interval");
    expect(p).toContain("pointCloud.baseSize");
    expect(p).toContain("shape.radius"); // #37: bones にも追加 (relevance: PARTICLE)
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("rain.baseSpeed");
    expect(p).not.toContain("lattice.waveSpeed");
  });

  it("cube/sphere modes include shape and edges (Issue #37), exclude bones-only bassExpansion", () => {
    for (const m of ["cube", "sphere"] as const) {
      const p = paths(m);
      expect(p).toContain("shape.radius");
      expect(p).toContain("pointCloud.baseSize");
      expect(p).toContain("edges.enabled"); // #37: EdgeOverlay は cube/sphere でも描画される
      expect(p).toContain("edges.wave.amplitude");
      expect(p).toContain("edges.rewire.interval");
      expect(p).not.toContain("pointCloud.bassExpansion");
      expect(p).not.toContain("image.gridW");
    }
  });

  it("lattice mode includes full lattice.* incl resolution and shape (Issue #37)", () => {
    const p = paths("lattice");
    expect(p).toContain("lattice.resolution");
    expect(p).toContain("lattice.waveAmplitude");
    expect(p).toContain("lattice.waveSpeed");
    expect(p).toContain("pointCloud.baseSize");
    expect(p).toContain("shape.radius"); // #37: lattice にも追加 (relevance: PARTICLE)
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("rain.baseSpeed");
    expect(p).not.toContain("edges.enabled");
  });

  it("rain mode includes rain.* only for mode-specific group", () => {
    const p = paths("rain");
    expect(p).toContain("rain.count");
    expect(p).toContain("rain.binMapping");
    expect(p).not.toContain("image.gridW");
    expect(p).not.toContain("shape.radius");
    expect(p).not.toContain("pointCloud.bassExpansion");
  });

  it("cube mode includes shape.polyhedron (Issue #40), other modes exclude it", () => {
    expect(paths("cube")).toContain("shape.polyhedron");
    for (const m of ["bones", "sphere", "lattice", "image", "rain"] as const) {
      expect(paths(m)).not.toContain("shape.polyhedron");
    }
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

  it("image.preset is never mutated (Issue #37: removed from descriptors)", () => {
    for (let seed = 0; seed < 50; seed++) {
      const base = makeDefaultSettings();
      const out = randomizeSettings(base, "image", mulberry32(seed + 1));
      expect(out.image.preset).toBe(base.image.preset);
    }
  });

  it("randomizes shape.polyhedron to one of [4,6,8,12] when mode=cube (Issue #40)", () => {
    const base = makeDefaultSettings();
    let rngCalls = 0;
    const rng = () => {
      rngCalls++;
      return ((rngCalls * 0.137) % 1.0);
    };
    const out = randomizeSettings(base, "cube", rng);
    expect([4, 6, 8, 12]).toContain(out.shape.polyhedron);
    expect(typeof out.shape.polyhedron).toBe("number");
  });

  it("does not change shape.polyhedron when mode=bones (Issue #40)", () => {
    const base = makeDefaultSettings();
    base.shape.polyhedron = 8;
    const out = randomizeSettings(base, "bones", () => 0.99);
    expect(out.shape.polyhedron).toBe(8);
  });
});

describe("DEFAULT_SAFE_EXCLUDED (Issue #46)", () => {
  it("camera.autoRotateSpeed と blur.* 全 4 path を含む", () => {
    expect(DEFAULT_SAFE_EXCLUDED).toContain("camera.autoRotateSpeed");
    expect(DEFAULT_SAFE_EXCLUDED).toContain("blur.enabled");
    expect(DEFAULT_SAFE_EXCLUDED).toContain("blur.strength");
    expect(DEFAULT_SAFE_EXCLUDED).toContain("blur.iterations");
    expect(DEFAULT_SAFE_EXCLUDED).toContain("blur.bassDrive");
  });

  it("デフォルト除外は全て descriptor として存在する path", () => {
    const known = new Set(RANDOMIZE_DESCRIPTORS.map((d) => d.spec.path));
    for (const p of DEFAULT_SAFE_EXCLUDED) {
      expect(known.has(p)).toBe(true);
    }
  });
});

describe("randomizeSettings: excludedPaths option (Issue #46)", () => {
  it("空集合 excludedPaths は省略時と等価 (camera/blur 含めて変化しうる)", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    const a = randomizeSettings(base, "bones", mulberry32(123));
    const b = randomizeSettings(base, "bones", mulberry32(123), new Set());
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it("excludedPaths に含まれる path は base の値のまま変わらない", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    base.camera.autoRotateSpeed = 3.7;
    base.blur.enabled = true;
    base.blur.strength = 17.5;
    base.blur.iterations = 4;
    base.blur.bassDrive = 1.25;
    const excluded = new Set([
      "camera.autoRotateSpeed",
      "blur.enabled",
      "blur.strength",
      "blur.iterations",
      "blur.bassDrive",
    ]);
    // 多 seed で当該 path が一度も書き換えられないこと
    for (let seed = 0; seed < 30; seed++) {
      const out = randomizeSettings(base, "bones", mulberry32(seed + 1), excluded);
      expect(out.camera.autoRotateSpeed).toBe(3.7);
      expect(out.blur.enabled).toBe(true);
      expect(out.blur.strength).toBe(17.5);
      expect(out.blur.iterations).toBe(4);
      expect(out.blur.bassDrive).toBe(1.25);
    }
  });

  it("除外していない path は乱数化される (少なくとも 1 seed で値が変わる)", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    const excluded = new Set(["camera.autoRotateSpeed"]);
    let changed = false;
    for (let seed = 0; seed < 20; seed++) {
      const out = randomizeSettings(base, "bones", mulberry32(seed + 1), excluded);
      if (out.color.hueBase !== base.color.hueBase) changed = true;
    }
    expect(changed).toBe(true);
  });

  it("全 descriptor を除外したら base からの変化はなくなる (mode 非該当 path は元から不変)", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    const allPaths = new Set(RANDOMIZE_DESCRIPTORS.map((d) => d.spec.path));
    const out = randomizeSettings(base, "bones", mulberry32(7), allPaths);
    expect(JSON.stringify(out)).toBe(JSON.stringify(base));
  });
});

describe("safeRandomizeSettings (Issue #46)", () => {
  it("randomizeSettings に excludedPaths を渡したのと同じ結果になる", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    const excluded = new Set(DEFAULT_SAFE_EXCLUDED);
    const viaSafe = safeRandomizeSettings(base, "bones", excluded, mulberry32(42));
    const viaRandom = randomizeSettings(base, "bones", mulberry32(42), excluded);
    expect(JSON.stringify(viaSafe)).toBe(JSON.stringify(viaRandom));
  });

  it("base を mutate しない", () => {
    const base = makeDefaultSettings();
    const snapshot = JSON.stringify(base);
    safeRandomizeSettings(base, "bones", new Set(DEFAULT_SAFE_EXCLUDED), mulberry32(1));
    expect(JSON.stringify(base)).toBe(snapshot);
  });

  it("DEFAULT_SAFE_EXCLUDED を渡すと camera.autoRotateSpeed と blur.* が不変", () => {
    const base = makeDefaultSettings();
    base.mode = "bones";
    base.camera.autoRotateSpeed = 5.5;
    base.blur.enabled = false;
    base.blur.strength = 12;
    base.blur.iterations = 2;
    base.blur.bassDrive = 0.8;
    const excluded = new Set(DEFAULT_SAFE_EXCLUDED);
    for (let seed = 0; seed < 10; seed++) {
      const out = safeRandomizeSettings(base, "bones", excluded, mulberry32(seed * 7 + 3));
      expect(out.camera.autoRotateSpeed).toBe(5.5);
      expect(out.blur.enabled).toBe(false);
      expect(out.blur.strength).toBe(12);
      expect(out.blur.iterations).toBe(2);
      expect(out.blur.bassDrive).toBe(0.8);
    }
  });
});
