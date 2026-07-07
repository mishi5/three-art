// #239: 音声リバーブ（ConvolverNode）。生成したインパルス応答（ホワイトノイズ×減衰カーブ）で
// 残響を付ける（外部 IR ファイル不要）。dry/wet は**独立ゲイン**（センド/リターン方式の上位互換）:
// dry=1 のまま wet だけ上げれば原音の音量を変えずに残響を足せる（実機確認でのユーザ要望）。
//
// 内部グラフ:
//   in(GainNode) ─┬─ dryGain ──────────┬─ out(GainNode)
//                 └─ convolver ─ wetGain ┘
//
// 入力の繋ぎ替えは in ゲイン 1 点に対して行い（AudioDelay と同じ差分接続）、
// decay 変更時のみ IR を再生成する（number 駆動の微小揺れでは再生成しない）。
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, asAudioNode, signalOutput } from "../graph/audio-signal";
import {
  REVERB_DECAY_MAX,
  REVERB_DECAY_MIN,
  REVERB_REGEN_EPSILON,
  applySmoothParam,
  buildImpulseResponse,
  readNumberParam,
} from "./audio-effect-logic";

interface AudioReverbState {
  ctx: AudioContext;
  /** 入力の接続点（上流はここへ 1 点接続）。 */
  inGain: GainNode;
  convolver: ConvolverNode;
  dryGain: GainNode;
  wetGain: GainNode;
  /** dry + wet の合流点（= audio 出力）。 */
  outGain: GainNode;
  /** inGain に接続済みの入力 AudioNode（変化時のみ繋ぎ替え）。 */
  connected: AudioNode | null;
  /** IR 生成済みの decay（秒）。REVERB_REGEN_EPSILON 以上変わったら再生成。 */
  lastDecay: number | null;
  /** setTargetAtTime を積みすぎないための前回適用値。 */
  lastDry: number | null;
  lastWet: number | null;
}

/** 音声リバーブノード（#239）。生成 IR の ConvolverNode で残響を付け、dry/wet 独立ゲインで調整する。 */
export const AudioReverbNode: NodeTypeDef = {
  type: "AudioReverb",
  category: "audio",
  description: "node.AudioReverb.desc",
  isSink: false,
  inputs: [{ id: "audio", label: "audio", type: "audio", description: "node.AudioReverb.port.audio" }],
  outputs: [SIGNAL_OUTPUT],
  params: [
    { id: "enabled", label: "enabled", kind: "enum", default: "on", options: ["on", "off"], description: "node.AudioReverb.param.enabled" },
    { id: "decay", label: "decay", kind: "number", default: 2, min: REVERB_DECAY_MIN, max: REVERB_DECAY_MAX, step: 0.1, description: "node.AudioReverb.param.decay" },
    { id: "dry", label: "dry", kind: "number", default: 1, min: 0, max: 1, step: 0.01, description: "node.AudioReverb.param.dry" },
    { id: "wet", label: "wet", kind: "number", default: 0.5, min: 0, max: 2, step: 0.01, description: "node.AudioReverb.param.wet" },
  ],
  createState(env: NodeEnv): AudioReverbState {
    const ctx = env.audioContext;
    const inGain = ctx.createGain();
    const convolver = ctx.createConvolver();
    const dryGain = ctx.createGain();
    const wetGain = ctx.createGain();
    const outGain = ctx.createGain();
    inGain.connect(dryGain);
    inGain.connect(convolver);
    convolver.connect(wetGain);
    dryGain.connect(outGain);
    wetGain.connect(outGain);
    return { ctx, inGain, convolver, dryGain, wetGain, outGain, connected: null, lastDecay: null, lastDry: null, lastWet: null };
  },
  disposeState(state: NodeState): void {
    const st = state as AudioReverbState;
    try { st.connected?.disconnect(st.inGain); } catch { /* already disconnected */ }
    for (const n of [st.inGain, st.convolver, st.dryGain, st.wetGain, st.outGain]) {
      try { n.disconnect(); } catch { /* ignore */ }
    }
  },
  evaluate(ctx) {
    const st = ctx.state as AudioReverbState | undefined;
    if (!st) return signalOutput(null);
    // 入力が変わったときだけ繋ぎ替える（論理切断＝物理 disconnect・#198）。
    // enabled=off はエフェクトへ繋がず（残響テールも止まる）、入力をそのまま出力するパススルー。
    const enabled = ctx.param("enabled") !== "off";
    const node = asAudioNode(ctx.input("audio"));
    const target = enabled ? node : null;
    if (target !== st.connected) {
      if (st.connected) { try { st.connected.disconnect(st.inGain); } catch { /* ignore */ } }
      if (target) target.connect(st.inGain);
      st.connected = target;
    }
    if (!enabled) return signalOutput(node);
    // decay が実質的に変わったときだけ IR を再生成する（AudioBuffer 生成は重いので毎フレームは不可）。
    const decay = readNumberParam(ctx.param("decay"), REVERB_DECAY_MIN, REVERB_DECAY_MAX, 2);
    if (st.lastDecay === null || Math.abs(decay - st.lastDecay) >= REVERB_REGEN_EPSILON) {
      const channels = buildImpulseResponse(st.ctx.sampleRate, decay);
      const buf = st.ctx.createBuffer(channels.length, channels[0]!.length, st.ctx.sampleRate);
      channels.forEach((data, i) => buf.copyToChannel(data, i));
      st.convolver.buffer = buf;
      st.lastDecay = decay;
    }
    // dry/wet は独立ゲイン（クロスフェードしない）。既定 dry=1 で原音の音量は不変。
    const dry = readNumberParam(ctx.param("dry"), 0, 1, 1);
    const wet = readNumberParam(ctx.param("wet"), 0, 2, 0.5);
    const now = st.ctx.currentTime;
    st.lastDry = applySmoothParam(st.dryGain.gain, st.lastDry, dry, now);
    st.lastWet = applySmoothParam(st.wetGain.gain, st.lastWet, wet, now);
    return signalOutput(st.outGain);
  },
};
