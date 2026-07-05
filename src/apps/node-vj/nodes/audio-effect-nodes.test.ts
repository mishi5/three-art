import { expect, test, describe } from "bun:test";
import { AudioFilterNode } from "./AudioFilterNode";
import { AudioGainNode } from "./AudioGainNode";
import { AudioReverbNode } from "./AudioReverbNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext, NodeEnv, NodeTypeDef } from "../graph/node-type";
import type { AudioSignal } from "../graph/audio-signal";

// ---------------------------------------------------------------------------
// WebAudio モック（接続追従・dispose の物理 disconnect を検証するため）
// ---------------------------------------------------------------------------

class MockAudioNode {
  /** connect 済みの接続先（disconnect で外れる）。 */
  targets = new Set<object>();
  connect(n: object): void { this.targets.add(n); }
  disconnect(n?: object): void {
    if (n) this.targets.delete(n);
    else this.targets.clear();
  }
}

class MockAudioParam {
  calls: number[] = [];
  setTargetAtTime(v: number): void { this.calls.push(v); }
}

class MockGainNode extends MockAudioNode { gain = new MockAudioParam(); }
class MockBiquadFilterNode extends MockAudioNode {
  type = "lowpass";
  frequency = new MockAudioParam();
  Q = new MockAudioParam();
}
class MockAudioBuffer {
  channels: Float32Array[];
  constructor(public numberOfChannels: number, public length: number, public sampleRate: number) {
    this.channels = Array.from({ length: numberOfChannels }, () => new Float32Array(length));
  }
  copyToChannel(data: Float32Array, ch: number): void { this.channels[ch] = data; }
}
class MockConvolverNode extends MockAudioNode { buffer: MockAudioBuffer | null = null; }

class MockAudioContext {
  sampleRate = 8000;
  currentTime = 0;
  createGain(): MockGainNode { return new MockGainNode(); }
  createBiquadFilter(): MockBiquadFilterNode { return new MockBiquadFilterNode(); }
  createConvolver(): MockConvolverNode { return new MockConvolverNode(); }
  createBuffer(ch: number, len: number, sr: number): MockAudioBuffer { return new MockAudioBuffer(ch, len, sr); }
}

const mockEnv = (): NodeEnv => ({ audioContext: new MockAudioContext() as unknown as AudioContext }) as NodeEnv;

const audioIn = (node: MockAudioNode): AudioSignal => ({ node: node as unknown as AudioNode });

const makeCtx = (
  def: NodeTypeDef,
  state: unknown,
  inputs: Record<string, unknown> = {},
  params: Record<string, unknown> = {},
): EvalContext => ({
  timeSec: 0,
  input: (id) => inputs[id],
  param: (id) => params[id],
  node: { id: "x", type: def.type, params: {} },
  state,
});

const outputNode = (def: NodeTypeDef, ctx: EvalContext): unknown =>
  (def.evaluate(ctx)["audio"] as AudioSignal | undefined)?.node;

// ---------------------------------------------------------------------------
// 定義（ポート・param・レジストリ・headless）
// ---------------------------------------------------------------------------

describe("音声エフェクトノード定義 (#239)", () => {
  const cases: Array<[NodeTypeDef, string[]]> = [
    [AudioFilterNode, ["enabled", "type", "frequency", "Q"]],
    [AudioGainNode, ["enabled", "gain"]],
    [AudioReverbNode, ["enabled", "decay", "mix"]],
  ];

  for (const [def, ids] of cases) {
    test(`${def.type}: process・audio in → audio out`, () => {
      expect(def.category).toBe("process");
      expect(def.isSink).toBe(false);
      expect(def.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["audio:audio"]);
      expect(def.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["audio:audio"]);
    });

    test(`${def.type}: params 構成`, () => {
      expect(def.params.map((p) => p.id)).toEqual(ids);
    });

    test(`${def.type}: state 無しは audio=undefined（headless）`, () => {
      expect(def.evaluate(makeCtx(def, undefined))).toEqual({ audio: undefined });
    });

    test(`${def.type}: レジストリ（process）に登録済み`, () => {
      expect(createDefaultRegistry().get(def.type)).toBe(def);
    });
  }

  test("AudioFilter: type は enum（lowpass/highpass/bandpass・既定 lowpass）", () => {
    const t = AudioFilterNode.params.find((p) => p.id === "type");
    expect(t?.kind).toBe("enum");
    expect(t?.default).toBe("lowpass");
    expect(t?.options).toEqual(["lowpass", "highpass", "bandpass"]);
  });

  test("AudioFilter: frequency 20..20000 既定 1000 / Q 0.1..20 既定 1（number 駆動可）", () => {
    const f = AudioFilterNode.params.find((p) => p.id === "frequency");
    expect([f?.kind, f?.default, f?.min, f?.max]).toEqual(["number", 1000, 20, 20000]);
    const q = AudioFilterNode.params.find((p) => p.id === "Q");
    expect([q?.kind, q?.default, q?.min, q?.max]).toEqual(["number", 1, 0.1, 20]);
    expect(f?.noInput).toBeUndefined();
    expect(q?.noInput).toBeUndefined();
  });

  test("AudioGain: gain 0..2 既定 1（number 駆動可）", () => {
    const g = AudioGainNode.params.find((p) => p.id === "gain");
    expect([g?.kind, g?.default, g?.min, g?.max]).toEqual(["number", 1, 0, 2]);
    expect(g?.noInput).toBeUndefined();
  });

  test("AudioReverb: decay 0.1..8 既定 2 / mix 0..1 既定 0.3（number 駆動可）", () => {
    const d = AudioReverbNode.params.find((p) => p.id === "decay");
    expect([d?.kind, d?.default, d?.min, d?.max]).toEqual(["number", 2, 0.1, 8]);
    const m = AudioReverbNode.params.find((p) => p.id === "mix");
    expect([m?.kind, m?.default, m?.min, m?.max]).toEqual(["number", 0.3, 0, 1]);
  });
});

// ---------------------------------------------------------------------------
// 接続追従（論理切断＝物理 disconnect・#198 の教訓）
// ---------------------------------------------------------------------------

/** 入力の繋ぎ替え/切断/dispose が物理 disconnect と対称であることを共通検証する。 */
function checkConnectionFollow(def: NodeTypeDef, entryOf: (state: unknown) => MockAudioNode): void {
  const env = mockEnv();
  const st = def.createState!(env);
  const entry = entryOf(st);
  const a = new MockAudioNode();
  const b = new MockAudioNode();

  // 接続: 入力 a → エフェクト入口
  def.evaluate(makeCtx(def, st, { audio: audioIn(a) }));
  expect(a.targets.has(entry)).toBe(true);

  // 繋ぎ替え: a を物理 disconnect してから b を接続
  def.evaluate(makeCtx(def, st, { audio: audioIn(b) }));
  expect(a.targets.has(entry)).toBe(false);
  expect(b.targets.has(entry)).toBe(true);

  // 切断: 入力なしで b も物理 disconnect
  def.evaluate(makeCtx(def, st, {}));
  expect(b.targets.size).toBe(0);

  // dispose: 接続中でも入力・入口とも物理 disconnect
  def.evaluate(makeCtx(def, st, { audio: audioIn(a) }));
  def.disposeState!(st, env);
  expect(a.targets.size).toBe(0);
  expect(entry.targets.size).toBe(0);
}

describe("接続追従・dispose (#239)", () => {
  test("AudioFilter: 入力の connect/disconnect が対称", () => {
    checkConnectionFollow(AudioFilterNode, (st) => (st as { filter: MockAudioNode }).filter);
  });
  test("AudioGain: 入力の connect/disconnect が対称", () => {
    checkConnectionFollow(AudioGainNode, (st) => (st as { gain: MockAudioNode }).gain);
  });
  test("AudioReverb: 入力の connect/disconnect が対称", () => {
    checkConnectionFollow(AudioReverbNode, (st) => (st as { inGain: MockAudioNode }).inGain);
  });

  test("AudioReverb: dispose で内部ノードも全て disconnect", () => {
    const env = mockEnv();
    const st = AudioReverbNode.createState!(env) as {
      inGain: MockAudioNode; convolver: MockAudioNode; dryGain: MockAudioNode; wetGain: MockAudioNode; outGain: MockAudioNode;
    };
    AudioReverbNode.disposeState!(st, env);
    for (const n of [st.inGain, st.convolver, st.dryGain, st.wetGain, st.outGain]) {
      expect(n.targets.size).toBe(0);
    }
  });
});

// ---------------------------------------------------------------------------
// 各ノードの評価（param 適用・出力ノード・IR 再生成）
// ---------------------------------------------------------------------------

describe("AudioFilter 評価 (#239)", () => {
  test("出力は filter 本体・type/frequency/Q を適用（値はクランプ）", () => {
    const st = AudioFilterNode.createState!(mockEnv()) as { filter: MockBiquadFilterNode };
    const out = outputNode(AudioFilterNode, makeCtx(AudioFilterNode, st, {}, { type: "highpass", frequency: 99999, Q: 2 }));
    expect(out).toBe(st.filter);
    expect(st.filter.type).toBe("highpass");
    expect(st.filter.frequency.calls).toEqual([20000]);
    expect(st.filter.Q.calls).toEqual([2]);
  });

  test("不正な type は lowpass にフォールバック", () => {
    const st = AudioFilterNode.createState!(mockEnv()) as { filter: MockBiquadFilterNode };
    AudioFilterNode.evaluate(makeCtx(AudioFilterNode, st, {}, { type: "notch", frequency: 1000, Q: 1 }));
    expect(st.filter.type).toBe("lowpass");
  });

  test("同じ値では setTargetAtTime を積まない・変化時のみ再適用", () => {
    const st = AudioFilterNode.createState!(mockEnv()) as { filter: MockBiquadFilterNode };
    const params = { type: "lowpass", frequency: 500, Q: 1 };
    AudioFilterNode.evaluate(makeCtx(AudioFilterNode, st, {}, params));
    AudioFilterNode.evaluate(makeCtx(AudioFilterNode, st, {}, params));
    expect(st.filter.frequency.calls).toEqual([500]);
    AudioFilterNode.evaluate(makeCtx(AudioFilterNode, st, {}, { ...params, frequency: 800 }));
    expect(st.filter.frequency.calls).toEqual([500, 800]);
  });
});

describe("AudioGain 評価 (#239)", () => {
  test("出力は gain 本体・gain 値を適用（クランプ・平滑化）", () => {
    const st = AudioGainNode.createState!(mockEnv()) as { gain: MockGainNode };
    const out = outputNode(AudioGainNode, makeCtx(AudioGainNode, st, {}, { gain: 0.5 }));
    expect(out).toBe(st.gain);
    expect(st.gain.gain.calls).toEqual([0.5]);
    AudioGainNode.evaluate(makeCtx(AudioGainNode, st, {}, { gain: 0.5 }));
    expect(st.gain.gain.calls).toEqual([0.5]);
    AudioGainNode.evaluate(makeCtx(AudioGainNode, st, {}, { gain: 5 }));
    expect(st.gain.gain.calls).toEqual([0.5, 2]);
  });
});

describe("AudioReverb 評価 (#239)", () => {
  test("内部配線: in → dry/convolver → wet → out・出力は outGain", () => {
    const st = AudioReverbNode.createState!(mockEnv()) as {
      inGain: MockGainNode; convolver: MockConvolverNode; dryGain: MockGainNode; wetGain: MockGainNode; outGain: MockGainNode;
    };
    expect(st.inGain.targets.has(st.dryGain)).toBe(true);
    expect(st.inGain.targets.has(st.convolver)).toBe(true);
    expect(st.convolver.targets.has(st.wetGain)).toBe(true);
    expect(st.dryGain.targets.has(st.outGain)).toBe(true);
    expect(st.wetGain.targets.has(st.outGain)).toBe(true);
    expect(outputNode(AudioReverbNode, makeCtx(AudioReverbNode, st, {}, { decay: 2, mix: 0.3 }))).toBe(st.outGain);
  });

  test("mix から dry/wet ゲインを適用（線形クロスフェード・平滑化）", () => {
    const st = AudioReverbNode.createState!(mockEnv()) as { dryGain: MockGainNode; wetGain: MockGainNode };
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 2, mix: 0.25 }));
    expect(st.dryGain.gain.calls).toEqual([0.75]);
    expect(st.wetGain.gain.calls).toEqual([0.25]);
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 2, mix: 0.25 }));
    expect(st.dryGain.gain.calls.length).toBe(1);
  });

  test("初回評価で IR を生成（長さ = sampleRate × decay・2ch）", () => {
    const st = AudioReverbNode.createState!(mockEnv()) as { convolver: MockConvolverNode };
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 2, mix: 0.3 }));
    expect(st.convolver.buffer).not.toBeNull();
    expect(st.convolver.buffer!.length).toBe(8000 * 2);
    expect(st.convolver.buffer!.numberOfChannels).toBe(2);
  });

  test("decay 変更で IR を再生成・微小変化（<0.01s）では再生成しない", () => {
    const st = AudioReverbNode.createState!(mockEnv()) as { convolver: MockConvolverNode };
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 2, mix: 0.3 }));
    const first = st.convolver.buffer;
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 2.005, mix: 0.3 }));
    expect(st.convolver.buffer).toBe(first);
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { decay: 4, mix: 0.3 }));
    expect(st.convolver.buffer).not.toBe(first);
    expect(st.convolver.buffer!.length).toBe(8000 * 4);
  });

  test("decay 非数は既定 2 秒で生成", () => {
    const st = AudioReverbNode.createState!(mockEnv()) as { convolver: MockConvolverNode };
    AudioReverbNode.evaluate(makeCtx(AudioReverbNode, st, {}, { mix: 0.3 }));
    expect(st.convolver.buffer!.length).toBe(8000 * 2);
  });
});

// ---------------------------------------------------------------------------
// enabled トグル（off でパススルー・エフェクトから物理切断）
// ---------------------------------------------------------------------------

describe("enabled トグル (#239)", () => {
  const cases: Array<[NodeTypeDef, (state: unknown) => MockAudioNode]> = [
    [AudioFilterNode, (st) => (st as { filter: MockAudioNode }).filter],
    [AudioGainNode, (st) => (st as { gain: MockAudioNode }).gain],
    [AudioReverbNode, (st) => (st as { inGain: MockAudioNode }).inGain],
  ];

  for (const [def, entryOf] of cases) {
    test(`${def.type}: enabled は enum on/off（既定 on・先頭 param）`, () => {
      const e = def.params[0];
      expect([e?.id, e?.kind, e?.default]).toEqual(["enabled", "enum", "on"]);
      expect(e?.options).toEqual(["on", "off"]);
    });

    test(`${def.type}: off で入力をそのまま出力し、エフェクトから物理切断する`, () => {
      const st = def.createState!(mockEnv());
      const entry = entryOf(st);
      const a = new MockAudioNode();
      // on: エフェクト経由の出力・入口へ接続されている
      const onOut = outputNode(def, makeCtx(def, st, { audio: audioIn(a) }, { enabled: "on" }));
      expect(a.targets.has(entry)).toBe(true);
      expect(onOut).not.toBe(a);
      // off: 入力そのものを出力（パススルー）・入口から物理切断
      const offOut = outputNode(def, makeCtx(def, st, { audio: audioIn(a) }, { enabled: "off" }));
      expect(offOut).toBe(a as unknown as AudioNode);
      expect(a.targets.has(entry)).toBe(false);
      // on に戻すと再接続され、エフェクト経由に復帰する
      const backOut = outputNode(def, makeCtx(def, st, { audio: audioIn(a) }, { enabled: "on" }));
      expect(a.targets.has(entry)).toBe(true);
      expect(backOut).not.toBe(a);
    });

    test(`${def.type}: off かつ入力なしは audio=undefined`, () => {
      const st = def.createState!(mockEnv());
      expect(outputNode(def, makeCtx(def, st, {}, { enabled: "off" }))).toBeUndefined();
    });
  }
});
