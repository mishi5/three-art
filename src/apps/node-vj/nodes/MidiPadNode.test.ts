import { expect, test, describe } from "bun:test";
import { MidiPadNode, shortPadLabel, PAD_COUNT, PAD_ROWS, PAD_COLS } from "./MidiPadNode";

describe("#205 MidiPadNode 定義", () => {
  test("4×4 のパッドグリッド・input カテゴリ", () => {
    expect(MidiPadNode.type).toBe("MidiPad");
    expect(MidiPadNode.category).toBe("input");
    expect(MidiPadNode.padGrid).toEqual({ rows: PAD_ROWS, cols: PAD_COLS });
    expect(PAD_COUNT).toBe(16);
  });

  test("audio 出力ポートを 1 つ持つ", () => {
    expect(MidiPadNode.outputs.map((o) => o.id)).toEqual(["audio"]);
    expect(MidiPadNode.outputs[0]!.type).toBe("audio");
    expect(MidiPadNode.inputs).toEqual([]);
  });

  test("volume param（0..1 既定1）と hidden の padAssets を持つ", () => {
    const vol = MidiPadNode.params.find((p) => p.id === "volume")!;
    expect(vol.kind).toBe("number");
    expect(vol.default).toBe(1);
    expect(vol.min).toBe(0);
    expect(vol.max).toBe(1);
    const pad = MidiPadNode.params.find((p) => p.id === "padAssets")!;
    expect(pad.hidden).toBe(true);
    expect(pad.noInput).toBe(true);
    expect(pad.default).toEqual([]);
  });
});

describe("#205 shortPadLabel", () => {
  test("拡張子を落とす", () => {
    expect(shortPadLabel("kick.wav")).toBe("kick");
    expect(shortPadLabel("snare.01.mp3")).toBe("snare.01");
  });

  test("拡張子なし/ドット先頭はそのまま", () => {
    expect(shortPadLabel("loop")).toBe("loop");
    expect(shortPadLabel(".env")).toBe(".env");
  });

  test("空/null/undefined は null", () => {
    expect(shortPadLabel("")).toBeNull();
    expect(shortPadLabel(null)).toBeNull();
    expect(shortPadLabel(undefined)).toBeNull();
  });
});
