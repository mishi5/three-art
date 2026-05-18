import { describe, expect, test } from "bun:test";
import { makeDefaultSettings } from "../settings";
import { PARAM_DOCS, settingsLeafPaths, resolveDocKey } from "./param-docs";

describe("param-docs", () => {
  test("settingsLeafPaths enumerates every scalar leaf as a dot path", () => {
    const paths = settingsLeafPaths(makeDefaultSettings());
    expect(paths).toContain("mode");
    expect(paths).toContain("audioSmoothing");
    expect(paths).toContain("pointCloud.bassExpansion");
    expect(paths).toContain("image.particleShape");
    expect(paths).toContain("auto.styleStrength");
    // No branch (object) node should leak in.
    expect(paths).not.toContain("pointCloud");
    expect(paths).not.toContain("image");
  });

  test("every GUI parameter (settings leaf) has a ParamDoc entry", () => {
    const paths = settingsLeafPaths(makeDefaultSettings());
    const missing = paths.filter((p) => !(p in PARAM_DOCS));
    expect(missing).toEqual([]);
  });

  test("every ParamDoc has a non-empty summary and effect", () => {
    for (const [key, doc] of Object.entries(PARAM_DOCS)) {
      expect(doc.summary.trim().length, `${key}.summary`).toBeGreaterThan(0);
      expect(doc.effect.trim().length, `${key}.effect`).toBeGreaterThan(0);
    }
  });

  test("PARAM_DOCS has no keys that are not real settings leaves", () => {
    const paths = new Set(settingsLeafPaths(makeDefaultSettings()));
    const extra = Object.keys(PARAM_DOCS).filter((k) => !paths.has(k));
    expect(extra).toEqual([]);
  });

  test("resolveDocKey maps a top-level scalar controller to its property", () => {
    const s = makeDefaultSettings();
    expect(resolveDocKey(s, s, "mode")).toBe("mode");
    expect(resolveDocKey(s, s, "audioSmoothing")).toBe("audioSmoothing");
  });

  test("resolveDocKey maps a nested-group controller to <group>.<prop>", () => {
    const s = makeDefaultSettings();
    expect(resolveDocKey(s, s.pointCloud, "bassExpansion")).toBe(
      "pointCloud.bassExpansion",
    );
    expect(resolveDocKey(s, s.image, "particleShape")).toBe(
      "image.particleShape",
    );
  });

  test("resolveDocKey returns null for objects not part of settings", () => {
    const s = makeDefaultSettings();
    const actionTarget = { reset: () => {} };
    expect(resolveDocKey(s, actionTarget, "reset")).toBeNull();
  });
});
