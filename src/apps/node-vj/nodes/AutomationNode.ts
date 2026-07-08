// #186: param 軌跡の記録/ループ再生ノード（Automation・loop station 的なライブ演奏の録音）。
// タイムラインのキーフレームとは別物: グラフの arm/reset トリガで手動長の録音を行い、
// ループ再生中は記録した (t, v) 列を線形補間して出力する。単トラック・オーバーダブなし
// （再 arm すると前の記録を破棄して新規記録・#204 TapSequencer と同じ挙動）。
// 状態遷移は #204 TapSequencerRuntime、記録バッファは #217 GraphVisual のリングバッファを参考にする。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import {
  advancePlayhead, armToggle, loopPosition, pushFrame, sampleAt, sanitizeFrames,
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

/** step() に渡す 1 フレーム分の入力。 */
export interface AutomationStepInput {
  inVal: number;
  arm: boolean;
  reset: boolean;
  /** ランタイム経過秒（ctx.timeSec）。記録/再生とも同じ時計を使う。 */
  timeSec: number;
  loopMode: LoopMode;
  speed: number;
}

/**
 * #186: Automation の永続状態（状態機械 idle → recording → playing）。
 * TapSequencer と異なり arm/reset はグラフの trigger 入力（他ノードからの配線）なので、
 * 録音の開始/終了はすべて evaluate 内の立ち上がりエッジ検出で判定する
 * （ホールド録音の押下/離しを外部から呼び分ける TapSequencer とは異なり、二度目の arm で確定する）。
 */
export class AutomationRuntime {
  private phase: AutomationPhase = "idle";
  private frames: AutomationFrame[] = [];
  private loopLenSec = 0;
  /** 累積 playhead（loopPosition で loopMode に応じた位置へ変換する）。 */
  private playhead = 0;
  private prevArm = false;
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

  /**
   * 1 フレーム分の状態更新。onCommit は録音確定時（frames 非空）に 1 度だけ呼ばれ、
   * 呼び出し側（AutomationNode.evaluate）が params へ書き戻す（YAML 永続化・#65 に乗せる）。
   * 戻り値は out ポートへ出す値。
   */
  step(input: AutomationStepInput, onCommit: (frames: AutomationFrame[], loopLenSec: number) => void): number {
    const dt = this.lastEvalSec === null ? 0 : input.timeSec - this.lastEvalSec;
    this.lastEvalSec = input.timeSec;

    // reset: 立ち上がりで playhead を先頭へ（#186 仕様どおり頭出しのみ・録音状態には影響しない）。
    const resetFired = input.reset && !this.prevReset;
    this.prevReset = input.reset;
    if (resetFired) this.playhead = 0;

    const prevPhase = this.phase;
    const proposed = armToggle(this.prevArm, input.arm, this.phase);
    this.prevArm = input.arm;
    // このフレームで recording→playing へ遷移したか（TapSequencer の playAnchorSec と同じ理由で
    // 遷移直後のフレームは dt=0 扱いにする。dt は前回 evaluate からの経過秒＝録音中に経過した時間を
    // 含むため、そのまま playhead に加算すると再生開始が録音時間ぶん先読みされてしまう）。
    let justStartedPlaying = false;

    if (proposed !== prevPhase) {
      if (proposed === "recording") {
        // idle/playing → recording。前の記録を破棄して新規録音を開始する。
        this.phase = "recording";
        this.frames = [];
        this.loopLenSec = 0;
        this.recordStartSec = input.timeSec;
        this.playhead = 0;
      } else {
        // recording → 録音確定（もう一度 arm）。フレーム 0 件なら再生しない（idle に戻す）。
        const len = this.recordStartSec === null ? 0 : input.timeSec - this.recordStartSec;
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
    }

    if (this.phase === "recording") {
      const t = this.recordStartSec === null ? 0 : input.timeSec - this.recordStartSec;
      pushFrame(this.frames, t, input.inVal, MAX_FRAMES);
      return input.inVal; // 記録中は in をパススルー
    }

    if (this.phase === "playing") {
      // reset フレームも justStartedPlaying と同じ理由（このフレームは頭出しの結果を見せる・
      // 古い dt を playhead に乗せない）で dt=0 扱いにする。
      const effDt = justStartedPlaying || resetFired ? 0 : dt;
      this.playhead = advancePlayhead(this.playhead, effDt, this.loopLenSec, input.loopMode, input.speed);
      const pos = loopPosition(this.playhead, this.loopLenSec, input.loopMode);
      return sampleAt(this.frames, pos);
    }

    return input.inVal; // idle: 録音前は in をそのまま通す
  }

  /** UI 表示用の状態スナップショット。 */
  status(): AutomationStatus {
    return {
      phase: this.phase,
      frameCount: this.frames.length,
      loopLenSec: this.loopLenSec,
      playPosSec: this.phase === "playing" ? loopPosition(this.playhead, this.loopLenSec, "loop") : 0,
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
  inputs: [
    { id: "in", label: "in", type: "number", description: "node.Automation.port.in" },
    { id: "arm", label: "arm", type: "trigger", description: "node.Automation.port.arm" },
    { id: "reset", label: "reset", type: "trigger", description: "node.Automation.port.reset" },
  ],
  outputs: [
    { id: "out", label: "out", type: "number", description: "node.Automation.port.out" },
  ],
  params: [
    { id: "loopMode", label: "loopMode", kind: "enum", default: "loop", options: ["once", "loop", "pingpong"],
      description: "node.Automation.param.loopMode" },
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0.1, max: 4, step: 0.01,
      description: "node.Automation.param.speed" },
    // #186: 記録データの永続化（YAML #65 にそのまま乗せる・MidiPad の padAssets と同じ流儀で
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
      {
        inVal: Number(ctx.input("in") ?? 0),
        arm: Boolean(ctx.input("arm")),
        reset: Boolean(ctx.input("reset")),
        timeSec: ctx.timeSec,
        loopMode,
        speed: Number(ctx.param("speed") ?? 1),
      },
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
