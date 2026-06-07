import { describe, expect, test } from "bun:test";
import * as YAML from "yaml";
import { makeDefaultSettings } from "../settings";
import { parsePresetYaml, serializePresetYaml } from "./preset-yaml";

describe("preset-yaml", () => {
  test("serializePresetYaml round-trips through YAML.parse", () => {
    const settings = makeDefaultSettings();
    const text = serializePresetYaml(settings);
    expect(typeof text).toBe("string");
    expect(text.length).toBeGreaterThan(0);
    expect(YAML.parse(text)).toEqual(settings);
  });

  test("serializePresetYaml output is human-readable (top-level keys unquoted)", () => {
    const text = serializePresetYaml(makeDefaultSettings());
    expect(text).toMatch(/^mode:/m);
    expect(text).toMatch(/^audioGain:/m);
  });

  test("parsePresetYaml round-trips a serialized preset back to its values", () => {
    const settings = makeDefaultSettings();
    const text = serializePresetYaml(settings);
    expect(parsePresetYaml(text)).toEqual(settings);
  });

  test("parsePresetYaml accepts a partial YAML preset and returns a Partial<Settings>", () => {
    const text = "audioGain:\n  bass: 4.2\n";
    const parsed = parsePresetYaml(text);
    expect(parsed).toEqual({ audioGain: { bass: 4.2 } } as Partial<typeof parsed>);
  });

  test("parsePresetYaml throws on broken YAML", () => {
    expect(() => parsePresetYaml("audioGain: {bass: [unterminated")).toThrow();
  });
});
