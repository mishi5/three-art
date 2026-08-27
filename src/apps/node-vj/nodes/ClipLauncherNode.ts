// #281: クリップランチャーノード（SamplePad の映像版）。4×4 パッドに動画/画像を割り当て、
// パッド押下で texture 出力をそのクリップへ切り替える。sync（trigger）接続時は押下を
// 「アーム（予約）」とし、sync の立ち上がりエッジで切り替える（クオンタイズ起動）。未接続なら即時切替。
// 音声は extractAudio=on のときのみ、アクティブクリップの音声を audio(signal) として出力し、
// VideoFileInput #116 と同じ構成（createMediaElementSource → AudioAnalyzer → gain）で
// 音響特徴量（signal/volume/bass/mid/treble/onset）も出力する。切替発火のポートは、
// onset が VideoFileInput と同じ "trigger" を使うため "launch" とした（port id 衝突回避）。
// off（既定）では全 video muted＝無音（muted は自動再生と evaluate 内 play() の許可にも必要）。
import type * as THREE from "three";
import { AudioAnalyzer } from "../../../core/audio/AudioAnalyzer";
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../../../core/types";
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { SIGNAL_OUTPUT, signalOutput } from "../graph/audio-signal";
import { PREVIEW_W, PREVIEW_H } from "../graph/preview";
import { containRect } from "../editor/fit";
import { VideoTextureSurface } from "../graph/video-surface";
import { ImageTextureSurface } from "../graph/image-surface";
import { shortPadLabel } from "./SamplePadNode";
import { resolveLaunch } from "./clip-launcher-logic";
import type { PlaybackControl } from "./playback";
import {
  AUDIO_FEATURE_OUTPUTS, ONSET_PARAMS, OnsetTracker,
  audioFeatureOutputs, readOnsetParams,
} from "./audio-feature-logic";
import { FADE_PARAM, FADE_SMOOTH_TIME, clampFade, readFade } from "./video-fade-logic";

/** パッド数（4×4・SamplePad と同寸）。 */
export const CLIP_PAD_ROWS = 4;
export const CLIP_PAD_COLS = 4;
export const CLIP_PAD_COUNT = CLIP_PAD_ROWS * CLIP_PAD_COLS;

/** パッドに割り当てたクリップ（動画 or 画像）。 */
type Clip =
  | { kind: "video"; video: HTMLVideoElement; url: string; name: string }
  | { kind: "image"; image: HTMLImageElement; url: string; name: string };

/**
 * #281: DOM/objectURL 依存の注入点。bun test では video/Image の実挙動が信頼できないため、
 * 要素生成とファイル URL 管理を差し替えられるようにする（既定は domClipMediaDeps）。
 */
export interface ClipMediaDeps {
  /** video 要素を作る（既定: display:none で body へ追加）。muted 等の設定は Runtime 側で行う。 */
  createVideo(): HTMLVideoElement;
  /** 画像を読み込む（既定: new Image() + onload）。 */
  loadImage(url: string): Promise<HTMLImageElement>;
  createObjectURL(file: File): string;
  revokeObjectURL(url: string): void;
}

/** 既定の DOM 実装。 */
export function domClipMediaDeps(): ClipMediaDeps {
  return {
    createVideo() {
      const v = document.createElement("video");
      v.style.display = "none";
      document.body.appendChild(v);
      return v;
    },
    loadImage(url: string) {
      return new Promise<HTMLImageElement>((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error("failed to load image"));
        img.src = url;
      });
    },
    createObjectURL: (file) => URL.createObjectURL(file),
    revokeObjectURL: (url) => URL.revokeObjectURL(url),
  };
}

/**
 * #281: ClipLauncher の永続状態。main.ts の PadLoadable duck-type
 * （loadPadFile/playPad/hasPad/padLabel/stopAll/stopPad/clearPad）を実装し、
 * D&D 割当・パッドオーバーレイ・アセット復元（padAssets）を SamplePad と共通の配線で受ける。
 * 切替の実行はフレーム同期が要るため playPad は pending を立てるだけにし、
 * evaluate から毎フレーム呼ばれる step() が resolveLaunch で確定する。
 */
export class ClipLauncherRuntime implements PlaybackControl {
  private deps: ClipMediaDeps;
  private clips: (Clip | null)[] = new Array(CLIP_PAD_COUNT).fill(null);
  /** 押下されたが未消費のパッド（sync 接続時はアーム表示・未接続なら次 step で切替）。 */
  private pending: number | null = null;
  private active: number | null = null;
  private prevSync = false;
  /** #272: padTrig 入力のエッジ検出用（前フレームの値）。 */
  private prevPadTrig = false;
  private videoSurface = new VideoTextureSurface();
  private imageSurface = new ImageTextureSurface();
  private previewCanvas: HTMLCanvasElement | null = null;

  // --- #281 音声抽出（extractAudio・VideoFileInput #116 と同じ構図） ---
  /** 共有 AudioContext（#127/#128。headless テストや state 移譲前は null もあり得る）。 */
  private audioCtx: AudioContext | null;
  /** 特徴量解析（mediaSources → analyzer.input → mixGain）。fade より上流なので影響を受けない。 */
  private analyzer: AudioAnalyzer | null = null;
  /** 全クリップ音声の合流先（= signal 出力ノード・fade 反映先）。extractAudio 初回 on で遅延構築。 */
  private mixGain: GainNode | null = null;
  /** MediaElementAudioSourceNode は要素ごとに 1 度しか生成できないため Map で保持する。 */
  private mediaSources = new Map<HTMLVideoElement, MediaElementAudioSourceNode>();
  /** 現在 audio 抽出が有効か（signal 公開と muted 反映の基準）。 */
  private audioEnabled = false;
  /** onset 検出（VideoFileInput と同じ OnsetTracker）。 */
  private onset = new OnsetTracker();
  /** #241: 現在の音声フェード目標値（mixGain へ反映済みの値。重複スケジュールを避ける）。 */
  private audioFadeTarget = 1;

  constructor(audioCtx: AudioContext | null = null, deps: ClipMediaDeps = domClipMediaDeps()) {
    this.audioCtx = audioCtx;
    this.deps = deps;
  }

  /** #281: パッド index に動画/画像ファイルを割り当てる（動画は preload のみ・再生しない）。 */
  async loadPadFile(index: number, file: File): Promise<void> {
    if (index < 0 || index >= CLIP_PAD_COUNT) return;
    const url = this.deps.createObjectURL(file);
    let clip: Clip;
    if (file.type.startsWith("image/")) {
      let image: HTMLImageElement;
      try {
        image = await this.deps.loadImage(url);
      } catch (e) {
        this.deps.revokeObjectURL(url);
        throw e;
      }
      clip = { kind: "image", image, url, name: file.name };
    } else {
      const video = this.deps.createVideo();
      // muted は自動再生ポリシーと evaluate 内（gesture 外）の play() 許可のため常時必須。
      video.muted = true;
      video.playsInline = true;
      video.preload = "auto";
      video.src = url;
      clip = { kind: "video", video, url, name: file.name };
    }
    // 再割当は古いクリップを破棄してから差し替える（アクティブ/アーム解除も含む）。
    if (this.clips[index]) this.clearPad(index);
    this.clips[index] = clip;
    // #281: 音声グラフ構築済みなら新しい動画も遅延接続する（要素ごとに 1 度だけ）。
    if (clip.kind === "video" && this.mixGain) this.connectClipAudio(clip.video);
  }

  /** パッドにクリップが割り当て済みか。 */
  hasPad(index: number): boolean {
    return index >= 0 && index < CLIP_PAD_COUNT && this.clips[index] != null;
  }

  /** パッドの表示ラベル（短縮ファイル名・未割当は null）。 */
  padLabel(index: number): string | null {
    if (index < 0 || index >= CLIP_PAD_COUNT) return null;
    return shortPadLabel(this.clips[index]?.name ?? null);
  }

  /**
   * #281: パッド押下。切替は sync 接続有無で即時/クオンタイズが変わり、それを知るのは
   * evaluate だけなので、ここでは pending を立てるだけにする（未割当は no-op）。
   */
  playPad(index: number): void {
    if (!this.hasPad(index)) return;
    this.pending = index;
  }

  /**
   * #272: padTrig 入力の立ち上がりで padIndex のパッドを起動する（MidiPad からの配線用）。
   * マウスクリック経路（main.ts）と同じ playPad を通るので、sync のクオンタイズ挙動も同じ。
   * step より前に呼ぶこと（pending を立ててから resolveLaunch に渡すため）。
   */
  padTriggerFromInput(index: unknown, trig: unknown): void {
    const now = Boolean(trig);
    const rising = now && !this.prevPadTrig;
    this.prevPadTrig = now;
    if (!rising) return;
    const i = Math.round(Number(index));
    if (Number.isFinite(i)) this.playPad(i);
  }

  /**
   * #281: 毎フレーム（evaluate から）。sync 入力値と loop param を受け取り、
   * resolveLaunch で pending の即時切替/アーム保持/エッジ切替を確定する。
   * syncVal: undefined ⇒ sync 未接続、boolean ⇒ 接続済み（立ち上がりエッジ検出）。
   * 戻り値 switched は「実際に切替が起きたフレーム」のみ true（trigger 出力用）。
   */
  step(syncVal: unknown, loop: boolean): { switched: boolean } {
    const syncConnected = syncVal !== undefined;
    const sync = Boolean(syncVal);
    const syncEdge = sync && !this.prevSync;
    this.prevSync = sync;
    const r = resolveLaunch(this.pending, syncConnected, syncEdge);
    this.pending = r.armed;
    if (r.switchTo !== null) this.activate(r.switchTo);
    // loop / muted は全 video 要素へ反映（アクティブだけだと切替時に反映漏れするため）。
    // muted は extractAudio=on のときアクティブ video のみ false（非アクティブは paused で
    // 音が出ないはずだが、シーク等での漏れに対する防御として毎フレーム明示する）。
    this.clips.forEach((clip, i) => {
      if (clip?.kind !== "video") return;
      clip.video.loop = loop;
      clip.video.muted = !(this.audioEnabled && this.active === i);
    });
    return { switched: r.switchTo !== null };
  }

  /**
   * #281: 音声抽出の ON/OFF（evaluate から毎フレーム・extractAudio param を反映）。
   * ON の初回に mixGain（signal 出力）＋ gain 0 の keepalive → destination を構築し、
   * 既存の全動画クリップを createMediaElementSource で接続する（要素ごとに 1 度だけ）。
   * destination へ直結しない理由は VideoFileInput #128 と同じ（発音は Audio 出力ノード経由）。
   * AudioContext が無い環境（headless）では無効のまま＝signal null・全 video muted。
   */
  setAudioEnabled(enabled: boolean): void {
    if (enabled && !this.audioEnabled) {
      this.ensureAudioGraph();
      if (this.mixGain) {
        for (const clip of this.clips) {
          if (clip?.kind === "video") this.connectClipAudio(clip.video);
        }
        void this.audioCtx?.resume().catch(() => { /* gesture 不足時は次回 */ });
      }
    }
    this.audioEnabled = enabled && this.mixGain !== null;
  }

  /**
   * 音声グラフを 1 度だけ構築する（共有 ctx・destination 非接続の keepalive 付き）。
   * mediaSources → analyzer.input → mixGain(= signal 出力・fade 反映先) → keep(0) → destination。
   * 解析（analyzer）は fade（mixGain）より上流なので特徴量は fade の影響を受けない
   * （VideoFileInput の ensureAudioGraph と同じ性質）。
   */
  private ensureAudioGraph(): void {
    if (this.mixGain || !this.audioCtx) return;
    const ctx = this.audioCtx;
    this.analyzer = new AudioAnalyzer(ctx);
    this.mixGain = ctx.createGain();
    this.mixGain.gain.value = 1;
    this.analyzer.input.connect(this.mixGain);
    // 無音(gain 0)の keep-alive で MediaElementSource のグラフを生かす（VideoFileInput と同じ）。
    const keep = ctx.createGain();
    keep.gain.value = 0;
    this.mixGain.connect(keep);
    keep.connect(ctx.destination);
  }

  /** video 要素を analyzer 入口へ接続する（MediaElementAudioSourceNode は要素ごとに 1 度だけ）。 */
  private connectClipAudio(video: HTMLVideoElement): void {
    if (!this.analyzer || !this.audioCtx || this.mediaSources.has(video)) return;
    const src = this.audioCtx.createMediaElementSource(video);
    src.connect(this.analyzer.input);
    this.mediaSources.set(video, src);
  }

  /** #281: audio(signal) 出力用の AudioNode（extractAudio=off / 未構築なら null）。 */
  audioSignalNode(): AudioNode | null {
    return this.audioEnabled ? this.mixGain : null;
  }

  /** #281: 現在の音響特徴量（extractAudio=off / 未構築時は無音デフォルト・VideoFileInput と同じ）。 */
  readAudio(): AudioFeatures {
    if (!this.audioEnabled || !this.analyzer || !this.audioCtx) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.audioCtx.sampleRate);
  }

  /** #281: onset 検出（extractAudio=off は常に false・VideoFileInput と同じ）。 */
  detectOnset(bass: number, t: number, threshold: number, cooldown: number): boolean {
    if (!this.audioEnabled) return false;
    return this.onset.detect(bass, t, threshold, cooldown);
  }

  /**
   * #241/#281: 音声フェード（0=無音、1=そのまま）。mixGain（= signal 出力ノード）へ
   * setTargetAtTime で滑らかに反映し、急変時のクリックノイズを避ける（VideoFileInput の
   * setAudioFade と同じ）。特徴量は mixGain より上流（analyzer）で解析するため影響なし。
   * 音声グラフ未構築（extractAudio=off 等）のときは no-op。
   */
  setAudioFade(fade: number): void {
    if (!this.mixGain || !this.audioCtx) return;
    const f = clampFade(fade);
    if (f === this.audioFadeTarget) return;
    this.audioFadeTarget = f;
    this.mixGain.gain.setTargetAtTime(f, this.audioCtx.currentTime, FADE_SMOOTH_TIME);
  }

  /** 切替を実行する（前のアクティブ video を pause・動画は頭から再生＝リトリガ）。 */
  private activate(index: number): void {
    const clip = this.clips[index];
    if (!clip) return;
    const prev = this.active !== null ? this.clips[this.active] : null;
    if (prev && prev !== clip && prev.kind === "video") prev.video.pause();
    this.active = index;
    if (clip.kind === "video") {
      try { clip.video.currentTime = 0; } catch { /* メタデータ未着はそのまま */ }
      void clip.video.play().catch(() => { /* 読込前の play は次の押下で再試行 */ });
    }
  }

  /** 現在再生中（texture 供給中）のパッド index（なしは null）。パッド強調表示用。 */
  activeIndex(): number | null {
    return this.active;
  }

  // --- PlaybackControl（#99/#281: トランスポート行＝アクティブクリップの操作）---
  // アクティブが動画のときだけ有効。画像/アクティブなしは duration 0（シークバー空・seek no-op）。

  /** アクティブな video クリップ（なし/画像は null）。 */
  private activeVideo(): HTMLVideoElement | null {
    const clip = this.active !== null ? this.clips[this.active] : null;
    return clip?.kind === "video" ? clip.video : null;
  }

  isPlaying(): boolean {
    const v = this.activeVideo();
    return v !== null && !v.paused;
  }

  /** 再生/一時停止トグル。pause してもアクティブは維持（映像は現フレームで停止したまま）。 */
  togglePlay(): void {
    const v = this.activeVideo();
    if (!v) return;
    if (v.paused) void v.play().catch(() => { /* 自動再生拒否時は次の押下で再試行 */ });
    else v.pause();
  }

  getCurrentTime(): number {
    return this.activeVideo()?.currentTime || 0;
  }

  getDuration(): number {
    const d = this.activeVideo()?.duration;
    return d !== undefined && Number.isFinite(d) ? d : 0;
  }

  seek(t: number): void {
    const v = this.activeVideo();
    if (!v) return;
    const d = this.getDuration();
    v.currentTime = d > 0 ? Math.max(0, Math.min(t, d - 1e-3)) : 0;
  }

  /** アーム（予約）中のパッド index（なしは null）。パッド点滅表示用。 */
  armedIndex(): number | null {
    return this.pending;
  }

  /** #281: パッド表示用（main.ts の padCellInfo 配線から呼ばれる duck-type）。 */
  padActive(index: number): boolean {
    return this.active === index;
  }

  padArmed(index: number): boolean {
    return this.pending === index;
  }

  /** #281: 全停止（Stop ボタン）。アクティブ video を pause し、アクティブ/アームを解除する。 */
  stopAll(): void {
    const cur = this.active !== null ? this.clips[this.active] : null;
    if (cur?.kind === "video") cur.video.pause();
    this.active = null;
    this.pending = null;
  }

  /** #281: 個別停止。そのパッドがアクティブなら停止、アーム中ならアーム解除。 */
  stopPad(index: number): void {
    if (this.pending === index) this.pending = null;
    if (this.active !== index) return;
    const clip = this.clips[index];
    if (clip?.kind === "video") clip.video.pause();
    this.active = null;
  }

  /** #281: 割当解除（objectURL revoke・要素破棄。アクティブ/アーム中なら解除）。padAssets は呼び出し側で消す。 */
  clearPad(index: number): void {
    if (index < 0 || index >= CLIP_PAD_COUNT) return;
    this.stopPad(index);
    const clip = this.clips[index];
    if (!clip) return;
    this.disposeClip(clip);
    this.clips[index] = null;
  }

  private disposeClip(clip: Clip): void {
    if (clip.kind === "video") {
      clip.video.pause();
      // #281: mediaSource は要素と 1:1。要素破棄と同時に切断する（共有 ctx は close しない）。
      const src = this.mediaSources.get(clip.video);
      if (src) {
        try { src.disconnect(); } catch { /* already disconnected */ }
        this.mediaSources.delete(clip.video);
      }
      clip.video.remove();
    }
    this.deps.revokeObjectURL(clip.url);
  }

  /**
   * アクティブクリップの texture（アクティブなし/未読込は null → 出力 undefined＝下流は黒）。
   * fade は #241 の黒フェード量（省略時 1=従来と同一・動画/画像とも surface 側で輝度乗算）。
   */
  getTexture(renderer: THREE.WebGLRenderer, fade = 1): THREE.Texture | null {
    const clip = this.active !== null ? this.clips[this.active] : null;
    if (!clip) return null;
    if (clip.kind === "video") {
      if (clip.video.videoWidth === 0) return null;
      return this.videoSurface.render(renderer, clip.video, fade);
    }
    return this.imageSurface.render(renderer, clip.image, fade);
  }

  /** ノード隣接プレビュー（アクティブクリップを contain 描画・VideoFileInput と同パターン）。 */
  previewFrame(): CanvasImageSource | null {
    const clip = this.active !== null ? this.clips[this.active] : null;
    if (!clip) return null;
    const srcW = clip.kind === "video" ? clip.video.videoWidth : clip.image.naturalWidth;
    const srcH = clip.kind === "video" ? clip.video.videoHeight : clip.image.naturalHeight;
    if (srcW === 0 || srcH === 0) return null;
    if (!this.previewCanvas) {
      this.previewCanvas = document.createElement("canvas");
      this.previewCanvas.width = PREVIEW_W;
      this.previewCanvas.height = PREVIEW_H;
    }
    const ctx = this.previewCanvas.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = "#000";
    ctx.fillRect(0, 0, PREVIEW_W, PREVIEW_H);
    const fit = containRect(srcW, srcH, PREVIEW_W, PREVIEW_H);
    ctx.drawImage(clip.kind === "video" ? clip.video : clip.image, fit.x, fit.y, fit.w, fit.h);
    return this.previewCanvas;
  }

  /** 全クリップ・surface・音声グラフの解放（共有 AudioContext は close しない）。 */
  dispose(): void {
    this.stopAll();
    for (let i = 0; i < CLIP_PAD_COUNT; i++) {
      const clip = this.clips[i];
      if (clip) this.disposeClip(clip);
      this.clips[i] = null;
    }
    try { this.mixGain?.disconnect(); } catch { /* ignore */ }
    this.mixGain = null;
    this.analyzer = null;
    this.audioEnabled = false;
    this.videoSurface.dispose();
    this.imageSurface.dispose();
  }
}

/** #281: クリップランチャーノード。4×4 パッドの動画/画像クリップを texture として起動する。 */
export const ClipLauncherNode: NodeTypeDef = {
  type: "ClipLauncher",
  category: "source",
  description: "node.ClipLauncher.desc",
  isSink: false,
  padGrid: { rows: CLIP_PAD_ROWS, cols: CLIP_PAD_COLS, accept: "video/*,image/*" },
  // #281: アクティブクリップのトランスポート行（再生/一時停止＋シークバー・#99 の流用）。
  transport: true,
  inputs: [
    { id: "sync", label: "sync", type: "trigger", description: "node.ClipLauncher.port.sync" },
    // #272: 実機 MIDI パッド（MidiPad）等から外部起動するための口。
    { id: "padIndex", label: "padIdx", type: "number", description: "node.ClipLauncher.port.padIndex" },
    { id: "padTrig", label: "padTrig", type: "trigger", description: "node.ClipLauncher.port.padTrig" },
  ],
  outputs: [
    { id: "texture", label: "tex", type: "texture", description: "node.ClipLauncher.port.texture" },
    // 実際に切替が起きたフレームに 1 回発火（アーム時ではない）。Flash 等の演出同期用。
    // id は "launch"（onset が VideoFileInput と同じ "trigger" を使うため衝突を回避）。
    { id: "launch", label: "launch", type: "trigger", description: "node.ClipLauncher.port.launch" },
    // #281: VideoFileInput と同等の音響特徴量一式（signal/volume/bass/mid/treble/trigger=onset）。
    ...AUDIO_FEATURE_OUTPUTS,
    // extractAudio=on でアクティブクリップの実音声信号（AudioMix/AudioOutput へ）。
    SIGNAL_OUTPUT,
  ],
  params: [
    { id: "loop", label: "loop", kind: "enum", default: "on", options: ["on", "off"],
      description: "node.ClipLauncher.param.loop" },
    FADE_PARAM,
    { id: "extractAudio", label: "extractAudio", kind: "enum", default: "off", options: ["off", "on"],
      description: "node.ClipLauncher.param.extractAudio" },
    ...ONSET_PARAMS,
    // 各パッドの割当アセット id（string[]・長さ可変・hidden）。SamplePad と同名 param を使うことで
    // collectAssetRefs / main.ts のパッド復元がそのまま効く。
    { id: "padAssets", label: "padAssets", kind: "string", default: [], noInput: true, hidden: true,
      description: "node.ClipLauncher.param.padAssets" },
  ],
  createState: (env) => new ClipLauncherRuntime(env.audioContext),
  disposeState: (state: NodeState) => (state as ClipLauncherRuntime).dispose(),
  previewSource: (state: NodeState) => (state as ClipLauncherRuntime).previewFrame(),
  evaluate: (ctx) => {
    const s = ctx.state as ClipLauncherRuntime | undefined;
    const audioOn = ctx.param("extractAudio") === "on";
    if (!s) return { launch: false, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), audio: undefined };
    // muted 反映は step 内なので、先に extractAudio を反映してから step する。
    s.setAudioEnabled(audioOn);
    // #241: fade は映像（texture 輝度）と音声（mixGain）へ同時に掛ける（VideoFileInput と同じ）。
    const fade = readFade(ctx.param);
    s.setAudioFade(fade);
    // #272: 外部からのパッド起動は step より前（pending を立ててから resolveLaunch に渡す）。
    s.padTriggerFromInput(ctx.input("padIndex"), ctx.input("padTrig"));
    const { switched } = s.step(ctx.input("sync"), ctx.param("loop") !== "off");
    const texture = (ctx.env ? s.getTexture(ctx.env.renderer, fade) : null) ?? undefined;
    if (!audioOn) {
      return { texture, launch: switched, ...audioFeatureOutputs(DEFAULT_AUDIO_FEATURES, false), audio: undefined };
    }
    const audio = s.readAudio();
    const { threshold, cooldown } = readOnsetParams(ctx.param);
    const onset = s.detectOnset(audio.bass, ctx.timeSec, threshold, cooldown);
    return { texture, launch: switched, ...audioFeatureOutputs(audio, onset), ...signalOutput(s.audioSignalNode()) };
  },
};
