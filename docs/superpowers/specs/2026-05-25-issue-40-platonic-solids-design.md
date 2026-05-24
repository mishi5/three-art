# Issue #40: cube モードを正多面体 (4/6/8/12) から選択可能にする

- 対象 Issue: https://github.com/mishi5/three-art/issues/40
- 作品: pose-particles

## 背景

現状の `cube` モード (`src/pose-particles/visuals/PointCloud.ts`, `uMode < 1.5` ブロック) は「軸合わせの立方体 = 正六面体」表面に粒子を一様分布させる固定実装。これを正多面体 (Platonic solid) の種類を選択可能にする。

## スコープ

### 含む
- `cube` モード時に **4 面 (正四面体) / 6 面 (正六面体) / 8 面 (正八面体) / 12 面 (正十二面体)** を選択可能にする
- SettingsPanel に `polyhedron` セレクタを追加
- ランダム化対象 (cube モード時)
- relevance / docs / 既存テスト整合
- `shape.radius` を「外接球半径 (中心 → 頂点距離)」に統一する semantics 変更 (cube は √3 倍小さく見える)

### 含まない
- 正二十面体 (20 面)
- 球面細分による任意面数指定
- 他モード (sphere/lattice/image/rain) の挙動変更

## 設計

### settings 拡張 (`src/pose-particles/settings.ts`)

```ts
export type PolyhedronFaces = 4 | 6 | 8 | 12;
export const POLYHEDRON_FACES: ReadonlyArray<PolyhedronFaces> = [4, 6, 8, 12];

export interface Settings {
  // ...
  shape: {
    radius: number;
    bassPulse: number;
    polyhedron: PolyhedronFaces;  // 新規 / default 6
  };
}
```

`makeDefaultSettings()` で `polyhedron: 6` を入れる。`deepMerge` が古い localStorage snapshot に default を埋めるため、`migrate()` への追加なし・後方互換 OK。

### shader 実装 (`PointCloud.ts`)

#### uniform 追加
```glsl
uniform float uPolyhedron;  // 4 | 6 | 8 | 12
```
JS 側 default: `uPolyhedron: { value: 6.0 }`。`update()` で `u.uPolyhedron!.value = settings.shape.polyhedron`。

#### radius 解釈の変更 (外接球半径で統一)
- 現状 cube: `cubePos`∈[±1]³ (頂点距離 √3) × `scale = uShapeRadius` → 「半辺長 = R」
- 新仕様: 全多面体・sphere で「頂点距離 = R」に統一
- 各 sample 関数は **外接球半径 1 の単位多面体上の点** を返す。caller 側 scale は `uShapeRadius * (1 + uBass * uShapeBassPulse) * outlier`
- 既存 cube の見た目変化: 同 radius 値で粒子クラウドが √3 ≒ 1.73 倍小さく見える。CHANGELOG / param-docs / Issue クローズコメントで明示

#### cube モードブロック構造
```glsl
} else if (uMode < 1.5) {
  // cube モード: 正多面体表面サンプリング
  float faceHash = fract(aSeed * 13.717 + aJointIndex * 0.41);
  vec3 r = hash3unit(aSeed * 7.0 + aJointIndex + 1.0);
  vec3 unit;
  if (uPolyhedron < 5.0) {
    unit = sampleTetrahedron(faceHash, r.xy);
  } else if (uPolyhedron < 7.0) {
    unit = sampleCube(faceHash, r.xy);
  } else if (uPolyhedron < 10.0) {
    unit = sampleOctahedron(faceHash, r.xy);
  } else {
    unit = sampleDodecahedron(faceHash, r.xyz);
  }
  float scale = uShapeRadius * (1.0 + uBass * uShapeBassPulse) * outlier;
  pos = unit * scale + normalize(unit + 0.0001) * shimmer;
  visAlpha = 0.85;
}
```

#### sample 関数群 (vertex shader 上部)

- **`sampleTetrahedron(faceHash, r2)`**: 4 頂点 `(±1,±1,±1)` (偶数個マイナス) を `1/sqrt(3)` で正規化。4 面を faceHash で 4 分割、`(1-√r1)A + √r1(1-r2)B + √r1·r2·C` で重心一様サンプリング
- **`sampleCube(faceHash, r2)`**: 既存 6 面ロジック流用。返り値を `1/sqrt(3)` で正規化 (外接球半径 1 に揃える)
- **`sampleOctahedron(faceHash, r2)`**: 6 頂点 `(±1,0,0),(0,±1,0),(0,0,±1)` (既に外接球半径 1)。8 面を faceHash で 8 分割、各面 3 頂点で重心サンプリング
- **`sampleDodecahedron(faceHash, r3)`**: 12 五角形面。各面を「中心 + 隣接 2 頂点」のファン 5 三角形に分割し、`r.z` でファン三角形抽選 → `r.xy` で重心サンプリング。φ=(1+√5)/2 を使った標準座標を外接球半径 √3 で割って正規化 (`const vec3` ハードコード = 12 中心 + 60 リング頂点)

WebGL1 互換性: 全ての座標は `const vec3` リテラル + cascaded if/else で参照。動的 uniform 配列 index は使わない (lattice モードと同じ流儀)。

### UI (`SettingsPanel.ts`)

`Shape (cube / sphere)` フォルダに追加:
```ts
shape.add(settings.shape, "polyhedron", {
  "4 (tetrahedron)": 4,
  "6 (cube)": 6,
  "8 (octahedron)": 8,
  "12 (dodecahedron)": 12,
}).name("polyhedron faces");
```
ライブ反映: PointCloud.update が uniform を毎フレーム読むため onChange ハンドラ不要。

### relevance (`param-relevance.ts`)
```ts
"shape.polyhedron": new Set(["cube"]),
```
`shape.radius` / `shape.bassPulse` は既存通り PARTICLE (EdgeOverlay が radius を参照するため)。

### randomize (`randomize.ts`)
- 新種別 `numEnum` を追加 (数値配列から一様抽選):
  ```ts
  type RandSpec = ... | { path: string; kind: "numEnum"; options: ReadonlyArray<number> };
  function numEnm(path, options, modes) { ... }
  ```
- ランダム化 switch に `numEnum` ケース追加
- descriptor 追加:
  ```ts
  const CUBE: ReadonlyArray<RenderMode> = ["cube"];
  numEnm("shape.polyhedron", [4, 6, 8, 12], CUBE),
  ```

### docs (`param-docs.ts`)
```ts
"shape.polyhedron": {
  summary: "cube モードの正多面体面数 (4=正四面体 / 6=正六面体 / 8=正八面体 / 12=正十二面体)。",
  effect: "面数を変えると粒子表面の形状が切り替わる。cube モード以外では効果なし。",
},
```

## テスト計画 (TDD)

### 新規テスト (Bun でテスト可能なもの)

**`settings.test.ts`**
- `makeDefaultSettings().shape.polyhedron === 6`
- 古い localStorage snapshot (polyhedron キー無し) を `loadSettings()` → polyhedron が 6 で埋まる

**`param-relevance.test.ts`**
- `paramActiveForMode("shape.polyhedron", "cube") === true`
- 他全 mode (bones/sphere/lattice/image/rain) で `false`

**`randomize.test.ts`**
- cube モードのケースで `paths.toContain("shape.polyhedron")`
- 他モードで `not.toContain("shape.polyhedron")`
- `numEnum` 種別の動作: 実行後の `settings.shape.polyhedron` が `[4, 6, 8, 12]` のいずれか (数値型)

### 手動 QA (shader / WebGL 範囲、PR の Test plan)
- cube + polyhedron=4/6/8/12 でそれぞれ表面に粒子が分布する
- 同 radius 値で cube が従来より √3 倍小さく見えることを確認 (新 semantics)
- bass で pulse、shimmer 反映
- randomize で polyhedron 値が変わる (cube モード時のみ)
- 他 mode では shape.polyhedron が disable 表示

## 実装順序

1. settings.ts: `PolyhedronFaces` 型 + field 追加 → settings.test.ts 拡張
2. param-relevance.ts → param-relevance.test.ts 拡張
3. randomize.ts: `numEnum` 種別 + descriptor 追加 → randomize.test.ts 拡張
4. param-docs.ts: docs 追加
5. PointCloud.ts: uniform 追加 + cube ブロック多面体化 + sample 関数群 + radius scale 調整
6. SettingsPanel.ts: polyhedron セレクタ追加
7. 全テスト + 型チェック + ブラウザ動作確認
8. PR (タイトル `#40 feature: cube モードを正多面体 (4/6/8/12) から選択可能に`、本文に Issue URL、`Closes #40` は書かない)
9. main コンフリクトチェック → ユーザ動作確認 → マージ → Issue クローズ

## 後方互換と移行

- `shape.polyhedron` キー追加だけなので localStorage 互換性は deepMerge で自動担保
- **non-trivial な動作変化**: `shape.radius` の semantics 変更 (cube が √3 倍小さく見える)。設定値そのものは保持されるが見た目が変わる。設定変更ガイドとして Issue クローズコメントに記載
