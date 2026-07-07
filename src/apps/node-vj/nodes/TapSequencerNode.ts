// #204: スペースキー入力シーケンス記録ノード（TapSequencer）。
// ノード上の「録音」ボタンを押しているあいだだけスペースキーの手打ちタイミングを記録し
// （ループ長＝ボタンを押していた時間）、離したら記録列に従って trigger をループ発火する。
// 記録列は揮発（params へは永続化しない・将来拡張は設計 doc 参照）。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import {
  finalizeRecording, firedBetween, playPositionSec, type TapSeqPhase,
} from "./tap-sequencer-logic";

/** #204: UI 表示用の状態スナップショット（NodeEditor のステータス行が使う）。 */
export interface TapSeqStatus {
  phase: TapSeqPhase;
  /** 記録済みタップ数（recording 中は現在までの打数）。 */
  tapCount: number;
  /** ループ長（秒・記録なしは 0）。 */
  loopLenSec: number;
  /** 再生位置（秒・playing 以外は 0）。 */
  playPosSec: number;
  /** 録音経過秒（recording 以外は 0）。status(nowSec) の nowSec 基準。 */
  recordElapsedSec: number;
}

/**
 * #204: TapSequencer の永続状態（状態機械 idle → recording → playing）。
 * 録音系メソッドの nowSec は呼び出し側の時計（wall clock）でよい——保持するのは相対秒のみ。
 * 再生の時刻基準は evaluate の ctx.timeSec（playStep が受け取る）。
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
  /** 録音中タップの即時 trigger ラッチ（MidiPad の pressed と同じ・evaluate で消費）。 */
  private pressed = false;
  /** 再生の基準時刻（ctx.timeSec 系・playing 遷移後の最初の playStep で張る）。 */
  private playAnchorSec: number | null = null;
  /** 前フレームの再生経過秒（anchor 相対）。 */
  private prevPlaySec = 0;

  /** 録音開始。前の記録（再生中含む）を破棄して recording へ。 */
  startRecording(nowSec: number): void {
    this.phase = "recording";
    this.recordStartSec = nowSec;
    this.pressTimes = [];
    this.taps = [];
    this.loopLenSec = 0;
    this.playAnchorSec = null;
    this.prevPlaySec = 0;
    this.pressed = false;
  }

  /** 録音中のタップ。押下時刻を記録し、即時発火ラッチを立てる。recording 以外は無視。 */
  tap(nowSec: number): void {
    if (this.phase !== "recording" || this.recordStartSec === null) return;
    this.pressTimes.push(Math.max(0, nowSec - this.recordStartSec));
    this.pressed = true;
  }

  /**
   * 録音終了（ボタンを離した）。ループ長＝押していた時間で記録を確定し playing へ。
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
    this.playAnchorSec = null; // 次の playStep（evaluate）の時刻を再生開始点にする
    this.prevPlaySec = 0;
  }

  /** 記録消去・再生停止して idle へ。 */
  clear(): void {
    this.phase = "idle";
    this.recordStartSec = null;
    this.pressTimes = [];
    this.taps = [];
    this.loopLenSec = 0;
    this.playAnchorSec = null;
    this.prevPlaySec = 0;
    this.pressed = false;
  }

  /** 録音中タップのラッチを消費して返す（1 フレームだけ true・MidiPad と同じ表現）。 */
  consumeTapTrigger(): boolean {
    const p = this.pressed;
    this.pressed = false;
    return p;
  }

  /**
   * 再生の 1 フレーム分の発火判定（evaluate から毎フレーム呼ぶ・timeSec は ctx.timeSec）。
   * playing 遷移後の最初の呼び出しで anchor を張る（そのフレームは発火しない）。
   * 以後は半開区間 [prev, cur) の firedBetween で判定するため、t=0 のタップも
   * anchor 直後のフレームで拾え、wrap 跨ぎでも二重発火しない。
   */
  playStep(timeSec: number): boolean {
    if (this.phase !== "playing" || this.taps.length === 0) return false;
    if (this.playAnchorSec === null) {
      this.playAnchorSec = timeSec;
      this.prevPlaySec = 0;
      return false;
    }
    const cur = timeSec - this.playAnchorSec;
    const fired = firedBetween(this.prevPlaySec, cur, this.taps, this.loopLenSec);
    this.prevPlaySec = cur;
    return fired;
  }

  /** UI 表示用の状態スナップショット。nowSec は録音経過秒の算出用（録音系と同じ時計）。 */
  status(nowSec?: number): TapSeqStatus {
    const recording = this.phase === "recording" && this.recordStartSec !== null;
    return {
      phase: this.phase,
      tapCount: recording ? this.pressTimes.length : this.taps.length,
      loopLenSec: this.loopLenSec,
      playPosSec: this.phase === "playing" ? playPositionSec(this.prevPlaySec, this.loopLenSec) : 0,
      recordElapsedSec: recording && nowSec !== undefined
        ? Math.max(0, nowSec - (this.recordStartSec ?? 0)) : 0,
    };
  }
}

/** #204: スペースキー手打ちのタイミング列を記録し、ループ再生で trigger を発火するノード。 */
export const TapSequencerNode: NodeTypeDef = {
  type: "TapSequencer",
  category: "control",
  description: "node.TapSequencer.desc",
  tapSequencer: true,
  inputs: [],
  outputs: [
    { id: "trigger", label: "trig", type: "trigger",
      description: "node.TapSequencer.port.trigger" },
  ],
  params: [],
  createState: () => new TapSequencerRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as TapSequencerRuntime | undefined;
    if (!s) return { trigger: false };
    const live = s.consumeTapTrigger();      // 録音中タップの即時発火（手応え）
    const played = s.playStep(ctx.timeSec);  // 再生中のスケジュール発火
    return { trigger: live || played };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
