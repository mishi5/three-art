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

describe("AudioOutputNode monitorBus (#198 モニター出力分離)", () => {
  test("env.monitorBus 指定時、active は gain を monitorBus へ接続し destination には繋がない", () => {
    const f = fakeCtx();
    const monitorBus = { _id: "monbus" } as unknown as AudioNode;
    AudioOutputNode.createState!({ audioContext: f.ctx, monitorBus } as never);
    expect(f.connfalls).toContain(monitorBus);
    expect(f.connfalls).not.toContain(f.destination);
  });

  test("env.monitorBus 未指定時は従来どおり destination へ接続（後方互換）", () => {
    const f = fakeCtx();
    AudioOutputNode.createState!({ audioContext: f.ctx } as never);
    expect(f.connfalls).toContain(f.destination);
  });

  test("referencedScene では monitorBus にも destination にも繋がない", () => {
    const f = fakeCtx();
    const monitorBus = { _id: "monbus" } as unknown as AudioNode;
    AudioOutputNode.createState!({ audioContext: f.ctx, monitorBus, referencedScene: true } as never);
    expect(f.connfalls).not.toContain(monitorBus);
    expect(f.connfalls).not.toContain(f.destination);
  });

  test("evaluate の整合: referenced で生成後 active 文脈で評価すると monitorBus へ再接続する", () => {
    const f = fakeCtx();
    const monitorBus = { _id: "monbus" } as unknown as AudioNode;
    const st = AudioOutputNode.createState!({ audioContext: f.ctx, monitorBus, referencedScene: true } as never);
    f.connfalls.length = 0;
    AudioOutputNode.evaluate({
      timeSec: 0, input: () => undefined, param: (id) => (id === "mute" ? "off" : 1),
      node: { id: "n", type: "AudioOutput", params: {} }, state: st,
      env: { monitorBus, captureSceneAudio: () => {} } as never,
    });
    expect(f.connfalls).toContain(monitorBus);
    expect(f.connfalls).not.toContain(f.destination);
  });
});
