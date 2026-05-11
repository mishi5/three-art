# lattice 描画モード (bass トリガー shockwave) 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/14
- 作成日: 2026-05-11
- ブランチ: feature/14-lattice-mode

## 概要

新しい描画モード `lattice` を `RenderMode` の 4 つ目として追加する。

立方体ボリューム内の N×N×N の厳密格子に粒子を配置し、bass の onset を検出して中心から外向きの単発 shockwave を走らせる。粒子は波が到達したタイミングで弾性的にキックされ、振動しながら格子位置へ復帰する。

既存 3 モード (bones / cube / sphere) は「点クラスタ」「shell 系」のいずれかだったため、`lattice` は「体積を埋める格子 + 衝撃波」という未踏のカテゴリを足す位置づけ。

## ブレストで確定した方向性

| 観点 | 決定 |
|------|------|
| 格子の性格 | 厳密格子 (axis-aligned NxNxN、軸が見える人工物感) |
| 波の発生 | bass トリガーの単発 shockwave (onset 検出ベース、波と波の間は静止) |
| 粒子の戻り方 | 弾性 (sin × exp 減衰でオーバーシュートしながら格子位置へ復帰) |
| 波の同時発火 | 直近 4 個まで加算合成 |
| 状態管理 | ステートレス shader (FBO ping-pong 不要、純関数で displacement 計算) |

## アーキテクチャ

### 1. 全体像

- `RenderMode` を 4 値に拡張 (`"bones" | "cube" | "sphere" | "lattice"`)
- `modeToInt(lattice) = 3`、shader の `uMode` 分岐に新 branch を追加
- 既存の twist / outlier / shimmer / hue / blur / motion target は共通処理として lattice にもかかる
- `EdgeOverlay` は lattice 時に描画スキップ (規則格子の k-NN は美麗でないため)
- Auto モードの `STYLE_PRESETS` への lattice エントリ追加は本 Issue のスコープ外 (Phase 2)

### 2. 格子ジオメトリ

粒子総数 = NUM_JOINTS (13) × POINTS_PER_JOINT (400) = 5200 個 (現状維持)。

新規 attribute `aIndex: float` (0..total-1) を BufferGeometry に追加。CPU 側で `i = j * POINTS_PER_JOINT + p` を Float32Array に書く (~20KB)。lattice 以外のモードでは未使用。

shader 内で格子マッピング:

```glsl
int idx = int(aIndex + 0.5);
int N = int(uLatticeN + 0.5);
int N3 = N * N * N;
if (idx >= N3) {
  visAlpha = 0.0;
  pos = vec3(0.0);
} else {
  int ix = idx % N;
  int iy = (idx / N) % N;
  int iz = idx / (N * N);
  vec3 cell = vec3(float(ix), float(iy), float(iz));
  float cellSize = uShapeRadius * 2.0 / max(float(N - 1), 1.0);
  vec3 latticePos = (cell - vec3(float(N - 1) * 0.5)) * cellSize;
  // shockwave displacement を加算 (Section 4)
}
```

- `shape.radius` を立方体の half-extent として流用 (cube モードと一致)
- N 範囲 8..17、デフォルト 12 (1728 粒子表示)
- N=17 で 5200 を超えた余り 287 粒子は visAlpha=0 で非表示

### 3. onset 検出

新規モジュール `src/pose-particles/audio/OnsetDetector.ts`。微分ベース + クールダウン + ring buffer。

```ts
class OnsetDetector {
  private bassPrev = 0;
  private lastOnsetTime = -Infinity;
  private waves = [-1, -1, -1, -1];
  private writeIdx = 0;

  update(bass: number, threshold: number, cooldownSec: number, nowSec: number): void {
    const delta = bass - this.bassPrev;
    this.bassPrev = bass;
    if (delta > threshold && nowSec - this.lastOnsetTime > cooldownSec) {
      this.waves[this.writeIdx] = nowSec;
      this.writeIdx = (this.writeIdx + 1) % 4;
      this.lastOnsetTime = nowSec;
    }
  }

  getWaveTimes(): readonly number[] { return this.waves; }
  reset(): void { /* used on song change */ }
}
```

- `threshold` は「1 フレームの bass 増分」のしきい値
- `cooldown` は連打防止 (デフォルト 0.12 秒)
- `App.ts` の既存ループで `audio.read()` 直後に `update()` を呼ぶ
- `pointCloud.setWaveTimes(detector.getWaveTimes())` で uniform 反映
- 時刻基準は既存の `performance.now() / 1000` を継続使用 (`uTime` と一致)

### 4. shader displacement

新規 uniform:

```glsl
uniform float uLatticeN;
uniform float uWaveTimes[4];
uniform float uWaveSpeed;
uniform float uWaveAmplitude;
uniform float uWaveOscFreq;
uniform float uWaveDamping;
```

displacement 計算 (lattice branch 内):

```glsl
float r = length(latticePos);
vec3 outwardDir = normalize(latticePos + vec3(1e-5));
float totalDisp = 0.0;
for (int i = 0; i < 4; i++) {
  float t0 = uWaveTimes[i];
  if (t0 < 0.0) continue;
  float waveAge = (uTime - t0) - r / uWaveSpeed;
  if (waveAge < 0.0) continue;
  float env = exp(-waveAge / uWaveDamping);
  float osc = sin(waveAge * uWaveOscFreq * 6.2831853);
  totalDisp += uWaveAmplitude * env * osc;
}
pos = latticePos + outwardDir * totalDisp;
pos += outwardDir * shimmer;
visAlpha = 0.85;
```

- 静的ループ境界 4 で WebGL1/2 とも安全 (threejs-art skill の dynamic uniform array indexing トラップ回避)
- `uWaveTimes[i]` は固定インデックス参照
- ステートレス: 全粒子が同じ uniform 群から自分の displacement を計算
- 弾性: `exp(-waveAge/τ) * sin(2πf·waveAge)` で振動 + 減衰
- 中心粒子は波が即時到達、遠い粒子は到達遅延 → 中心から外向きに伝播する波面

### 5. settings / UI

`Settings.lattice` 新設:

```ts
export interface LatticeSettings {
  /** 格子解像度 NxNxN。8..17 */
  resolution: number;
  /** 波速度 (m/s)。0.5..3.0 */
  waveSpeed: number;
  /** 弾性振動の最大変位 (m)。0..0.5 */
  waveAmplitude: number;
  /** 振動周波数 (Hz)。1..10 */
  waveOscFreq: number;
  /** 減衰時定数 (sec)。0.1..1.5 */
  waveDamping: number;
  /** onset しきい値 (1 フレームの bass 増分)。0.02..0.5 */
  onsetThreshold: number;
  /** onset クールダウン (sec)。0.05..0.5 */
  onsetCooldown: number;
}
```

デフォルト値:

```ts
lattice: {
  resolution: 12,
  waveSpeed: 1.2,
  waveAmplitude: 0.15,
  waveOscFreq: 4.0,
  waveDamping: 0.4,
  onsetThreshold: 0.15,
  onsetCooldown: 0.12,
}
```

- `MOTION_TARGETS` に `"lattice.waveAmplitude"` / `"lattice.waveOscFreq"` を追加
- `SettingsPanel` の mode dropdown は `RENDER_MODES` を流用しているので自動反映
- 新フォルダ `Lattice` に 7 つの slider を追加
- localStorage migration は不要 (既存 deepMerge で defaults から自動補完)

## テスト計画

1. `audio/OnsetDetector.test.ts` (新規)
   - 単調増加で 1 回だけ発火
   - threshold 以下では発火しない
   - cooldown 内の 2 回目は無視
   - 5 回目以降で ring buffer の古い値が上書きされる
   - reset で全 wave クリア

2. `settings.test.ts` (既存または新規)
   - `RENDER_MODES.length === 4`
   - `modeToInt("lattice") === 3`
   - `makeDefaultSettings().lattice.resolution === 12` 等
   - 旧 snapshot に lattice キーが deepMerge で補完される

3. shader 側は GPU ロジックのためユニットテスト不可 → 目視で確認

4. 既存 107 件は全パス維持

## 実装順序

| # | 内容 | テスト |
|---|------|--------|
| 1 | RenderMode 拡張 + modeToInt + LatticeSettings + defaults + MOTION_TARGETS | settings.test.ts |
| 2 | aIndex attribute + shader に lattice 静的格子分岐 + uLatticeN uniform | (目視) |
| 3 | OnsetDetector 実装 | OnsetDetector.test.ts |
| 4 | shader shockwave displacement + uWave* uniform + App.ts 統合 | (目視) |
| 5 | EdgeOverlay の lattice ガード | EdgeOverlay.test.ts |
| 6 | SettingsPanel: mode dropdown + Lattice フォルダ | (目視) |
| 7 | 全テスト実行 + 既存モード回帰目視 | bun test |

## 動作確認シナリオ (PR 後)

- bones / cube / sphere の挙動が変わっていない
- lattice に切り替えると厳密格子が見える
- bass の効いた曲で shockwave が中心から伝播し、粒子が振動して戻る
- 連打しても 4 波が並走して破綻しない
- twist / blur / outlier / motion target が lattice で機能する
- EdgeOverlay は lattice 時に表示されない
