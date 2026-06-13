const MAX_WAVES = 4;

export class OnsetDetector {
  private bassPrev = 0;
  private lastOnsetTime = -Infinity;
  private waves: number[] = [-1, -1, -1, -1];
  private writeIdx = 0;

  update(bass: number, threshold: number, cooldownSec: number, nowSec: number): void {
    const delta = bass - this.bassPrev;
    this.bassPrev = bass;
    if (delta > threshold && nowSec - this.lastOnsetTime > cooldownSec) {
      this.waves[this.writeIdx] = nowSec;
      this.writeIdx = (this.writeIdx + 1) % MAX_WAVES;
      this.lastOnsetTime = nowSec;
    }
  }

  getWaveTimes(): readonly number[] {
    return this.waves;
  }

  /** 直近に onset が発火した時刻（秒）。未発火なら -Infinity。 */
  getLastOnsetTime(): number {
    return this.lastOnsetTime;
  }

  reset(): void {
    this.bassPrev = 0;
    this.lastOnsetTime = -Infinity;
    this.writeIdx = 0;
    for (let i = 0; i < MAX_WAVES; i++) this.waves[i] = -1;
  }
}
