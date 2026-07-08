// #186: Automation（param 軌跡の記録/ループ再生ノード）の純粋ロジック。
// 記録バッファの扱いは #217 GraphVisual の pushSample を、状態遷移は #204 TapSequencer の
// idle→recording→playing 状態機械を参考にする。DOM/時計に依存しない純関数のみを置く
// （状態機械そのものは AutomationNode.ts の AutomationRuntime が持つ）。

/** 状態機械のフェーズ。idle（未記録）→ recording（記録中）→ playing（ループ再生中）。 */
export type AutomationPhase = "idle" | "recording" | "playing";

/** ループ再生モード。once=末尾で停止 / loop=先頭へラップ / pingpong=往復。 */
export type LoopMode = "once" | "loop" | "pingpong";

/** 記録 1 フレーム（録音開始からの相対秒 t と、その時刻の入力値 v）。t 昇順を前提にする。 */
export interface AutomationFrame {
  t: number;
  v: number;
}

/**
 * arm トリガの立ち上がりエッジ判定と、それに応じた暫定フェーズ遷移。
 * - idle/playing で立ち上がり → recording へ（playing からの場合は前の記録を破棄して新規記録＝
 *   #204 TapSequencer と同じ「再 arm で上書き」挙動。実際の破棄は呼び出し側 Runtime が行う）。
 * - recording で立ち上がり → 録音終了。ここでは暫定的に "playing" を返すのみで、
 *   frames が空（0 フレーム）だった場合に "idle" へ戻すかは呼び出し側 Runtime が
 *   記録データを見て決める（#204 finalizeRecording のタップ 0 回ガードと同じ位置づけ）。
 * - 立ち上がりが無ければ phase をそのまま返す。
 */
export function armToggle(
  prevArm: boolean, curArm: boolean, phase: AutomationPhase,
): AutomationPhase {
  if (!(curArm && !prevArm)) return phase;
  return phase === "recording" ? "playing" : "recording";
}

/**
 * リングバッファへ 1 フレーム push し、上限超過分を古い方から捨てる（in-place・#217 pushSample 相当）。
 * 非有限値（NaN/Infinity）は 0 に丸める（未接続や壊れた入力での破綻回避）。
 */
export function pushFrame(
  frames: AutomationFrame[], t: number, v: number, maxFrames: number,
): void {
  const value = Number.isFinite(v) ? v : 0;
  frames.push({ t, v: value });
  const limit = Math.max(1, Math.floor(maxFrames));
  const over = frames.length - limit;
  if (over > 0) frames.splice(0, over);
}

/**
 * 記録列 frames（t 昇順を仮定）と時刻 t から値を線形補間する。
 * - 0 件は 0
 * - 1 件はその値（t によらず一定）
 * - 範囲外（t<=先頭 / t>=末尾）は端の値にクランプ
 * - 2 点間は線形補間
 */
export function sampleAt(frames: readonly AutomationFrame[], t: number): number {
  const n = frames.length;
  if (n === 0) return 0;
  const first = frames[0]!;
  if (n === 1) return first.v;
  const last = frames[n - 1]!;
  if (t <= first.t) return first.v;
  if (t >= last.t) return last.v;
  for (let i = 1; i < n; i++) {
    const a = frames[i - 1]!;
    const b = frames[i]!;
    if (t <= b.t) {
      const span = b.t - a.t;
      if (span <= 0) return b.v; // 同時刻フレーム（span=0）は後方の値を採用
      const ratio = (t - a.t) / span;
      return a.v + (b.v - a.v) * ratio;
    }
  }
  return last.v; // 到達しない防御（t< last.t の分岐で必ず return するはず）
}

/**
 * playhead（録音開始相当の経過秒を dtSec*speed で積み上げた累積値）を 1 フレーム分進める。
 * loop/pingpong は wrap/往復への変換を行わず加算し続ける（pingpong の往復方向を
 * playhead の値だけから一意に復元できないため。実際のサンプリング位置は loopPosition が担う）。
 * once は [0, loopLenSec] にクランプして末尾で停止する。
 * loopLenSec<=0・非有限は 0（再生対象がない）。dtSec/speed が非有限なら現在値を維持する。
 */
export function advancePlayhead(
  playhead: number, dtSec: number, loopLenSec: number, loopMode: LoopMode, speed: number,
): number {
  if (!Number.isFinite(loopLenSec) || loopLenSec <= 0) return 0;
  if (!Number.isFinite(dtSec) || !Number.isFinite(speed)) return playhead;
  const next = playhead + dtSec * speed;
  if (loopMode === "once") return Math.max(0, Math.min(loopLenSec, next));
  return next;
}

/**
 * 累積 playhead → ループ内サンプリング位置 [0, loopLenSec]（sampleAt にそのまま渡せる時刻）。
 * - loop: modulo wrap（負値も正しく [0, L) へ wrap）
 * - pingpong: 周期 2*loopLenSec の三角波（0→L→0→L→…）
 * - once: [0, loopLenSec] にクランプ（advancePlayhead で既にクランプ済みだが防御的に再クランプ）
 * loopLenSec<=0・非有限は 0。
 */
export function loopPosition(playhead: number, loopLenSec: number, loopMode: LoopMode): number {
  if (!Number.isFinite(loopLenSec) || loopLenSec <= 0) return 0;
  if (loopMode === "once") return Math.max(0, Math.min(loopLenSec, playhead));
  const period = loopMode === "pingpong" ? loopLenSec * 2 : loopLenSec;
  const p = wrapMod(playhead, period);
  if (loopMode === "loop") return p;
  return p > loopLenSec ? period - p : p; // pingpong: L を超えた分は折り返す
}

/**
 * x を [0, L) に wrap する。非負の x には % をそのまま使い、負のときだけ L を足す
 * （#204 tap-sequencer-logic の wrapMod と同じ理由: `((x % L) + L) % L` は float 誤差が乗るため使わない）。
 */
function wrapMod(x: number, L: number): number {
  const m = x % L;
  return m < 0 ? m + L : m;
}

/**
 * YAML から読み込んだ params.recordedFrames（unknown・改ざん/旧形式の可能性がある）を
 * 安全な AutomationFrame[] へ検証・変換する。t/v とも有限数値の要素だけ採用し、t 昇順に整列する
 * （sampleAt/pushFrame は t 昇順を前提にするため）。
 */
export function sanitizeFrames(raw: unknown): AutomationFrame[] {
  if (!Array.isArray(raw)) return [];
  const out: AutomationFrame[] = [];
  for (const item of raw) {
    if (typeof item !== "object" || item === null) continue;
    const t = (item as { t?: unknown }).t;
    const v = (item as { v?: unknown }).v;
    if (typeof t === "number" && Number.isFinite(t) && typeof v === "number" && Number.isFinite(v)) {
      out.push({ t, v });
    }
  }
  out.sort((a, b) => a.t - b.t);
  return out;
}
