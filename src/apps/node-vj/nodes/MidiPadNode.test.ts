import { expect, test, describe } from "bun:test";
import { MidiPadNode, MidiPadRuntime, shortPadLabel, PAD_COUNT, PAD_ROWS, PAD_COLS } from "./MidiPadNode";

/** #205: bun には AudioContext が無いため、最小限のフェイクで Runtime を検証する。 */
function fakeAudioContext(): AudioContext {
  return {
    createGain: () => ({ gain: { value: 1 }, connect() {}, disconnect() {} }),
    createBufferSource: () => ({ buffer: null, onended: null, connect() {}, disconnect() {}, start() {}, stop() {} }),
  } as unknown as AudioContext;
}

describe("#205 MidiPadNode 定義", () => {
  test("4×4 のパッドグリッド・input カテゴリ", () => {
    expect(MidiPadNode.type).toBe("MidiPad");
    expect(MidiPadNode.category).toBe("input");
    expect(MidiPadNode.padGrid).toEqual({ rows: PAD_ROWS, cols: PAD_COLS });
    expect(PAD_COUNT).toBe(16);
  });

  test("audio 出力と trigger 出力を持つ", () => {
    expect(MidiPadNode.outputs.map((o) => o.id)).toEqual(["audio", "trigger"]);
    expect(MidiPadNode.outputs[0]!.type).toBe("audio");
    expect(MidiPadNode.outputs[1]!.type).toBe("trigger");
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

describe("#205 MidiPadRuntime trigger ラッチ", () => {
  test("初期は false / 押下したフレームのみ true・次フレーム false", () => {
    const rt = new MidiPadRuntime(fakeAudioContext());
    expect(rt.consumeTrigger()).toBe(false);
    // パッド 0 に buffer を割り当てた体にして発音（押下）。
    (rt as unknown as { buffers: unknown[] }).buffers[0] = {};
    rt.playPad(0);
    expect(rt.consumeTrigger()).toBe(true);  // 押下フレーム
    expect(rt.consumeTrigger()).toBe(false); // 次フレームは戻る
  });

  test("未割当パッドの playPad はラッチを立てない", () => {
    const rt = new MidiPadRuntime(fakeAudioContext());
    rt.playPad(3); // buffer 無し
    expect(rt.consumeTrigger()).toBe(false);
  });
});

describe("#205 MidiPadRuntime stopAll", () => {
  test("発音中の全ソースを止め active を空にする（mixGain は維持）", () => {
    const rt = new MidiPadRuntime(fakeAudioContext());
    (rt as unknown as { buffers: unknown[] }).buffers[0] = {};
    rt.playPad(0);
    rt.playPad(0);
    const active = (rt as unknown as { active: Set<unknown> }).active;
    expect(active.size).toBe(2);
    rt.stopAll();
    expect(active.size).toBe(0);
    // mixGain は残るので以後も発音できる。
    expect(rt.mixGain).toBeDefined();
  });
});
