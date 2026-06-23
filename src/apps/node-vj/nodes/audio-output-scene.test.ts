import { expect, test, describe } from "bun:test";
import { AudioOutputNode } from "./AudioOutputNode";

function fakeCtx() {
  const destination = { _id: "dest" } as unknown as AudioNode;
  const connfalls: AudioNode[] = [];
  const gain = {
    gain: { value: 1 },
    connect: (n: AudioNode) => { connfalls.push(n); },
    disconnect: () => {},
  } as unknown as GainNode;
  const ctx = { destination, createGain: () => gain } as unknown as AudioContext;
  return { ctx, gain, destination, connfalls };
}

describe("AudioOutputNode referencedScene (#172)", () => {
  test("通常（active）は gain を destination へ接続", () => {
    const f = fakeCtx();
    AudioOutputNode.createState!({ audioContext: f.ctx } as never);
    expect(f.connfalls).toContain(f.destination);
  });
  test("referencedScene では destination へ接続しない", () => {
    const f = fakeCtx();
    AudioOutputNode.createState!({ audioContext: f.ctx, referencedScene: true } as never);
    expect(f.connfalls).not.toContain(f.destination);
  });
  test("evaluate は captureSceneAudio(gain) を呼ぶ", () => {
    const f = fakeCtx();
    const st = AudioOutputNode.createState!({ audioContext: f.ctx, referencedScene: true } as never);
    const captured: AudioNode[] = [];
    AudioOutputNode.evaluate({
      timeSec: 0, input: () => undefined, param: (id) => (id === "mute" ? "off" : 1),
      node: { id: "n", type: "AudioOutput", params: {} }, state: st,
      env: { captureSceneAudio: (n: AudioNode) => { captured.push(n); } } as never,
    });
    expect(captured[0]).toBe(f.gain);
  });
});
