// #270: BeatClock（BPM ビートクロック）ノード。
// BPM ソースは 3 系統: 手動 bpm param／タップテンポ（ノード上の TAP ボタン＋ tap トリガ入力）／
// onset トリガ入力からの自動 BPM 推定。毎拍トリガ（beat）と division param で選ぶ分周トリガ（div）、
// bpm/beats/phase の number 出力を持つ。beats を Sine/Noise の t へ繋ぐとビート単位 LFO になる。
// 推定ロジックは beat-clock-logic.ts の純関数（fold＋中央値）、ランタイムは
// AutomationRuntime/TapSequencerRuntime と同じ流儀のクラスで持つ。
import type { NodeState, NodeTypeDef } from "../graph/node-type";
import {
  GAP_RESET_SEC, crossedDivision, divisionToBeats, estimateBpm, recentIntervals,
} from "./beat-clock-logic";

/** onset 由来 BPM の指数平滑係数。onset は間隔が揺れるため推定を鈍らせてガタつきを抑える。 */
const ONSET_SMOOTH = 0.2;

/** タップ/onset 時刻バッファの上限。recentIntervals が見るのは直近ぶんだけなので小さくてよい。 */
const MAX_TIMES = 12;

/** bpm param が不正（非有限・0 以下）だった場合のフォールバック。 */
const FALLBACK_BPM = 120;

/** #270: UI 表示用の状態スナップショット（NodeEditor のステータス行が使う）。 */
export interface BeatClockStatus {
  bpm: number;
  /** 拍内位相 0..1（UI のビートインジケータ用）。 */
  phase: number;
  /** タップ受付中か（直近タップから gap 秒以内・UI 表示用）。 */
  tapActive: boolean;
}

/** step() の戻り値（出力ポート一式）。 */
export interface BeatClockOutputs {
  bpm: number;
  beats: number;
  phase: number;
  beat: boolean;
  div: boolean;
}

/**
 * #270: BeatClock の永続状態。dt 算出は Automation と同じ primed パターン
 * （lastEvalSec=null の初回フレームは dt=0 扱いで誤発火しない）。
 */
export class BeatClockRuntime {
  /** 累積拍数（beats 出力 & 分周判定のベース）。 */
  private beats = 0;
  /** 分周判定の区間始端（このフレームの advance 前の beats。タップスナップ時は一緒に動かす）。 */
  private prevBeats = 0;
  /** dt 算出用の前回評価時刻（初回 step では 0 扱い・Automation と同じ primed パターン）。 */
  private lastEvalSec: number | null = null;
  /** タップ時刻列（ctx.timeSec 系・recentIntervals で管理）。 */
  private tapTimes: number[] = [];
  /** onset 時刻列（同上・タップとは別バッファ。混ざると推定が汚れる）。 */
  private onsetTimes: number[] = [];
  private prevTap = false;
  private prevOnset = false;
  /** TAP ボタンのラッチ（次の step で tap エッジとして消費）。 */
  private pendingTap = false;
  /** onset 推定の指数平滑値（推定が一度も立っていなければ null）。 */
  private smoothedOnsetBpm: number | null = null;
  /** 直近 step の実効 BPM（status 表示用）。 */
  private lastBpm = FALLBACK_BPM;

  /** TAP ボタン（NodeEditor から）。ラッチを立てるだけ。次の step() で tap 入力と同経路で処理。 */
  tapNow(): void {
    this.pendingTap = true;
  }

  /**
   * 1 フレーム分の更新。戻り値は出力ポート一式。
   * - dt を bpm から拍に換算して beats を進める（beats += dt * bpm / 60）。
   * - tap（入力エッジ or pendingTap）: 間隔から BPM 推定 → 推定できたら onCommitBpm。
   *   さらに「タップ＝拍頭」として beats を最も近い整数拍へスナップする（phase を 0 に揃える。
   *   スナップ時は prevBeats も同じだけ動かし、スナップで区間が伸びることによる div 誤発火を防ぐ）。
   * - onset（入力エッジ）: BPM 推定 → 指数平滑 → 有効なら onCommitBpm。phase はいじらない
   *   （onset は間隔が揺れるため位相まで合わせるとガタつく。テンポだけ追従し、拍頭はタップで合わせる運用）。
   * - beat/div トリガ: crossedDivision による半開区間 (prevBeats, beats] の境界判定。
   * onCommitBpm は呼び出し側（evaluate）が params.bpm へ書き戻す（YAML 永続化・スライダー表示に乗る）。
   */
  step(
    bpm: number, tapInput: boolean, onsetInput: boolean, timeSec: number, division: unknown,
    onCommitBpm: (bpm: number) => void,
  ): BeatClockOutputs {
    const dt = this.lastEvalSec === null ? 0 : Math.max(0, timeSec - this.lastEvalSec);
    this.lastEvalSec = timeSec;
    const effBpm = Number.isFinite(bpm) && bpm > 0 ? bpm : FALLBACK_BPM;
    let outBpm = effBpm;

    this.prevBeats = this.beats;
    this.beats += (dt * effBpm) / 60;

    // tap: 入力の立ち上がりエッジ or TAP ボタンのラッチ（同経路で処理）。
    const tapFired = (tapInput && !this.prevTap) || this.pendingTap;
    this.prevTap = tapInput;
    this.pendingTap = false;
    if (tapFired) {
      pushTime(this.tapTimes, timeSec);
      const est = estimateBpm(recentIntervals(this.tapTimes));
      if (est !== null) {
        onCommitBpm(est);
        outBpm = est;
      }
      // タップ＝拍頭: 最も近い整数拍へスナップ。prevBeats も同じだけ動かすことで、
      // このフレームの発火判定区間は「実際に進んだ幅」のまま維持される（div 誤発火防止）。
      const snapped = Math.round(this.beats);
      this.prevBeats += snapped - this.beats;
      this.beats = snapped;
    }

    // onset: テンポのみ追従（位相は動かさない）。
    const onsetFired = onsetInput && !this.prevOnset;
    this.prevOnset = onsetInput;
    if (onsetFired) {
      pushTime(this.onsetTimes, timeSec);
      const est = estimateBpm(recentIntervals(this.onsetTimes));
      if (est !== null) {
        this.smoothedOnsetBpm = this.smoothedOnsetBpm === null
          ? est
          : this.smoothedOnsetBpm + ONSET_SMOOTH * (est - this.smoothedOnsetBpm);
        onCommitBpm(this.smoothedOnsetBpm);
        outBpm = this.smoothedOnsetBpm;
      }
    }

    const beat = crossedDivision(this.prevBeats, this.beats, 1);
    const div = crossedDivision(this.prevBeats, this.beats, divisionToBeats(division));
    this.lastBpm = outBpm;
    return { bpm: outBpm, beats: this.beats, phase: this.phase(), beat, div };
  }

  /** UI 表示用の状態スナップショット。時刻は step が毎フレーム更新する lastEvalSec を使う。 */
  status(): BeatClockStatus {
    const lastTap = this.tapTimes.length > 0 ? this.tapTimes[this.tapTimes.length - 1]! : null;
    return {
      bpm: this.lastBpm,
      phase: this.phase(),
      tapActive: lastTap !== null && this.lastEvalSec !== null
        && this.lastEvalSec - lastTap <= GAP_RESET_SEC,
    };
  }

  /** 拍内位相 0..1。beats は 0 始まりで単調増加（スナップも非負整数）なので floor 差分でよい。 */
  private phase(): number {
    return this.beats - Math.floor(this.beats);
  }
}

/** 時刻バッファへ push し、上限超過分を古い方から捨てる（推定に使うのは直近だけ）。 */
function pushTime(times: number[], t: number): void {
  times.push(t);
  const over = times.length - MAX_TIMES;
  if (over > 0) times.splice(0, over);
}

/** #270: BPM ビートクロック。手動/タップ/onset 推定の 3 系統でテンポを決め、拍・分周トリガを出す。 */
export const BeatClockNode: NodeTypeDef = {
  type: "BeatClock",
  category: "control",
  description: "node.BeatClock.desc",
  beatClock: true,
  inputs: [
    { id: "tap", label: "tap", type: "trigger", description: "node.BeatClock.port.tap" },
    { id: "onset", label: "onset", type: "trigger", description: "node.BeatClock.port.onset" },
  ],
  outputs: [
    { id: "bpm", label: "bpm", type: "number", description: "node.BeatClock.port.bpm" },
    { id: "beats", label: "beats", type: "number", description: "node.BeatClock.port.beats" },
    { id: "phase", label: "phase", type: "number", description: "node.BeatClock.port.phase" },
    { id: "beat", label: "beat", type: "trigger", description: "node.BeatClock.port.beat" },
    { id: "div", label: "div", type: "trigger", description: "node.BeatClock.port.div" },
  ],
  params: [
    // noInput を付けない通常の number param（接続も手動ドラッグも可能・#74 の自動入力ポート化）。
    { id: "bpm", label: "bpm", kind: "number", default: 120, min: 30, max: 300, step: 0.1,
      description: "node.BeatClock.param.bpm" },
    { id: "division", label: "division", kind: "enum", default: "1",
      options: ["1/4", "1/2", "1", "2", "4", "8"],
      description: "node.BeatClock.param.division" },
  ],
  createState: () => new BeatClockRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as BeatClockRuntime | undefined;
    if (!s) return { bpm: FALLBACK_BPM, beats: 0, phase: 0, beat: false, div: false };
    // spread は BeatClockOutputs（interface）→ Record<string, unknown> の型合わせのため。
    return { ...s.step(
      Number(ctx.param("bpm") ?? FALLBACK_BPM),
      Boolean(ctx.input("tap")),
      Boolean(ctx.input("onset")),
      ctx.timeSec,
      ctx.param("division"),
      (v) => {
        // #270: タップ/onset 由来の BPM を params へ書き戻す（Automation の onCommit と同じ流儀＝
        // history 非経由。スライダー表示にも反映され、YAML 永続化にも乗る）。0.1 刻みに丸める。
        ctx.node.params.bpm = Math.round(v * 10) / 10;
      },
    ) };
  },
  disposeState: (_state: NodeState) => { /* no-op（確保資源なし） */ },
};
