# Pose × Audio Particle Art — 設計仕様

**日付**: 2026-04-29
**ステータス**: 設計確定（実装計画前）

## コンセプト

モノクロームの 3D 空間で、観る人の体の動きと音楽が織りなす抽象的な点群作品。

- **入力**：Webcam（ポーズ検出）＋ 音源（楽曲ファイルまたはマイク、切替可能）
- **出力**：黒背景の 3D 空間に浮かぶ点群と漂う細片
- **抽象化**：観る人の身体は画面に描画されない。13 関節の 3D 座標だけがデータとして空間に存在し、その周りに視覚要素が結晶化する
- **美学**：モノクローム、点と線、密度と緊張感（ムードボード由来）

### Audio → Visual のマッピング

| 音響特徴 | 周波数帯 | 視覚パラメータ |
|---|---|---|
| `uVolume` | 全体 | 全体輝度、細片の可視率 |
| `uBass` | 60〜250Hz | 関節点群のガウス半径（脈動） |
| `uMid` | 250〜2000Hz | 細片の乱気流強度 |
| `uTreble` | 2〜8kHz | 個々の点のシマー（sparkle） |

### Pose → Visual のマッピング

- MediaPipe の `worldLandmarks`（メートル単位 3D）から以下の 13 関節を抽出（MediaPipe Pose の標準ランドマーク番号）：
  - 鼻 (`0`)
  - 左肩 (`11`)、右肩 (`12`)
  - 左肘 (`13`)、右肘 (`14`)
  - 左手首 (`15`)、右手首 (`16`)
  - 左股関節 (`23`)、右股関節 (`24`)
  - 左膝 (`25`)、右膝 (`26`)
  - 左足首 (`27`)、右足首 (`28`)
- `JointAnchors` モジュールで平滑化したものを `uJoints[13]` uniform として直接渡す
- 観る人の生映像はキャンバスに表示しない（抽象化を貫徹）

## アーキテクチャ

7 つのモジュールで構成。各モジュールは単機能で、明示的なインターフェースで通信する。

```
                         ┌─────────────┐
       Webcam ──────────▶│ PoseInput   │──┐
                         └─────────────┘  │ landmarks
                                          ▼
                         ┌─────────────────────┐
                         │ JointAnchors        │  3D 関節位置を平滑化・正規化
                         └─────────┬───────────┘
                                   │ smoothedJoints[13]
       ┌─────────────┐             │
File ─▶│ AudioInput  │──┐          ├──▶ ┌──────────────┐
Mic ──▶│ (switchable)│  │ features │    │ PointCloud   │  関節周りの局所点群
       └─────────────┘  │          │    └──────────────┘
                        │          │
                        ▼          ▼
                       ┌──────────────────┐
                       │ FragmentField    │  空間全体の漂う細片
                       └──────────────────┘
                                │
                                ▼
                        ┌──────────────┐
                        │ Renderer     │  Three.js scene → canvas
                        └──────────────┘
                                ▲
                        ┌──────┴──────┐
                        │ UI          │  ソース切替・ファイル選択
                        └─────────────┘
```

### モジュール責務

| モジュール | 入力 | 出力 | 責務 |
|---|---|---|---|
| `AudioInput` | ファイルまたはマイク | `AudioFeatures`（volume, bass, mid, treble, fft） | 音源を抽象化、FFT 解析 |
| `PoseInput` | Webcam stream | 生のランドマーク（33点 3D） | MediaPipe ラッパー |
| `JointAnchors` | 生ランドマーク | 平滑化済み 13 関節（シーン座標） | 抽出・平滑化・座標変換 |
| `PointCloud` | joints, audio features | `THREE.Object3D` | 関節アンカー周りの点群（ShaderMaterial） |
| `FragmentField` | joints, audio features | `THREE.Object3D` | 空間を漂う細片（ShaderMaterial） |
| `UI` | ユーザー操作 | コマンド | 開始オーバーレイ・ソース切替・ファイル選択 |
| `App` | — | — | scene/camera/renderer、毎フレームの更新ループ |

### 毎フレームの流れ

1. `PoseInput` が最新ポーズ結果を返す（MediaPipe は ~30Hz、レンダは 60Hz）
2. `JointAnchors` が前フレームから最新へ lerp で平滑化
3. `AudioInput` から現在の `AudioFeatures` を取得
4. `PointCloud.update(joints, audio)` — uniform を更新
5. `FragmentField.update(joints, audio)` — uniform を更新
6. `renderer.render(scene, camera)`

## ビジュアル設計の具体

### PointCloud（関節周りの局所点群）

- 13 関節 × 約 400 点 = 約 5,000 点
- 各点は所属する関節 ID を attribute として持ち、vertex shader で `uJoints[joint_id]` を参照
- 関節中心からのオフセットは 3D ガウス分布（σ ≈ 8cm）でサンプリング → 関節周りに薄い「霧」のような塊が生まれる
- 音楽による変調：
  - `uBass` → ガウス半径が膨張・収縮（脈動）
  - `uTreble` → 個々の点のチカチカ（時間ベースのノイズで sparkle）
- 描画：白〜薄灰の柔らかい丸（fragment shader で `smoothstep` の円形）、加算ブレンド

### FragmentField（空間を漂う細片）

- 約 10,000 個、3m × 3m × 3m の領域に分散配置
- 動きはシェーダー内で決定論的に計算（CPU 物理は使わない）：
  - 基本軌道：curl noise（位置 + 時間）で滑らかに漂う
  - 重力：13 関節からの逆二乗合力で位置を変位（vertex shader 内で計算）
  - 音楽による turbulence：`uMid` が強いほど curl noise の振幅増
- 描画：細い線分風（楕円ポイントスプライト、速度方向に伸びる）、灰〜白

### シーン構成

- 背景：純黒 `0x000000`
- カメラ：透視投影、FOV 50°、関節領域から 2.5m 後退、**MVP では静止**
- 世界座標：関節領域は ±1.5m × ±1m × ±0.5m に正規化
- ライト：なし（全部 ShaderMaterial で発光）
- ポストエフェクト：MVP ではスキップ（後で `UnrealBloomPass` を足すと光が滲む効果が乗る）

### モノクローム維持の方針

- すべての色は `vec3(white_amount)` の単一スカラから生成（白〜灰）
- Fragment shader で意図的に色相を切らない（後の拡張で青寄り tint を 0.05 程度足すのは可）

## ツールチェーン

**Bun** をランタイム・パッケージマネージャ・バンドラ・テストランナーとして全て担当させる（Vite を使わない）：

- **開発サーバ**：`bun ./index.html` — Bun 1.2+ のフルスタックサーバが HTML をエントリにして TypeScript / GLSL のバンドルと HMR を担う
- **本番ビルド**：`bun build ./index.html --outdir dist`
- **パッケージ管理**：`bun install`
- **テスト**：`bun test`（Vitest 互換 API、Vitest は使わない）

設定ファイルは最小限：`bunfig.toml` は不要なら作らない。

## プロジェクト構造

```
three-art/
├── index.html             # Bun のエントリ。<script type="module" src="/src/main.ts">
├── package.json
├── tsconfig.json
├── .gitignore
├── public/
│   └── audio/
│       └── sample.mp3
└── src/
    ├── main.ts
    ├── App.ts
    ├── types.ts
    ├── audio/
    │   ├── AudioInput.ts        # インターフェース
    │   ├── FileAudioSource.ts
    │   ├── MicAudioSource.ts
    │   └── AudioAnalyzer.ts
    ├── pose/
    │   ├── PoseInput.ts
    │   └── JointAnchors.ts
    ├── visuals/
    │   ├── PointCloud.ts
    │   ├── FragmentField.ts
    │   └── shaders/
    │       ├── pointCloud.vert.glsl
    │       ├── pointCloud.frag.glsl
    │       ├── fragmentField.vert.glsl
    │       └── fragmentField.frag.glsl
    └── ui/
        └── UI.ts
```

## 依存パッケージ

| パッケージ | 用途 |
|---|---|
| `three` | コア |
| `@mediapipe/tasks-vision` | ポーズ検出（Tasks API） |
| `typescript` | 型 |
| `@types/three` | 型定義 |
| `@types/bun` | Bun 用型定義 |

GLSL は Bun の text import（`import shader from "./x.glsl" with { type: "text" }`）で読み込むため、追加プラグイン不要。

## UI 仕様

- **開始オーバーレイ**：ロード時に画面中央に「開始」ボタンと簡単な説明。クリックでカメラ権限を要求し、問題なければ作品開始（user gesture なしで AudioContext を起動できないため必須）
- **コントロールパネル**（右上、極小）：
  - 音源切替：`[ファイル] [マイク]` の 2 ボタントグル
  - ファイル時：`[再生 / 停止]` と現在のファイル名、`[ファイル選択]` ボタン
  - マイク時：「マイク使用中」のインジケータ
- カメラビュー自体は表示しない（抽象化された身体を貫徹）

## エラー処理

MVP として最小限。失敗は明示的に見せる方針。

| 失敗 | 対応 |
|---|---|
| カメラ権限拒否 | オーバーレイで「カメラが必須です」を表示、再試行ボタン |
| マイク権限拒否（マイクモード時） | ファイルモードへフォールバック + トースト通知 |
| ファイルデコード失敗 | トースト通知、UI はファイル選択へ戻る |
| MediaPipe モデルロード失敗 | オーバーレイで「ネット接続を確認」+ 再試行ボタン |
| WebGL 非対応 | 起動時ブロック「WebGL 対応ブラウザが必要です」 |

リトライ無限ループ・自動回復は実装しない（失敗を握りつぶさない）。

## テスト方針

`AudioAnalyzer` の帯域抽出と `JointAnchors` の平滑化ロジックだけ単体テスト（決定論的なため）。シェーダー・ビジュアルは手動確認。

```
src/audio/AudioAnalyzer.test.ts   # FFT bin → bass/mid/treble の正確さ
src/pose/JointAnchors.test.ts     # smoothing factor、座標変換
```

テストランナーは `bun test`（Vitest 互換 API、`expect`/`describe`/`it` はそのまま使える）。

## パフォーマンス目標

- 60fps（モダンノート PC）
- 15k パーティクル + ShaderMaterial は余裕。MediaPipe の 30Hz が支配項
- ポーズ更新と描画は非同期に噛み合わせる：MediaPipe コールバックで最新ポーズを保存し、フレームごとに `JointAnchors` がそれに lerp

## スコープ外（将来拡張）

- ポストエフェクト（Bloom、Vignette）
- カメラの緩やかな周回
- 顔・手のランドマーク追加（MediaPipe の Holistic）
- 軌跡・残光（残像バッファ）
- マルチパフォーマー（複数人同時検出）
- 視覚要素の保存・スクリーンショット
