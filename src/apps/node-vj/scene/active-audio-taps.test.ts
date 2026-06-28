import { expect, test, describe } from "bun:test";
import { resetActiveAudioTaps } from "./active-audio-taps";

function fakeNode(): AudioNode & { disconnectedFrom: AudioNode[] } {
  const calls: AudioNode[] = [];
  return {
    disconnectedFrom: calls,
    disconnect: (dest?: AudioNode) => { if (dest) calls.push(dest); },
  } as unknown as AudioNode & { disconnectedFrom: AudioNode[] };
}

describe("resetActiveAudioTaps (#198 アクティブ音声タップの累積防止)", () => {
  test("merge へ繋いだ全ノードを merge から物理 disconnect し、Set を空にする", () => {
    const merge = { _id: "merge" } as unknown as AudioNode;
    const a = fakeNode();
    const b = fakeNode();
    const connected = new Set<AudioNode>([a, b]);

    resetActiveAudioTaps(connected, merge);

    expect(a.disconnectedFrom).toContain(merge); // a → merge を切断
    expect(b.disconnectedFrom).toContain(merge); // b → merge を切断
    expect(connected.size).toBe(0);              // 帳簿も空に
  });

  test("merge が null でも Set を空にする（例外を投げない）", () => {
    const connected = new Set<AudioNode>([fakeNode()]);
    expect(() => resetActiveAudioTaps(connected, null)).not.toThrow();
    expect(connected.size).toBe(0);
  });

  test("disconnect が例外を投げても他ノードの切断と clear を続行する", () => {
    const merge = { _id: "merge" } as unknown as AudioNode;
    const bad = { disconnect: () => { throw new Error("already disconnected"); } } as unknown as AudioNode;
    const good = fakeNode();
    const connected = new Set<AudioNode>([bad, good]);

    expect(() => resetActiveAudioTaps(connected, merge)).not.toThrow();
    expect(good.disconnectedFrom).toContain(merge);
    expect(connected.size).toBe(0);
  });
});
