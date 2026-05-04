export interface BlurSettings {
  enabled: boolean;
  strength: number;
  iterations: number;
  bassDrive: number;
}

export const MAX_BLUR_ITERATIONS = 6;

export function makeDefaultBlur(): BlurSettings {
  return {
    enabled: false,
    strength: 4.0,
    iterations: 2,
    bassDrive: 0.0,
  };
}

export function effectiveBlurStrength(b: BlurSettings, bass: number): number {
  if (!b.enabled) return 0;
  return b.strength * (1 + bass * b.bassDrive);
}

export function applyMotionToBlur(b: BlurSettings, factor: number): void {
  b.strength *= factor;
}
