import { describe, it, expect } from "bun:test";
import { nextDefaultPresetName } from "./preset-name";

describe("nextDefaultPresetName", () => {
  it("returns 'untitled #1' when no presets exist", () => {
    expect(nextDefaultPresetName([])).toBe("untitled #1");
  });

  it("returns 'untitled #N+1' where N is the max existing untitled index", () => {
    expect(nextDefaultPresetName(["untitled #1", "untitled #3"])).toBe("untitled #4");
  });

  it("ignores non-default names", () => {
    expect(nextDefaultPresetName(["Wave Cool", "Funky", "untitled #2"])).toBe("untitled #3");
  });

  it("handles malformed indices safely", () => {
    expect(nextDefaultPresetName(["untitled #abc", "untitled #"])).toBe("untitled #1");
  });
});
