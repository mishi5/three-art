// 共有 post-effect モジュールの入力パラメータ型。
// 設計方針は core/visuals/params.ts と同じ（core は Settings を import しない）。

import type { BlurSettings } from "../visuals/blur";

export interface KaleidoscopeParams {
  enabled: boolean;
  segments: number;
  centerX: number;
  centerY: number;
  rotation: number;
  mix: number;
}

export interface FractalParams {
  enabled: boolean;
  iterations: number;
  scale: number;
  centerX: number;
  centerY: number;
  rotation: number;
  fade: number;
  mix: number;
}

export interface PostOrderParams {
  /** post effect の適用順。effect ID の配列。 */
  order: string[];
  kaleidoscope: KaleidoscopeParams;
  fractal: FractalParams;
}

/** PostPipeline / 各 PostEffect の update() が受け取る合成パラメータ。 */
export interface PostUpdateParams {
  post: PostOrderParams;
  blur: BlurSettings;
}
