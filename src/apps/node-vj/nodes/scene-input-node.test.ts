import { expect, test, describe } from "bun:test";
import { SceneInputNode, SceneInputRuntime } from "./SceneInputNode";
import { VideoFileInputNode } from "./VideoFileInputNode";
import { DEFAULT_AUDIO_FEATURES } from "../../../core/types";
import type { EvalContext, NodeState } from "../graph/node-type";

function ctx(sceneId: string, tex: unknown): EvalContext {
  return {
    timeSec: 0,
    input: () => undefined,
    param: (id) => (id === "sceneId" ? sceneId : undefined),
    node: { id: "n", type: "SceneInput", params: { sceneId } },
    env: {
      audio: {} as never, renderer: {} as never, camera: {} as never, audioContext: {} as never,
      sceneTexture: (id) => (id === sceneId ? tex : null),
    },
  };
}

/** connect/disconnect を記録するフェイク AudioNode。 */
function fakeAudioNode(id: string): AudioNode & { connectedTo: AudioNode[]; disconnectedFrom: AudioNode[] } {
  const connectedTo: AudioNode[] = [];
  const disconnectedFrom: AudioNode[] = [];
  return {
    _id: id,
    connectedTo,
    disconnectedFrom,
    connect: (dest: AudioNode) => { connectedTo.push(dest); },
    disconnect: (dest?: AudioNode) => { if (dest) disconnectedFrom.push(dest); },
  } as unknown as AudioNode & { connectedTo: AudioNode[]; disconnectedFrom: AudioNode[] };
}

/** AudioAnalyzer / keep-alive gain を賄うフェイク AudioContext。 */
function fakeAudioCtx() {
  let fillValue = 0;
  const analyserConnects: AudioNode[] = [];
  const analyser = {
    fftSize: 2048,
    smoothingTimeConstant: 0,
    frequencyBinCount: 1024,
    getByteFrequencyData: (bins: Uint8Array) => { bins.fill(fillValue); },
    connect: (dest: AudioNode) => { analyserConnects.push(dest); },
    disconnect: () => {},
  } as unknown as AnalyserNode;
  const gains: Array<GainNode & { connectedTo: AudioNode[] }> = [];
  const destination = { _id: "dest" } as unknown as AudioNode;
  const audioCtx = {
    destination,
    sampleRate: 48000,
    createAnalyser: () => analyser,
    createGain: () => {
      const connectedTo: AudioNode[] = [];
      const g = {
        gain: { value: 1 },
        connectedTo,
        connect: (dest: AudioNode) => { connectedTo.push(dest); },
        disconnect: () => {},
      } as unknown as GainNode & { connectedTo: AudioNode[] };
      gains.push(g);
      return g;
    },
  } as unknown as AudioContext;
  return {
    audioCtx, analyser, gains, destination, analyserConnects,
    setBins: (v: number) => { fillValue = v; },
  };
}

/** state 付き evaluate 用の EvalContext（env.sceneAudio / sceneTexture 差し替え可）。 */
function evalCtx(over: {
  sceneId?: string;
  state?: NodeState;
  timeSec?: number;
  sceneAudio?: (id: string) => AudioNode | null;
  sceneTexture?: (id: string) => unknown;
}): EvalContext {
  const sceneId = over.sceneId ?? "B";
  return {
    timeSec: over.timeSec ?? 0,
    input: () => undefined,
    param: (id: string) => (id === "sceneId" ? sceneId : undefined),
    node: { id: "n", type: "SceneInput", params: { sceneId } },
    state: over.state,
    env: {
      sceneTexture: over.sceneTexture ?? (() => null),
      sceneAudio: over.sceneAudio ?? (() => null),
    } as never,
  };
}

describe("SceneInputNode", () => {
  test("#240 出力ポートは VideoFileInput と同構成（texture + 特徴量 + audio）", () => {
    expect(SceneInputNode.type).toBe("SceneInput");
    expect(SceneInputNode.sceneInput).toBe(true);
    expect(SceneInputNode.outputs.map((p) => p.id)).toEqual([
      "texture", "signal", "volume", "bass", "mid", "treble", "trigger", "audio",
    ]);
    // VideoFileInput の出力集合と一致（順序も texture 先頭・audio 末尾で同じ）
    expect(SceneInputNode.outputs.map((p) => p.id)).toEqual(VideoFileInputNode.outputs.map((p) => p.id));
  });

  test("params: sceneId(hidden) + onset 調整（#109 と同型）", () => {
    expect(SceneInputNode.params.find((p) => p.id === "sceneId")?.hidden).toBe(true);
    expect(SceneInputNode.params.map((p) => p.id)).toEqual(["sceneId", "onsetThreshold", "onsetCooldown"]);
  });

  test("evaluate は env.sceneTexture(sceneId) を texture に返す", () => {
    const fake = {};
    expect(SceneInputNode.evaluate(ctx("B", fake)).texture).toBe(fake);
    expect(SceneInputNode.evaluate(ctx("", fake)).texture).toBeUndefined();
  });

  test("#172 evaluate は env.sceneAudio を audio(AudioSignal) で返す", () => {
    const fakeNode = {} as AudioNode;
    const out = SceneInputNode.evaluate(evalCtx({ sceneAudio: (id) => (id === "B" ? fakeNode : null) }));
    expect((out.audio as { node: AudioNode }).node).toBe(fakeNode);
  });

  test("#240 state 無しの evaluate は特徴量を安全デフォルトで返す（既存互換）", () => {
    const out = SceneInputNode.evaluate(ctx("B", {}));
    expect(out.signal).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.volume).toBe(0);
    expect(out.trigger).toBe(false);
  });

  test("#240 sceneId 空でも特徴量は安全デフォルト・audio undefined", () => {
    const out = SceneInputNode.evaluate(ctx("", {}));
    expect(out.signal).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.audio).toBeUndefined();
  });
});

describe("SceneInputRuntime (#240 集約音声のタップと解析)", () => {
  test("createState は SceneInputRuntime を返し keep-alive（gain 0 → destination）を張る", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    expect(st).toBeInstanceOf(SceneInputRuntime);
    // analyser → keep(gain 0) → destination（#128 パターン。発音しない）
    const keep = f.gains.find((g) => g.gain.value === 0);
    expect(keep).toBeDefined();
    expect(f.analyserConnects).toContain(keep as unknown as AudioNode);
    expect(keep!.connectedTo).toContain(f.destination);
  });

  test("evaluate は sceneAudio の merge を analyser へタップする（毎フレーム再接続しない）", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const merge = fakeAudioNode("mergeB");
    const c = evalCtx({ state: st, sceneAudio: () => merge });

    SceneInputNode.evaluate(c);
    SceneInputNode.evaluate(c);

    expect(merge.connectedTo).toEqual([f.analyser as unknown as AudioNode]);
  });

  test("merge の同一性が変わったら旧を disconnect して新へ繋ぎ替える（再生成・シーン切替追従）", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const mergeA = fakeAudioNode("mergeA");
    const mergeB = fakeAudioNode("mergeB");

    SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => mergeA }));
    SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => mergeB }));

    expect(mergeA.disconnectedFrom).toEqual([f.analyser as unknown as AudioNode]);
    expect(mergeB.connectedTo).toEqual([f.analyser as unknown as AudioNode]);
  });

  test("sceneId が空になったフレームでタップを物理 disconnect する", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const merge = fakeAudioNode("merge");

    SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => merge }));
    SceneInputNode.evaluate(evalCtx({ state: st, sceneId: "", sceneAudio: () => merge }));

    expect(merge.disconnectedFrom).toEqual([f.analyser as unknown as AudioNode]);
  });

  test("タップ中は解析結果（volume/bass/mid/treble/signal）を出力する", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const merge = fakeAudioNode("merge");
    f.setBins(255); // 全帯域最大 → 各バンド 1.0

    const out = SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => merge }));

    expect(out.volume).toBeCloseTo(1);
    expect(out.bass).toBeCloseTo(1);
    expect(out.mid).toBeCloseTo(1);
    expect(out.treble).toBeCloseTo(1);
    expect((out.signal as { volume: number }).volume).toBeCloseTo(1);
  });

  test("タップが無い（sceneAudio null）間はデフォルト特徴量を返す", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    f.setBins(255); // analyser にデータがあってもタップ無しなら読まない

    const out = SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => null }));

    expect(out.signal).toBe(DEFAULT_AUDIO_FEATURES);
    expect(out.volume).toBe(0);
    expect(out.trigger).toBe(false);
  });

  test("bass の立ち上がりで trigger（onset）が発火する", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const merge = fakeAudioNode("merge");
    const at = (t: number) => evalCtx({ state: st, timeSec: t, sceneAudio: () => merge });

    f.setBins(0);
    expect(SceneInputNode.evaluate(at(0)).trigger).toBe(false);  // prime
    f.setBins(255);
    expect(SceneInputNode.evaluate(at(0.5)).trigger).toBe(true); // 立ち上がり
    expect(SceneInputNode.evaluate(at(0.6)).trigger).toBe(false); // 保持中は再発火しない
  });

  test("disposeState はタップを物理 disconnect する（#198 不変条件）", () => {
    const f = fakeAudioCtx();
    const st = SceneInputNode.createState!({ audioContext: f.audioCtx } as never);
    const merge = fakeAudioNode("merge");

    SceneInputNode.evaluate(evalCtx({ state: st, sceneAudio: () => merge }));
    SceneInputNode.disposeState!(st, {} as never);

    expect(merge.disconnectedFrom).toEqual([f.analyser as unknown as AudioNode]);
  });
});
