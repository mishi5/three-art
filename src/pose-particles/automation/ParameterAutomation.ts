import type { Section, SectionBoundary } from "./AnalysisCache";
import { computeValue, type AutomationEntry, type AutomationMap, type SectionFeatures, type StylePreset } from "./AutomationMap";
import { setByPath } from "./setByPath";

function smoothstep(x: number): number {
  const t = Math.max(0, Math.min(1, x));
  return t * t * (3 - 2 * t);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function lerpFeatures(a: SectionFeatures, b: SectionFeatures, t: number): SectionFeatures {
  return {
    energyNorm: lerp(a.energyNorm, b.energyNorm, t),
    bassAbs:    lerp(a.bassAbs,    b.bassAbs,    t),
    midAbs:     lerp(a.midAbs,     b.midAbs,     t),
    trebleAbs:  lerp(a.trebleAbs,  b.trebleAbs,  t),
  };
}

function asFeatures(s: Section): SectionFeatures {
  return { energyNorm: s.energyNorm, bassAbs: s.bassAbs, midAbs: s.midAbs, trebleAbs: s.trebleAbs };
}

export class ParameterAutomation {
  private readonly entries: ReadonlyArray<AutomationEntry>;
  private readonly styles: ReadonlyArray<StylePreset>;
  private readonly styleStrength: number;

  constructor(
    private readonly sections: Section[],
    private readonly boundaries: SectionBoundary[],
    map: AutomationMap,
    private readonly transitionSec: number,
    styles: ReadonlyArray<StylePreset> = [],
    styleStrength: number = 0,
  ) {
    this.entries = map;
    this.styles = styles;
    this.styleStrength = Math.max(0, Math.min(1, styleStrength));
  }

  /**
   * 再生時刻 t (秒) に対して live Settings を上書きする。
   * 1) t を含むセクションを線形探索 (短い曲なので二分探索は不要、20 セクション程度)
   * 2) セクションの実特徴量に style preset (sectionIndex で循環) を styleStrength
   *    で混ぜる。これで似た特徴量のセクションでも見た目が変わる
   * 3) 境界 ±transitionSec/2 の窓内なら隣接セクションを smoothstep で線形補間
   *    曲頭・曲末は片側のセクションがないので補間しない
   * 4) 補間後の特徴量で AutomationMap を回し、setByPath で値を書き込む
   */
  applyAt(t: number, live: Record<string, unknown>): void {
    if (this.sections.length === 0) return;
    const idx = this.findSectionIndex(t);
    const cur = this.sections[idx]!;
    let features = this.featuresAt(idx);

    if (this.transitionSec > 0 && this.boundaries.length > 0) {
      const halfWin = this.transitionSec / 2;

      // 前のセクションとの境界 = sections[idx].start (idx > 0 のとき)
      if (idx > 0) {
        const bd = cur.start;
        if (Math.abs(t - bd) < halfWin) {
          const prev = this.featuresAt(idx - 1);
          // d=0 (境界の真上) で 0.5、d=halfWin で 1 (= 100% cur)、d=-halfWin で 0 (= 100% prev)
          const u = (t - bd) / this.transitionSec + 0.5; // 0..1
          features = lerpFeatures(prev, features, smoothstep(u));
        }
      }
      // 次のセクションとの境界 = sections[idx].end (idx < length-1 のとき)
      if (idx < this.sections.length - 1) {
        const bd = cur.end;
        if (Math.abs(t - bd) < halfWin) {
          const next = this.featuresAt(idx + 1);
          const u = (t - bd) / this.transitionSec + 0.5;
          features = lerpFeatures(features, next, smoothstep(u));
        }
      }
    }

    for (const e of this.entries) {
      setByPath(live, e.target, computeValue(e, features));
    }

    // Discrete overrides: cur section の style.overrides を直接 setByPath で
    // 上書き (mode/enabled flags 等は連続補間できないので、境界をまたいだ
    // 瞬間に切替される)。styleStrength=0 のときは適用しない。
    if (this.styleStrength > 0 && this.styles.length > 0) {
      const style = this.styles[idx % this.styles.length]!;
      for (const [path, value] of Object.entries(style.overrides)) {
        setByPath(live, path, value);
      }
    }
  }

  /** セクション idx の特徴量を、style preset の features と styleStrength でブレンドして返す。 */
  private featuresAt(idx: number): SectionFeatures {
    const base = asFeatures(this.sections[idx]!);
    if (this.styleStrength <= 0 || this.styles.length === 0) return base;
    const style = this.styles[idx % this.styles.length]!;
    return lerpFeatures(base, style.features, this.styleStrength);
  }

  private findSectionIndex(t: number): number {
    for (let i = 0; i < this.sections.length; i++) {
      const s = this.sections[i]!;
      if (t >= s.start && t < s.end) return i;
    }
    return this.sections.length - 1;
  }
}
