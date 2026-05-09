# 曲の再生コントロール 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/7
- 関連: #5 (タイムライン UI を実装した PR #6 にて完了済)

## 背景

Issue #5 で曲解析と Auto モードのタイムライン (`SectionTimeline`) を実装した。Issue #7 ではそのタイムラインを操作して曲の再生位置を変更し、再生/一時停止のトグル UI とスペースキーショートカットを追加する。

現状の制約:

- `FileAudioSource` は `AudioBufferSourceNode` を 1 度だけ `start()` する片道設計。pause/seek は未実装。
- `SectionTimeline` は `settings.auto.enabled` のときのみ表示し、クリックで境界線の追加/削除を行う。
- `getCurrentTime()` は `(ctx.currentTime - startedAt) % duration` のシンプルな算出のみで、pause/seek を考慮していない。

## 要件

R1. ファイル再生中、タイムライン上で seek できる (クリックで瞬間ジャンプ、ドラッグでスクラブ)。
R2. 再生/一時停止のトグル UI ボタンを設置する。
R3. スペースキーで再生/一時停止をトグルする。GUI 入力にフォーカスがあるときは無視する。
R4. 既存の境界線編集機能はそのまま使える状態を保つ (Auto モード時のみ機能)。
R5. ファイル再生中はタイムラインを常時表示する (Auto OFF でも波形のみ表示)。
R6. 上記の追加で既存テスト (86 件) が壊れないこと。

## アーキテクチャ概要

```
┌──────────────────────────────────────────────────────────┐
│ App.onKeyDown (Space) ──┐                                │
│                         ▼                                │
│  SectionTimeline ──[onPauseToggle / onSeek*]──► App      │
│        ▲                                       │         │
│        │ setIsPlaying / setCurrentTime         ▼         │
│        └──────────────────────────── FileAudioSource     │
│                                       ├ state machine    │
│                                       ├ pause / resume   │
│                                       └ seek             │
└──────────────────────────────────────────────────────────┘
```

- 状態は `FileAudioSource` に集約。`App` は橋渡しのみ。
- 既存 `AudioInput` インタフェースには変更を加えない (pause/seek は `FileAudioSource` 固有メソッドとして公開)。

## コンポーネント設計

### 1. `FileAudioSource` (改修)

#### 状態機械

```
stopped ──start()──► playing ⇄ paused
                         │
                         └─seek(t)──► (同状態を維持)
```

#### 内部フィールド (追加)

| フィールド | 型 | 用途 |
|-----------|-----|-----|
| `state` | `"stopped" \| "playing" \| "paused"` | 明示的な状態管理 |
| `playOffset` | `number` | 曲頭からの累積位置 (秒)。pause/seek で更新 |
| `startedAt` | `number \| null` | playing 突入時の `ctx.currentTime` |

既存の `playing: boolean` は `state === "playing"` で代替し削除する。

#### メソッド

| メソッド | 仕様 |
|---------|------|
| `start()` | stopped → playing。`playOffset = 0`、`startedAt = ctx.currentTime`、新 `AudioBufferSourceNode` を `start(0, 0)`。 |
| `pause()` | playing → paused。`playOffset = (playOffset + ctx.currentTime - startedAt) % duration`、`source.stop()` + `disconnect()`、`source = null`、`startedAt = null`。 |
| `resume()` | paused → playing。新 `AudioBufferSourceNode` を `start(0, playOffset)`、`startedAt = ctx.currentTime`。AudioContext が `suspended` なら `await ctx.resume()`。 |
| `togglePause()` | playing なら `pause()`、paused なら `resume()`、stopped なら no-op。 |
| `seek(t)` | `t` を `[0, duration)` に clamp/wrap。playing なら現 source を stop し新 source を `start(0, t)`、`playOffset = t`、`startedAt = ctx.currentTime`。paused なら `playOffset = t` のみ更新。 |
| `getCurrentTime()` | playing: `(playOffset + (ctx.currentTime - startedAt)) % duration`。paused: `playOffset`。stopped: `0`。 |
| `isPlaying()` | `state === "playing"` を返す (UI からの問い合わせ用)。 |

#### `read()` の修正

`!playing` ではなく `state !== "playing"` で `DEFAULT_AUDIO_FEATURES` を返す。pause 中も解析は走らない (= 視覚は静止する)。

#### エッジケース

- `buffer === null` のときの pause/resume/seek/togglePause: 何もせず no-op。
- `seek(NaN)` や負値・`duration` 超え: `Math.max(0, Math.min(duration - 1e-3, t))` で clamp。
- AudioContext.resume() が失敗: `console.warn`、状態は `paused` のまま戻す。
- `loop = true` は維持。終端到達時は `AudioBufferSourceNode` 自身が wrap し、`getCurrentTime()` の `% duration` で UI も整合。

### 2. `SectionTimeline` (改修)

#### レイアウト

- 左端 32px に再生/一時停止ボタン (`<button>`) を固定配置。
- 残りの領域に既存の波形 canvas を配置 (高さ 96px は維持)。
- 既存の `right: 332px` はそのまま。

#### 新規コールバック

```ts
constructor(handlers: {
  onChange: (next: SectionBoundary[]) => void;       // 既存: 境界編集
  onSeek: (t: number) => void;                        // 新規: シーク
  onPauseToggle: () => void;                          // 新規: ▶/Ⅱ ボタン
})
```

#### 新規メソッド

- `setIsPlaying(playing: boolean)`: ▶/Ⅱ アイコンを切替。

#### canvas のマウス挙動

| 操作 | 挙動 |
|------|------|
| `mousedown` (Alt なし) | スクラブ開始。`onSeek(t)` 発火。`window` に `mousemove`/`mouseup` listener を一時登録 |
| `mousemove` (スクラブ中) | `onSeek(t)` を都度発火 |
| `mouseup` (スクラブ中) | listener 解除、スクラブ終了 |
| `click` (Alt あり) | 既存の `addOrRemoveBoundary` を実行し `onChange` を発火 |

実装方針: 既存の `click` ハンドラは Alt キーが押されている場合のみ境界編集を行う形に変更し、Alt なしのドラッグ系は `mousedown`/`mousemove`/`mouseup` の新規ハンドラに任せる。Alt なしの `click` (ドラッグなし) も `mousedown` 時の `onSeek` で完結するため、二重発火しないよう `click` ハンドラ内で `e.altKey` チェックを行う。

#### 表示制御

- 既存の `auto.enabled` 限定の表示判定は `App` 側で `audioInput instanceof FileAudioSource && currentSeries !== null` に変更。
- 境界線描画は `boundaries.length === 0` なら自然に skip されるため、Auto OFF 時はそのまま波形+プレイヘッドのみ表示される (描画ロジック自体は変更不要)。

#### カーソル

- 既定: `cursor: pointer` (seek 可能を示唆)。
- `keydown`/`keyup` で Alt 状態を監視し、押下中は `cursor: crosshair`。

### 3. `App` (改修)

- `SectionTimeline` への新規コールバック (`onSeek`, `onPauseToggle`) を提供。各々 `FileAudioSource.seek(t)` / `togglePause()` を呼ぶ。
- `update()` 内で毎フレーム `sectionTimeline.setIsPlaying(this.audioInput.isPlaying())` を呼ぶ (FileAudioSource のときのみ)。
- `update()` 内のタイムライン表示分岐を `audioInput instanceof FileAudioSource && currentSeries !== null && uiVisible` に変更。
- `onKeyDown` に `e.code === "Space"` 分岐を追加し、`audioInput instanceof FileAudioSource` なら `togglePause()` し `e.preventDefault()`。

## データフロー

### Seek (タイムラインクリック)

```
user click on canvas
  ↓
SectionTimeline.handleMouseDown → onSeek(mouseT)
  ↓
App.onSeek → audioInput.seek(t)
  ↓
FileAudioSource.seek: AudioBufferSourceNode 再構築 (playing 時)
  ↓
次フレーム: App.update が getCurrentTime() = t を取得
  ↓
sectionTimeline.setCurrentTime(t) でプレイヘッドが追従
```

### Pause/Resume (▶/Ⅱ ボタン or スペースキー)

```
button click / Space keydown
  ↓
SectionTimeline.onPauseToggle → App.onPauseToggle
  または App.onKeyDown (Space)
  ↓
audioInput.togglePause()
  ↓
次フレーム: App.update が isPlaying() を取得
  ↓
sectionTimeline.setIsPlaying(playing) で ▶/Ⅱ 切替
```

## エラー処理

| 状況 | 対応 |
|------|------|
| `buffer === null` での pause/resume/seek | 何もせず return |
| seek 値が NaN/Infinity/負値/duration超え | clamp/wrap |
| AudioContext suspended での resume | `await ctx.resume()`、失敗時 warn |
| マイク入力中の Space キー | 無視 (`audioInput instanceof FileAudioSource` で分岐済み) |
| Auto モードでの後ろ向き seek | `ParameterAutomation.applyAt(t)` は時刻引数で再計算するため自然に追従 (実装時に確認) |

## テスト方針

### 1. `FileAudioSource.test.ts` (新規)

`AudioContext` と `AudioBufferSourceNode` のフェイクを注入してテスト。`FileAudioSource` のコンストラクタは `ctx: AudioContext` を受け取るため、`createBufferSource` を mock した最小フェイクで十分。

| ケース |
|-------|
| `start()` 後 `getCurrentTime()` が経過時間に応じて増加 |
| `start → pause → getCurrentTime` が `playOffset` を返す |
| `start → 経過 → pause → resume → getCurrentTime` が再開後単調増加 |
| `seek(t)` 後 `getCurrentTime()` が約 t (playing/paused 両方) |
| `seek(-1)` で 0 に clamp、`seek(duration + 1)` で `duration - epsilon` に clamp |
| buffer 未ロードでの pause/resume/seek が throw しない |
| `read()` が paused 中 `DEFAULT_AUDIO_FEATURES` を返す |
| `togglePause()` が playing→paused→playing でトグル |

### 2. `SectionTimeline.test.ts` (拡張)

既存の `pickBoundaryAt` / `addOrRemoveBoundary` テストはそのまま。クラス本体のイベントテストは jsdom 上で行う。

| ケース |
|-------|
| 通常 mousedown で `onSeek` が呼ばれる |
| 通常 mousedown→mousemove で `onSeek` が複数回発火 |
| Alt+click で `onChange` が呼ばれ `onSeek` は呼ばれない |
| `setIsPlaying(true/false)` でボタンの aria-label / textContent が切り替わる |

### 3. 結合テスト

- 実ブラウザで以下を手動確認:
  - 曲を読み込み → Space キーで pause/resume
  - タイムラインクリックで曲の途中にジャンプ
  - ドラッグでスクラブ
  - Alt+クリックで境界追加/削除 (Auto モード時)
  - Auto OFF にすると境界線が消えるが波形とプレイヘッドは残る

## 範囲外 (本 Issue では対応しない)

- マイク入力時の pause/seek (そもそもマイクは制御不能)。
- 曲の終端で停止する non-loop モード (現状 loop=true 固定で問題ない)。
- 音量フェード/クロスフェードを伴う seek (即時切替で十分)。
- キーボードショートカットで矢印キーによるシーク (将来検討)。

## 見積り

- `FileAudioSource.ts`: 約 50 行追加。
- `SectionTimeline.ts`: 約 80 行追加。
- `App.ts`: 約 20 行追加。
- 新規テスト: 約 8〜10 件。
