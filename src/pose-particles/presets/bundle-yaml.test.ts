import { describe, it, expect } from "bun:test";
import { serializeBundleYaml, parseBundleYaml, TRANSPARENT_THUMBNAIL } from "./bundle-yaml";
import { makeDefaultSettings } from "../settings";
import type { PresetBundle } from "./types";

function fixtureBundle(): PresetBundle {
  return {
    version: 1,
    presets: [
      {
        id: "abc",
        name: "Wave Cool",
        description: "lattice mode",
        thumbnail: "data:image/webp;base64,UklGRg==",
        settings: makeDefaultSettings(),
        createdAt: 1730000000000,
        updatedAt: 1730000000000,
      },
    ],
  };
}

describe("bundle YAML", () => {
  it("serializes and re-parses to an equivalent bundle", () => {
    const b = fixtureBundle();
    const text = serializeBundleYaml(b);
    expect(text).toContain("version: 1");
    expect(text).toContain("Wave Cool");
    const back = parseBundleYaml(text);
    expect(back).toEqual(b);
  });

  it("throws for unsupported version", () => {
    expect(() => parseBundleYaml("version: 2\npresets: []\n")).toThrow();
  });

  it("throws when input is not an object with a version", () => {
    expect(() => parseBundleYaml("[1,2,3]")).toThrow();
  });

  it("fills missing name/description/thumbnail/timestamps with safe defaults", () => {
    const text = `version: 1
presets:
  - id: "x"
    settings: ${JSON.stringify(makeDefaultSettings())}
`;
    const b = parseBundleYaml(text);
    expect(b.presets).toHaveLength(1);
    const p = b.presets[0];
    expect(p.id).toBe("x");
    expect(p.name).toBe("untitled");
    expect(p.description).toBe("");
    expect(p.thumbnail).toBe(TRANSPARENT_THUMBNAIL);
    expect(typeof p.createdAt).toBe("number");
    expect(typeof p.updatedAt).toBe("number");
  });

  it("drops entries with missing or non-object settings", () => {
    const text = `version: 1
presets:
  - id: "ok"
    name: "ok"
    settings: ${JSON.stringify(makeDefaultSettings())}
  - id: "no-settings"
    name: "no"
  - id: "bad-settings"
    name: "bad"
    settings: "string-not-object"
`;
    const b = parseBundleYaml(text);
    expect(b.presets.map((p) => p.id)).toEqual(["ok"]);
  });

  it("generates a fresh id when missing", () => {
    const text = `version: 1
presets:
  - name: "noid"
    settings: ${JSON.stringify(makeDefaultSettings())}
`;
    const b = parseBundleYaml(text);
    expect(b.presets[0].id.length).toBeGreaterThan(0);
  });
});
