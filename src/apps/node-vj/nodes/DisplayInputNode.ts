import * as THREE from "three";
import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeInstance } from "../graph/graph-doc";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import {
  AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker,
  audioFeatureOutputs, readOnsetParams,
} from "./audio-feature-logic";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";

/**
 * 画面共有 AV 入力の永続状態（#140）。1 回の getDisplayMedia で共有タブの音声＋映像を取得する。
 * - 映像: HTMLVideoElement → VideoTextureSurface で contain-fit texture を出力（CameraInput パターン）。
 * - 音声: AudioAnalyzer で特徴量を解析し、実音声信号(audio)も出力（destination 非接続＋無音 keep-alive）。
 *   「タブ音声を共有」OFF（audio track 無し）でも throw せず映像のみ動かす（特徴量は default）。
 * start() は user gesture から呼ぶ。
 */
export class DisplayInputRuntime {
  private ctx: AudioContext;
  private video: HTMLVideoElement;
  private surface = new VideoTextureSurface();
  private previewCanvas: HTMLCanvasElement | null = null;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private analyzer: AudioAnalyzer | null = null;
  /** #128: ルーティング用の実音声信号出力（audio track がある時のみ有効）。 */
  private output: GainNode;
  private onset = new OnsetTracker();
  private hasAudio = false;
  private starting = false;
  started = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.output = ctx.createGain();
    // #128: 無音(gain 0)の keep-alive で解析グラフを生かす（可聴出力は AudioOutput 経由）。
    const keep = ctx.createGain();
    keep.gain.value = 0;
    this.output.connect(keep);
    keep.connect(ctx.destination);
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;       // ローカル二重再生防止（発音は AudioOutput 経由）
    this.video.autoplay = true;
    this.video.style.display = "none";
    document.body.appendChild(this.video);
  }

  /** 画面共有（音声＋映像）を開始する（user gesture から）。 */
  async start(): Promise<void> {
    if (this.started || this.starting) return;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
        video: true,
      });
      this.stream = stream;
      this.video.srcObject = stream;
      await this.video.play();
      // 音声はオプショナル: track があれば解析＋信号出力、無ければ映像のみ。
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length > 0) {
        void this.ctx.resume().catch(() => { /* gesture 不足時は次回 */ });
        this.analyzer = new AudioAnalyzer(this.ctx);
        this.node = this.ctx.createMediaStreamSource(stream);
        this.node.connect(this.analyzer.input);
        this.analyzer.input.connect(this.output);
        this.hasAudio = true;
        audioTracks[0]!.addEventListener("ended", () => { this.hasAudio = false; });
      }
      stream.getVideoTracks()[0]?.addEventListener("ended", () => { this.started = false; });
      this.started = true;
    } finally {
      this.starting = false;
    }
  }

  /** 現在の音響特徴量（audio track 無し / 未開始は無音デフォルト）。 */
  read(): AudioFeatures {
    if (!this.hasAudio || !this.analyzer) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  /** #128: audio 信号出力用 AudioNode（audio track が無ければ null）。 */
  audioSignalNode(): AudioNode | null {
    return this.hasAudio ? this.output : null;
  }

  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    if (!this.hasAudio) return false;
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  /** 共有タブ映像の texture（contain-fit で正規化）。未開始は null。 */
  getTexture(renderer: THREE.WebGLRenderer): THREE.Texture | null {
    if (!this.started) return null;
    return this.surface.render(renderer, this.video);
  }

  /** プレビュー小窓のフレーム（骨格描画なし・CameraInput 同仕様）。 */
  previewFrame(): CanvasImageSource | null {
    if (!this.started || this.video.videoWidth === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(this.video.videoWidth, this.video.videoHeight, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(this.video, fit.x, fit.y, fit.w, fit.h);
    return this.previewCanvas;
  }

  dispose(): void {
    this.surface.dispose();
    this.node?.disconnect();
    this.output.disconnect();
    if (this.stream) for (const t of this.stream.getTracks()) t.stop();
    this.video.srcObject = null;
    this.video.remove();
  }
}

/**
 * 画面共有 AV 入力ノード（#140, 旧 DisplayAudioInput を AV 化）。
 * 共有タブの映像 texture と音声特徴量（signal/各バンド/onset）＋実音声 audio を出力する。
 */
export const DisplayInputNode: NodeTypeDef = {
  type: "DisplayInput",
  category: "input",
  description: "画面共有（getDisplayMedia）の映像 texture と音声特徴量を入力する AV ノック。タブ音声 OFF でも映像は動く。",
  isSink: false,
  inputs: [],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "共有タブ映像のテクスチャ（アスペクト比を入口で正規化）。" },
    ...AUDIO_FEATURE_OUTPUTS,
    SIGNAL_OUTPUT,
  ],
  params: [...ONSET_PARAMS],
  createState: (env) => new DisplayInputRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as DisplayInputRuntime).dispose(),
  previewSource: (state: NodeState, _node: NodeInstance) => (state as DisplayInputRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as DisplayInputRuntime | undefined;
    if (!s) return { ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), audio: undefined };
    const audio = s.read();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown);
    const texture = (ctx.env ? s.getTexture(ctx.env.renderer) : null) ?? undefined;
    return { texture, ...audioFeatureOutputs(audio, onset), ...signalOutput(s.audioSignalNode()) };
  },
};
