import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { Settings } from "../../settings";

/** SmoothedAudio: 全 effect 共通の音声特徴量 (App.ts の private 型と一致)。 */
export interface SmoothedAudio {
  volume: number;
  bass: number;
  mid: number;
  treble: number;
}

/**
 * post パイプラインに直列接続される 1 エフェクト部品。
 *
 * 設計方針: 各 effect は自分の ShaderPass を所有し、毎フレーム settings/audio から
 * uniform を更新する。サムネ用に「同じ設定で targetW×targetH の RT 上で動く独立
 * pass 列」を返せる契約を持つ。これにより PostPipeline 全体に対しても同じ契約が
 * 自然に派生する (各 effect の createPassesForTarget を集めて返すだけ)。
 */
export interface PostEffect {
  /** 一意な ID (settings.post.order の要素と一致)。 */
  readonly id: string;

  /** 本番 EffectComposer に追加する ShaderPass 列。 */
  readonly passes: ShaderPass[];

  /** 毎フレーム呼ばれる。enabled / パラメータ → uniform 反映。 */
  update(settings: Settings, audio: SmoothedAudio): void;

  /** リサイズ通知。texel 依存 effect (blur) と aspect 依存 effect (kaleidoscope) が利用。 */
  setSize(w: number, h: number, dpr: number): void;

  /**
   * サムネ用に「現在の設定を targetW×targetH の RT 上で再現する独立 pass 列」を返す。
   * - blur: absolute px パラメータを fullSourceW/targetW でスケール補正
   * - kaleidoscope/fractal: UV (0..1) のみで完結するため fullSourceW は不要 (ただし interface は揃える)
   * enabled でない / 効果が無い (mix=0 等) なら空配列。
   * 呼び出し側で dispose 必須。
   */
  createPassesForTarget(targetW: number, targetH: number, fullSourceW: number): ShaderPass[];

  dispose(): void;
}
