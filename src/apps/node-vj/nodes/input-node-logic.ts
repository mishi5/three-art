// 入力ノードの純粋ロジック（テスト可能に分離）。
import type { SectionBoundary } from "../../../core/audio/analysis-types";

/**
 * 再生時刻 t における現在 section index。
 * boundaries は分割点。t 以下の境界数が index（先頭区間=0）。
 * boundaries が空なら 0。
 */
export function sectionIndexAt(boundaries: SectionBoundary[], t: number): number {
  let idx = 0;
  for (const b of boundaries) {
    if (b.t <= t) idx++;
    else break;
  }
  return idx;
}
