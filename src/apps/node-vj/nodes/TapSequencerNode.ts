// #204: スペースキー入力シーケンス記録ノード（TapSequencer）。
// #275: ノードを選択して物理キー 'r' をホールドしているあいだだけスペースキーの手打ちタイミングを
// 記録し（ループ長＝ホールドしていた時間）、離したら記録列に従って trigger をループ発火する。
// #278: 再生ランタイムを AutomationRuntime と同じ「累積 playhead ＋ loopPosition 変換」方式に
// 作り替えた。speed 倍率・once での末尾停止・手動シーク・停止/再生トグルを、Automation と共通の
// automation-logic.ts（advancePlayhead/loopPosition）でそのまま扱える。firedBetween（wrap されて
// いない生の prev/cur 経過秒を受け取り内部で wrap する実装）はこの累積 playhead をそのまま
// prevPos/playhead として渡せるため変更不要。
// 記録列は揮発（params へは永続化しない・将来拡張は設計 doc 参照）。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import { advancePlayhead, loopPosition } from "./automation-logic";
import { finalizeRecording, firedBetween } from "./tap-sequencer-logic";

/** TapSequencer の再生ループモード。once/loop のみ（離散トリガー列の pingpong 往復再生は対象外）。 */
export type TapLoopMode = "once" | "loop";

/** #204/#278: TapSequencer の状態機械フェーズ。idle → recording → playing ⇄ stopped。 */
export type TapSeqPhase = "idle" | "recording" | "playing" | "stopped";

/** #204: UI 表示用の状態スナップショット（NodeEditor のステータス行が使う）。 */
export interface TapSeqStatus {
  phase: TapSeqPhase;
  /** 記録済みタップ数（recording 中は現在までの打数）。 */
  tapCount: number;
  /** ループ長（秒・記録なしは 0）。 */
  loopLenSec: number;
  /** 再生位置（秒・playing/stopped 以外は 0）。 */
  playPosSec: number;
  /** 録音経過秒（recording 以外は 0）。status(nowSec) の nowSec 基準。 */
  recordElapsedSec: number;
}

/**
 * #204/#278: TapSequencer の永続状態（状態機械 idle → recording → playing ⇄ stopped）。
 * 録音系メソッドの nowSec は呼び出し側の時計（wall clock）でよい——保持するのは相対秒のみ。
 * 再生は AutomationRuntime と同じ累積 playhead 方式（playStep が dt 算出・advancePlayhead 呼び出し・
 * firedBetween 判定までを毎フレーム行う）。
 */
export class TapSequencerRuntime {
  private phase: TapSeqPhase = "idle";
  /** 録音開始時刻（呼び出し側時計・recording 以外は null）。 */
  private recordStartSec: number | null = null;
  /** 録音中の押下時刻列（録音開始からの相対秒）。 */
  private pressTimes: number[] = [];
  /** 確定済みタップ列（相対秒・昇順）。 */
  private taps: number[] = [];
  private loopLenSec = 0;
  /** 累積 playhead（AutomationRuntime.playhead と同じ役割。loop では無制限に増加し続ける）。 */
  private playhead = 0;
  /** firedBetween の prev 境界（前フレームの playhead）。 */
  private prevPos = 0;
  /** dt 算出用の前回評価時刻（初回 playStep では 0 扱い・FlipFlop/Automation と同じ primed パターン）。 */
  private lastEvalSec: number | null = null;
  private prevReset = false;
  /** recording→playing 遷移フレームだけ true（このフレームの dt を捨てて先読みを防ぐ）。 */
  private justStartedPlaying = false;
  /** 録音中タップの即時 trigger ラッチ（SamplePad の pressed と同じ・evaluate で消費）。 */
  private pressed = false;

  /** 録音開始。前の記録（再生中含む）を破棄して recording へ。 */
  startRecording(nowSec: number): void {
    this.phase = "recording";
    this.recordStartSec = nowSec;
    this.pressTimes = [];
    this.taps = [];
    this.loopLenSec = 0;
    this.playhead = 0;
    this.prevPos = 0;
    this.justStartedPlaying = false;
    this.pressed = false;
  }

  /** 録音中のタップ。押下時刻を記録し、即時発火ラッチを立てる。recording 以外は無視。 */
  tap(nowSec: number): void {
    if (this.phase !== "recording" || this.recordStartSec === null) return;
    this.pressTimes.push(Math.max(0, nowSec - this.recordStartSec));
    this.pressed = true;
  }

  /**
   * 録音終了（'r' キーを離した）。ループ長＝ホールドしていた時間で記録を確定し playing へ。
   * タップ 0 回なら idle（再生しない）。recording 以外は無視。
   */
  stopRecording(nowSec: number): void {
    if (this.phase !== "recording" || this.recordStartSec === null) return;
    const rec = finalizeRecording(this.pressTimes, nowSec - this.recordStartSec);
    this.recordStartSec = null;
    this.pressTimes = [];
    if (!rec) {
      this.phase = "idle";
      return;
    }
    this.taps = rec.taps;
    this.loopLenSec = rec.loopLenSec;
    this.phase = "playing";
    this.playhead = 0;
    this.prevPos = 0;
    this.justStartedPlaying = true; // 次の playStep のこのフレームぶんの dt を捨てる（先読み防止）
  }

  /** 記録消去・再生停止して idle へ。 */
  clear(): void {
    this.phase = "idle";
    this.recordStartSec = null;
    this.pressTimes = [];
    this.taps = [];
    this.loopLenSec = 0;
    this.playhead = 0;
    this.prevPos = 0;
    this.justStartedPlaying = false;
    this.pressed = false;
  }

  /**
   * #278: 手動シーク（シークバードラッグ）。idle または loopLenSec<=0 は無視。playhead と prevPos を
   * 両方シーク先に合わせることで、ジャンプによる誤発火（スキップ区間のタップが一気に鳴る）を防ぐ。
   */
  seekToFraction(frac: number): void {
    if (this.phase === "idle" || !(this.loopLenSec > 0)) return;
    const clamped = Math.max(0, Math.min(1, frac));
    this.playhead = clamped * this.loopLenSec;
    this.prevPos = this.playhead;
  }

  /**
   * #278: 停止/再生トグル（playing ⇄ stopped）。idle・recording 中は無効（no-op）。
   * stopped 中も playStep は毎フレーム呼ばれ続け lastEvalSec だけは更新されるため、
   * 再度 playing に戻したときに「停止していた間の経過時間」が一気に加算されることはない
   * （同じ位置から自然に再開する）。
   */
  toggleStopPlay(): void {
    if (this.phase === "playing") { this.phase = "stopped"; return; }
    if (this.phase === "stopped") { this.phase = "playing"; return; }
  }

  /** 録音中タップのラッチを消費して返す（1 フレームだけ true・SamplePad と同じ表現）。 */
  consumeTapTrigger(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  /**
   * 再生の 1 フレーム分の発火判定（evaluate から毎フレーム呼ぶ・timeSec は ctx.timeSec）。
   * resetInput は Automation の reset と同じく立ち上がりで先頭へシークする（stopped 中でも効く。
   * recording 中は無視——playhead が playing/stopped のときだけ動くため実質無効）。
   */
  playStep(resetInput: boolean, timeSec: number, loopMode: TapLoopMode, speed: number): boolean {
    const dt = this.lastEvalSec === null ? 0 : timeSec - this.lastEvalSec;
    this.lastEvalSec = timeSec;

    const resetFired = resetInput && !this.prevReset;
    this.prevReset = resetInput;
    if (resetFired && (this.phase === "playing" || this.phase === "stopped")) {
      this.playhead = 0;
      this.prevPos = 0;
    }

    if (this.phase !== "playing" || this.taps.length === 0) return false;

    const effDt = this.justStartedPlaying || resetFired ? 0 : dt;
    this.justStartedPlaying = false;
    this.playhead = advancePlayhead(this.playhead, effDt, this.loopLenSec, loopMode, speed);
    if (effDt <= 0) { this.prevPos = this.playhead; return false; }
    const fired = firedBetween(this.prevPos, this.playhead, this.taps, this.loopLenSec);
    this.prevPos = this.playhead;
    return fired;
  }

  /** UI 表示用の状態スナップショット。nowSec は録音経過秒の算出用（録音系と同じ時計）。 */
  status(nowSec?: number): TapSeqStatus {
    const recording = this.phase === "recording" && this.recordStartSec !== null;
    return {
      phase: this.phase,
      tapCount: recording ? this.pressTimes.length : this.taps.length,
      loopLenSec: this.loopLenSec,
      // #278: 表示用は常に "loop" モードで wrap する（AutomationRuntime.status と同じ）。
      playPosSec: this.phase === "playing" || this.phase === "stopped"
        ? loopPosition(this.playhead, this.loopLenSec, "loop") : 0,
      recordElapsedSec: recording && nowSec !== undefined
        ? Math.max(0, nowSec - (this.recordStartSec ?? 0)) : 0,
    };
  }
}

/** #204/#278: スペースキー手打ちのタイミング列を記録し、ループ再生で trigger を発火するノード。 */
export const TapSequencerNode: NodeTypeDef = {
  type: "TapSequencer",
  category: "control",
  description: "node.TapSequencer.desc",
  tapSequencer: true,
  inputs: [
    { id: "reset", label: "reset", type: "trigger", description: "node.TapSequencer.port.reset" },
  ],
  outputs: [
    { id: "trigger", label: "trig", type: "trigger",
      description: "node.TapSequencer.port.trigger" },
  ],
  params: [
    { id: "loopMode", label: "loopMode", kind: "enum", default: "loop", options: ["once", "loop"],
      description: "node.TapSequencer.param.loopMode" },
    { id: "speed", label: "speed", kind: "number", default: 1, min: 0.1, max: 4, step: 0.01,
      description: "node.TapSequencer.param.speed" },
  ],
  createState: () => new TapSequencerRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as TapSequencerRuntime | undefined;
    if (!s) return { trigger: false };
    const live = s.consumeTapTrigger(); // 録音中タップの即時発火（手応え）
    const loopModeRaw = ctx.param("loopMode");
    // pingpong 等の不正値（旧データ等）は防御的に loop へフォールバックする（Automation と同パターン）。
    const loopMode: TapLoopMode = loopModeRaw === "once" ? "once" : "loop";
    const played = s.playStep(
      Boolean(ctx.input("reset")), ctx.timeSec, loopMode, Number(ctx.param("speed") ?? 1),
    ); // 再生中のスケジュール発火
    return { trigger: live || played };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
