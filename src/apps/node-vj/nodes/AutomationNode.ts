// #186: param 軌跡の記録/ループ再生ノード（Automation・loop station 的なライブ演奏の録音）。
// タイムラインのキーフレームとは別物: 選択中に物理キー 'r' を押している間だけ手動長の録音を行い、
// ループ再生中は記録した (t, v) 列を線形補間して出力する。単トラック・オーバーダブなし
// （再度 r を押すと前の記録を破棄して新規記録・#204 TapSequencer と同じ挙動）。
// 状態遷移は #204 TapSequencerRuntime、記録バッファは #217 GraphVisual のリングバッファを参考にする。
//
// #186 再設計: 記録トリガは「グラフの arm/in trigger」から「NodeEditor が捕捉する物理キー 'r' の
// ホールド」に変更した。ランタイムからは startRecording()/stopRecording()（引数なし・armed
// フラグの ON/OFF）として見え、実際のフレーム記録・タイムスタンプは step() 内で ctx.timeSec を
// 使ったエッジ検出（armed の立ち上がり/立ち下がり）で行う（TapSequencer は wall clock を渡す
// 離散タップだが、Automation は毎フレーム連続サンプリングする必要があるためこの違いが生じる）。
// 記録元も input ポート `in` ではなく、他ノードから接続もでき手動ドラッグ操作もできる通常の
// number param `value`（自動入力ポート化・#74）に変更した。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import {
  advancePlayhead, armEdge, loopPosition, pushFrame, sampleAt, sanitizeFrames,
  type AutomationFrame, type AutomationPhase, type LoopMode,
} from "./automation-logic";

/** 録音上限フレーム数（暴走防止）。想定 60fps で約 100 秒ぶん。 */
const MAX_FRAMES = 6000;

/** #186: UI 表示用の状態スナップショット。 */
export interface AutomationStatus {
  phase: AutomationPhase;
  frameCount: number;
  loopLenSec: number;
  /** 再生位置（playing 以外は 0）。 */
  playPosSec: number;
  /** 録音経過秒（recording 以外は 0）。 */
  recordElapsedSec: number;
}

/**
 * #186: Automation の永続状態（状態機械 idle → recording → playing）。
 * startRecording/stopRecording は armed フラグの ON/OFF のみ行う（引数なし）。実際の
 * フレーム記録・タイムスタンプ算出は step() が ctx.timeSec のエッジ検出で行う。
 */
export class AutomationRuntime {
  private phase: AutomationPhase = "idle";
  private frames: AutomationFrame[] = [];
  private loopLenSec = 0;
  /** 累積 playhead（loopPosition で loopMode に応じた位置へ変換する）。 */
  private playhead = 0;
  /** 'r' キーのホールド状態（NodeEditor から startRecording/stopRecording で ON/OFF）。 */
  private armed = false;
  private prevArmed = false;
  private prevReset = false;
  /** 録音開始時刻（ctx.timeSec 系・recording 以外は null）。 */
  private recordStartSec: number | null = null;
  /** dt 算出用の前回評価時刻（初回 evaluate では 0 扱い・FlipFlop/Pulse と同じ primed パターン）。 */
  private lastEvalSec: number | null = null;
  /** params からの初期復元が済んだか（一度だけ行う）。 */
  primed = false;

  /** #186: 永続化済み params（recordedFrames/recordedLoopLenSec）から初期状態を復元する。 */
  restoreFromParams(frames: AutomationFrame[], loopLenSec: number): void {
    if (frames.length > 0 && Number.isFinite(loopLenSec) && loopLenSec > 0) {
      this.frames = frames;
      this.loopLenSec = loopLenSec;
      this.phase = "playing";
      this.playhead = 0;
    }
  }

  /** 記録開始（'r' キー押下）。armed フラグを立てるだけ。実際の遷移は次の step() で行う。 */
  startRecording(): void {
    this.armed = true;
  }

  /** 記録終了（'r' キー解放）。armed フラグを下ろすだけ。実際の遷移は次の step() で行う。 */
  stopRecording(): void {
    this.armed = false;
  }

  /** 記録消去・再生停止して idle へ（TapSequencer の clear と同じ挙動）。 */
  clear(): void {
    this.phase = "idle";
    this.frames = [];
    this.loopLenSec = 0;
    this.playhead = 0;
    this.recordStartSec = null;
  }

  /**
   * 再生位置を手動シークする（シークバードラッグ）。loopLenSec>0（＝記録済みで再生可能）の
   * ときだけ有効。idle（未記録）・loopLenSec<=0 は無視する。
   */
  seekToFraction(frac: number): void {
    if (this.phase === "idle" || !(this.loopLenSec > 0)) return;
    const clamped = Math.max(0, Math.min(1, frac));
    this.playhead = clamped * this.loopLenSec;
  }

  /**
   * #278: 停止/再生トグル（playing ⇄ stopped）。idle・recording 中は無効（no-op）。
   * stopped 中は step() が playhead を進めないため現在位置が凍結され、再度トグルすると
   * 同じ位置から再開する（dt は lastEvalSec 経由で毎フレーム更新され続けるため、
   * 停止していた間の経過時間が再開時に一気に加算されることはない）。
   */
  toggleStopPlay(): void {
    if (this.phase === "playing") { this.phase = "stopped"; return; }
    if (this.phase === "stopped") { this.phase = "playing"; return; }
  }

  /**
   * 1 フレーム分の状態更新。onCommit は録音確定時（frames 非空）に 1 度だけ呼ばれ、
   * 呼び出し側（AutomationNode.evaluate）が params へ書き戻す（YAML 永続化・#65 に乗せる）。
   * 戻り値は out ポートへ出す値。
   */
  step(
    value: number,
    resetInput: boolean,
    timeSec: number,
    loopMode: LoopMode,
    speed: number,
    onCommit: (frames: AutomationFrame[], loopLenSec: number) => void,
  ): number {
    const dt = this.lastEvalSec === null ? 0 : timeSec - this.lastEvalSec;
    this.lastEvalSec = timeSec;

    // reset: 立ち上がりで playhead を先頭へ（#186 仕様どおり頭出しのみ・録音状態には影響しない）。
    const resetFired = resetInput && !this.prevReset;
    this.prevReset = resetInput;
    if (resetFired) this.playhead = 0;

    const edge = armEdge(this.prevArmed, this.armed);
    this.prevArmed = this.armed;
    // このフレームで recording→playing へ遷移したか（TapSequencer の playAnchorSec と同じ理由で
    // 遷移直後のフレームは dt=0 扱いにする。dt は前回 evaluate からの経過秒＝録音中に経過した時間を
    // 含むため、そのまま playhead に加算すると再生開始が録音時間ぶん先読みされてしまう）。
    let justStartedPlaying = false;

    if (edge === "start") {
      // idle/playing → recording。前の記録を破棄して新規録音を開始する。
      this.phase = "recording";
      this.frames = [];
      this.loopLenSec = 0;
      this.recordStartSec = timeSec;
      this.playhead = 0;
    } else if (edge === "stop" && this.phase === "recording") {
      // recording → 録音確定（'r' を離した）。フレーム 0 件 or 経過秒 0 以下なら再生しない（idle に戻す）。
      const len = this.recordStartSec === null ? 0 : timeSec - this.recordStartSec;
      this.recordStartSec = null;
      if (this.frames.length === 0 || !(len > 0)) {
        this.phase = "idle";
        this.frames = [];
        this.loopLenSec = 0;
      } else {
        this.loopLenSec = len;
        this.phase = "playing";
        this.playhead = 0;
        justStartedPlaying = true;
        onCommit(this.frames, this.loopLenSec);
      }
    }

    if (this.phase === "recording") {
      const t = this.recordStartSec === null ? 0 : timeSec - this.recordStartSec;
      pushFrame(this.frames, t, value, MAX_FRAMES);
      return value; // 記録中は value をパススルー
    }

    if (this.phase === "playing") {
      // reset フレームも justStartedPlaying と同じ理由（このフレームは頭出しの結果を見せる・
      // 古い dt を playhead に乗せない）で dt=0 扱いにする。
      const effDt = justStartedPlaying || resetFired ? 0 : dt;
      this.playhead = advancePlayhead(this.playhead, effDt, this.loopLenSec, loopMode, speed);
      const pos = loopPosition(this.playhead, this.loopLenSec, loopMode);
      return sampleAt(this.frames, pos);
    }

    if (this.phase === "stopped") {
      // #278: playhead を進めない（凍結）。出力値も現在位置のまま止まる。
      const pos = loopPosition(this.playhead, this.loopLenSec, loopMode);
      return sampleAt(this.frames, pos);
    }

    return value; // idle: 録音前は value をそのまま通す
  }

  /** UI 表示用の状態スナップショット。 */
  status(): AutomationStatus {
    return {
      phase: this.phase,
      frameCount: this.frames.length,
      loopLenSec: this.loopLenSec,
      playPosSec: this.phase === "playing" || this.phase === "stopped"
        ? loopPosition(this.playhead, this.loopLenSec, "loop") : 0,
      recordElapsedSec: this.phase === "recording" && this.recordStartSec !== null
        ? Math.max(0, (this.lastEvalSec ?? this.recordStartSec) - this.recordStartSec) : 0,
    };
  }
}

/** #186: param の時間軌跡を記録し、ループ再生で重ね掛けできるノード。 */
export const AutomationNode: NodeTypeDef = {
  type: "Automation",
  category: "control",
  description: "node.Automation.desc",
  automation: true,
  inputs: [
    { id: "reset", label: "reset", type: "trigger", description: "node.Automation.port.reset" },
  ],
  outputs: [
    { id: "out", label: "out", type: "number", description: "node.Automation.port.out" },
  ],
  params: [
    // #186: 記録するソース値。noInput を付けないので接続もドラッグ手動操作も両方できる
    // 通常の number param（#74 の自動入力ポート化・接続時は上流値が ctx.param() で解決される）。
    { id: "value", label: "value", kind: "number", default: 0, step: 0.01,
      description: "node.Automation.param.value" },
    { id: "loopMode", label: "loopMode", kind: "enum", default: "loop", options: ["once", "loop", "pingpong"],
      description: "node.Automation.param.loopMode" },
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0.1, max: 4, step: 0.01,
      description: "node.Automation.param.speed" },
    // #186: 記録データの永続化（YAML #65 にそのまま乗せる・SamplePad の padAssets と同じ流儀で
    // kind: "string" だが実体は配列。noInput/hidden でノード UI には出さない）。
    { id: "recordedFrames", label: "recordedFrames", kind: "string", default: [], noInput: true, hidden: true,
      description: "node.Automation.param.recordedFrames" },
    { id: "recordedLoopLenSec", label: "recordedLoopLenSec", kind: "number", default: 0, noInput: true, hidden: true,
      description: "node.Automation.param.recordedLoopLenSec" },
  ],
  createState: () => new AutomationRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as AutomationRuntime | undefined;
    if (!s) return { out: 0 };
    if (!s.primed) {
      s.restoreFromParams(sanitizeFrames(ctx.param("recordedFrames")), Number(ctx.param("recordedLoopLenSec") ?? 0));
      s.primed = true;
    }
    const loopModeRaw = ctx.param("loopMode");
    const loopMode: LoopMode = loopModeRaw === "once" || loopModeRaw === "pingpong" ? loopModeRaw : "loop";
    const out = s.step(
      Number(ctx.param("value") ?? 0),
      Boolean(ctx.input("reset")),
      ctx.timeSec,
      loopMode,
      Number(ctx.param("speed") ?? 1),
      (frames, loopLenSec) => {
        // #186: 録音確定時のみ params へ書き戻す（毎フレームの playhead 進行は対象外＝
        // NodeEditor の history はここを経由しないため undo 履歴も汚染しない）。
        ctx.node.params.recordedFrames = frames.map((f) => ({ t: f.t, v: f.v }));
        ctx.node.params.recordedLoopLenSec = loopLenSec;
      },
    );
    return { out };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
