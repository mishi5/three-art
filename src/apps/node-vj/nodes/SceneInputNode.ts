import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeEnv, NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";
import {
  AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker,
  audioFeatureOutputs, readOnsetParams,
} from "./audio-feature-logic";
import { AudioNodeTap } from "./audio-tap";

/**
 * #240: SceneInput の永続状態。参照先シーンの集約音声（merge gain、#172/#198）を自前の
 * AudioAnalyzer へタップし、VideoFileInput 相当の音響特徴量（signal/各バンド/onset）を解析する。
 * タップは AudioNodeTap で差分管理する（sceneId 変更・merge 再生成・アクティブ切替 #174 に追従し、
 * 変化時は必ず物理 disconnect。#198 の不変条件）。analyser は可聴経路に繋がらないため、
 * 複数 SceneInput が同じシーンを参照しても二重発音しない。
 */
export class SceneInputRuntime {
  private readonly ctx: AudioContext;
  private readonly analyzer: AudioAnalyzer;
  private readonly tap: AudioNodeTap;
  private readonly onset = new OnsetTracker();

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
    this.tap = new AudioNodeTap(this.analyzer.input);
    // #128 と同じ keep-alive: 無音(gain 0)で destination へ繋ぎ、下流が特徴量ポートしか
    // 使わない（audio を AudioOutput へ繋がない）構成でも解析グラフを駆動し続ける。
    const keep = ctx.createGain();
    keep.gain.value = 0;
    this.analyzer.input.connect(keep);
    keep.connect(ctx.destination);
  }

  /** タップ元（参照先シーンの merge）を追従させる。null で切断。 */
  updateSource(src: AudioNode | null): void {
    this.tap.update(src);
  }

  /** 現在の音響特徴量（タップ未接続時は無音デフォルト）。 */
  readAudio(): AudioFeatures {
    if (!this.tap.current) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    if (!this.tap.current) return false;
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  dispose(): void {
    // タップの物理 disconnect（#198）。analyser 自身の出力（keep-alive）も切り離す。
    this.tap.dispose();
    try { this.analyzer.input.disconnect(); } catch { /* ignore */ }
  }
}

/**
 * #152/#172/#240: 別シーンの最終映像（texture）・音声（audio）・音響特徴量を参照・出力する入力ノード。
 * 出力構成は VideoFileInput と同じ（texture + signal/各バンド/trigger + audio）。
 */
export const SceneInputNode: NodeTypeDef = {
  type: "SceneInput",
  category: "input",
  description: "node.SceneInput.desc",
  isSink: false,
  sceneInput: true,
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "node.SceneInput.port.texture" },
    ...AUDIO_FEATURE_OUTPUTS, // #240: 参照先シーンの集約音声から解析した特徴量。
    SIGNAL_OUTPUT, // #172: 参照先シーンの音声（AudioOutput の出力）。親の AudioMix/AudioOutput へ繋ぐ。
  ],
  params: [
    { id: "sceneId", label: "scene", kind: "string", default: "", hidden: true,
      description: "node.SceneInput.param.sceneId" },
    ...ONSET_PARAMS,
  ],
  createState: (env: NodeEnv) => new SceneInputRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as SceneInputRuntime).dispose(),
  evaluate: (ctx) => {
    const sid = ctx.param("sceneId");
    const sceneId = typeof sid === "string" && sid !== "" ? sid : null;
    const texture = sceneId ? (ctx.env?.sceneTexture?.(sceneId) ?? undefined) : undefined;
    const src = sceneId ? (ctx.env?.sceneAudio?.(sceneId) ?? null) : null;
    const st = ctx.state as SceneInputRuntime | undefined;
    // タップ追従: 参照先変更・merge 再生成・参照先消滅（src=null）で繋ぎ替え/物理 disconnect。
    st?.updateSource(src);
    if (!st) return { texture, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), ...signalOutput(src) };
    const audio = st.readAudio();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = st.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown);
    return { texture, ...audioFeatureOutputs(audio, onset), ...signalOutput(src) };
  },
};
