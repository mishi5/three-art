# 曲の再生コントロール 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Issue #7 (https://github.com/mishi5/three-art/issues/7) — 曲解析タイムライン上で seek、再生/一時停止トグル UI、スペースキーショートカットを実装する。

**Architecture:** 状態は `FileAudioSource` に集約し、`AudioBufferSourceNode` の片道仕様を `pause()/resume()/seek(t)` の度にノードを作り直すラッパで隠蔽する。タイムライン UI は左端に再生ボタンを足し、canvas 上の通常クリック/ドラッグを seek、Alt+クリックを境界編集に分離する。テストはプロジェクト既存の慣習に従い、副作用の少ない純関数 (`clampSeek`, `computeCurrentTime`, `interpretTimelineMouse`) として抽出して単体テストし、クラス本体の挙動はブラウザ手動確認で押さえる。

**Tech Stack:** TypeScript, Three.js (既存), Web Audio API (`AudioContext`/`AudioBufferSourceNode`), Bun test runner.

**Spec:** `docs/superpowers/specs/2026-05-10-issue-7-playback-control-design.md`

---

## File Structure

| パス | 役割 | 種別 |
|------|------|------|
| `src/pose-particles/audio/FileAudioSource.ts` | 状態機械追加 (stopped/playing/paused), pause/resume/seek/togglePause/isPlaying, 純関数 `clampSeek` / `computeCurrentTime` | Modify |
| `src/pose-particles/audio/FileAudioSource.test.ts` | `clampSeek` / `computeCurrentTime` の単体テスト | Create |
| `src/pose-particles/ui/SectionTimeline.ts` | 左端 ▶/Ⅱ ボタン、scrub 用 mousedown/mousemove/mouseup、Alt+click のみ境界編集、純関数 `interpretTimelineMouse` | Modify |
| `src/pose-particles/ui/SectionTimeline.test.ts` | `interpretTimelineMouse` の単体テスト追加 | Modify |
| `src/pose-particles/App.ts` | timeline コールバック配線、毎フレーム `setIsPlaying`、表示判定の差し替え、Space キー分岐 | Modify |

---

## Task 1: 純関数 `clampSeek` を TDD で追加

**Files:**
- Modify: `src/pose-particles/audio/FileAudioSource.ts`
- Create: `src/pose-particles/audio/FileAudioSource.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`src/pose-particles/audio/FileAudioSource.test.ts` に以下を作成:

```ts
import { describe, expect, test } from "bun:test";
import { clampSeek } from "./FileAudioSource";

describe("clampSeek", () => {
  test("0..duration の範囲はそのまま (epsilon 引いた上限)", () => {
    expect(clampSeek(0, 10)).toBe(0);
    expect(clampSeek(5, 10)).toBe(5);
  });

  test("負値は 0 に clamp", () => {
    expect(clampSeek(-1, 10)).toBe(0);
    expect(clampSeek(-Infinity, 10)).toBe(0);
  });

  test("duration 超えは duration - epsilon に clamp", () => {
    const r = clampSeek(20, 10);
    expect(r).toBeGreaterThan(9.9);
    expect(r).toBeLessThan(10);
  });

  test("NaN/Infinity は 0 に倒す", () => {
    expect(clampSeek(NaN, 10)).toBe(0);
    expect(clampSeek(Infinity, 10)).toBeLessThan(10);
  });

  test("duration が 0 以下なら 0 を返す", () => {
    expect(clampSeek(5, 0)).toBe(0);
    expect(clampSeek(5, -1)).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/7-playback-control && bun test src/pose-particles/audio/FileAudioSource.test.ts`
Expected: FAIL (`clampSeek` is not exported)

- [ ] **Step 3: 最小実装を書く**

`src/pose-particles/audio/FileAudioSource.ts` の冒頭 (既存の import 群の直後) に追加:

```ts
/** seek 時刻を [0, duration) に clamp。NaN/Infinity は 0 に倒す。duration<=0 でも 0。 */
export function clampSeek(t: number, duration: number): number {
  if (!Number.isFinite(t)) return Number.isFinite(duration) && duration > 0 ? Math.max(0, duration - 1e-3) : 0;
  if (duration <= 0) return 0;
  if (t < 0) return 0;
  const upper = duration - 1e-3;
  return t > upper ? upper : t;
}
```

注: `Infinity` の扱いはテストで `< duration` を要求しているため、Infinity のときだけ `duration - epsilon` を返すように `Number.isFinite(t)` 分岐を活用する。`NaN` は `!Number.isFinite` に入って `duration` 有効なら `duration - 1e-3` になるが、テストは `NaN → 0` を要求するため、NaN を別扱いする実装にする:

```ts
export function clampSeek(t: number, duration: number): number {
  if (Number.isNaN(t)) return 0;
  if (duration <= 0) return 0;
  if (t === -Infinity || t < 0) return 0;
  const upper = duration - 1e-3;
  if (t === Infinity || t > upper) return upper;
  return t;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `cd /Users/shun/dev/three-art/.worktrees/7-playback-control && bun test src/pose-particles/audio/FileAudioSource.test.ts`
Expected: PASS (5 tests)

- [ ] **Step 5: コミット**

```bash
cd /Users/shun/dev/three-art/.worktrees/7-playback-control
git add src/pose-particles/audio/FileAudioSource.ts src/pose-particles/audio/FileAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#7 feat: clampSeek 純関数を追加

Issue #7 の seek 時刻 clamp を共有ロジックとして切り出し、
TDD で 5 ケース (範囲内/負値/超過/NaN/duration 0) を担保。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: 純関数 `computeCurrentTime` を TDD で追加

**Files:**
- Modify: `src/pose-particles/audio/FileAudioSource.ts`
- Modify: `src/pose-particles/audio/FileAudioSource.test.ts`

- [ ] **Step 1: 失敗するテストを書く**

`FileAudioSource.test.ts` に describe ブロックを追加:

```ts
import { clampSeek, computeCurrentTime } from "./FileAudioSource";

describe("computeCurrentTime", () => {
  test("stopped は 0", () => {
    expect(computeCurrentTime("stopped", 0, null, 5, 100)).toBe(0);
  });

  test("paused は playOffset を返す", () => {
    expect(computeCurrentTime("paused", 12.5, null, 99, 100)).toBe(12.5);
  });

  test("playing は (playOffset + (ctxNow - startedAt)) % duration", () => {
    // playOffset=10, startedAt=2, ctxNow=5  → 10 + 3 = 13、duration 100 で wrap せず 13
    expect(computeCurrentTime("playing", 10, 2, 5, 100)).toBe(13);
  });

  test("playing で duration を超えたら wrap する", () => {
    // playOffset=98, startedAt=0, ctxNow=5, duration=100 → 103 % 100 = 3
    expect(computeCurrentTime("playing", 98, 0, 5, 100)).toBeCloseTo(3, 6);
  });

  test("playing で startedAt が null なら 0", () => {
    expect(computeCurrentTime("playing", 5, null, 10, 100)).toBe(0);
  });

  test("playing で duration<=0 なら 0", () => {
    expect(computeCurrentTime("playing", 5, 0, 10, 0)).toBe(0);
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `bun test src/pose-particles/audio/FileAudioSource.test.ts`
Expected: FAIL (`computeCurrentTime` is not exported)

- [ ] **Step 3: 最小実装を書く**

`src/pose-particles/audio/FileAudioSource.ts` の `clampSeek` の下に追加 (型はクラス内の `state` フィールドと共用するため `export type` も追加):

```ts
export type PlaybackState = "stopped" | "playing" | "paused";

/** 状態と内部時刻から現在の再生位置を算出。playing 中だけ ctxNow を使う。 */
export function computeCurrentTime(
  state: PlaybackState,
  playOffset: number,
  startedAt: number | null,
  ctxNow: number,
  duration: number,
): number {
  if (state === "stopped") return 0;
  if (state === "paused") return playOffset;
  if (startedAt === null || duration <= 0) return 0;
  const elapsed = ctxNow - startedAt;
  return (playOffset + elapsed) % duration;
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `bun test src/pose-particles/audio/FileAudioSource.test.ts`
Expected: PASS (clampSeek 5 + computeCurrentTime 6 = 11 tests)

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/audio/FileAudioSource.ts src/pose-particles/audio/FileAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#7 feat: computeCurrentTime 純関数と PlaybackState 型を追加

stopped/playing/paused の 3 状態から現在時刻を算出する純関数を
切り出し、wrap や startedAt null のエッジケースを TDD で担保。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: `FileAudioSource` クラスを状態機械に書き換える

**Files:**
- Modify: `src/pose-particles/audio/FileAudioSource.ts`

このタスクには新規テストは追加しない (純粋ロジックは Task 1/2 で網羅済み、クラス本体の Web Audio 副作用は Task 9 のブラウザ手動確認で押さえる)。既存テストが引き続き通ることだけ確認する。

- [ ] **Step 1: クラスを書き換える**

`src/pose-particles/audio/FileAudioSource.ts` のクラス本体を以下に置換 (純関数 `clampSeek`, `computeCurrentTime`, `PlaybackState` 型はそのまま残す):

```ts
export class FileAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private source: AudioBufferSourceNode | null = null;
  private buffer: AudioBuffer | null = null;
  private state: PlaybackState = "stopped";
  /** 曲頭からの累積位置 (秒)。pause/seek で更新。 */
  private playOffset = 0;
  /** state==="playing" 突入時の ctx.currentTime。それ以外は null。 */
  private startedAt: number | null = null;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async loadFromUrl(url: string): Promise<void> {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`failed to fetch audio: ${res.status}`);
    const arr = await res.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async loadFromFile(file: File): Promise<void> {
    const arr = await file.arrayBuffer();
    this.buffer = await this.ctx.decodeAudioData(arr);
  }

  async start(): Promise<void> {
    if (!this.buffer) throw new Error("no audio buffer loaded");
    this.spawnSource(0);
    this.playOffset = 0;
    this.startedAt = this.ctx.currentTime;
    this.state = "playing";
  }

  /** playing → paused。AudioBufferSourceNode を停止し offset を保存。 */
  pause(): void {
    if (this.state !== "playing" || !this.buffer) return;
    const now = this.ctx.currentTime;
    const elapsed = this.startedAt === null ? 0 : now - this.startedAt;
    this.playOffset = (this.playOffset + elapsed) % this.buffer.duration;
    this.disposeSource();
    this.startedAt = null;
    this.state = "paused";
  }

  /** paused → playing。新規 BufferSource を offset から再生。 */
  async resume(): Promise<void> {
    if (this.state !== "paused" || !this.buffer) return;
    if (this.ctx.state === "suspended") {
      try {
        await this.ctx.resume();
      } catch (e) {
        console.warn("[FileAudioSource] AudioContext.resume() failed", e);
        return; // state は paused のまま
      }
    }
    this.spawnSource(this.playOffset);
    this.startedAt = this.ctx.currentTime;
    this.state = "playing";
  }

  togglePause(): void {
    if (this.state === "playing") this.pause();
    else if (this.state === "paused") void this.resume();
    // stopped は no-op
  }

  /** 任意状態で seek。playing なら新ノードに差し替え、paused なら playOffset のみ更新。 */
  seek(t: number): void {
    if (!this.buffer) return;
    const target = clampSeek(t, this.buffer.duration);
    if (this.state === "playing") {
      this.disposeSource();
      this.spawnSource(target);
      this.playOffset = target;
      this.startedAt = this.ctx.currentTime;
    } else if (this.state === "paused") {
      this.playOffset = target;
    }
    // stopped は no-op
  }

  isPlaying(): boolean {
    return this.state === "playing";
  }

  stop(): void {
    this.disposeSource();
    this.state = "stopped";
    this.startedAt = null;
    this.playOffset = 0;
  }

  read(): AudioFeatures {
    if (this.state !== "playing") return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }

  getDecodedBuffer(): AudioBuffer | null {
    return this.buffer;
  }

  getCurrentTime(): number {
    return computeCurrentTime(
      this.state,
      this.playOffset,
      this.startedAt,
      this.ctx.currentTime,
      this.buffer?.duration ?? 0,
    );
  }

  /** 内部用: 新しい AudioBufferSourceNode を作って再生開始。 */
  private spawnSource(offset: number): void {
    if (!this.buffer) return;
    const src = this.ctx.createBufferSource();
    src.buffer = this.buffer;
    src.loop = true;
    src.connect(this.analyzer.input).connect(this.ctx.destination);
    src.start(0, offset);
    this.source = src;
  }

  /** 内部用: 現 source を停止して破棄。 */
  private disposeSource(): void {
    if (!this.source) return;
    try {
      this.source.stop();
    } catch {
      /* already stopped */
    }
    this.source.disconnect();
    this.source = null;
  }
}
```

- [ ] **Step 2: 既存テストとビルド確認**

Run: `bun test`
Expected: 全件 PASS (Task 1/2 で 11 件追加されているため、ベースライン 86 + 11 = 97)

Run: `bun run build` (もしくは `bunx tsc --noEmit`)
Expected: 型エラーなし

- [ ] **Step 3: コミット**

```bash
git add src/pose-particles/audio/FileAudioSource.ts
git commit -m "$(cat <<'EOF'
#7 feat: FileAudioSource に pause/resume/seek/togglePause を実装

state 機械 (stopped/playing/paused) を導入し、AudioBufferSourceNode の
片道仕様を spawnSource/disposeSource でラップ。computeCurrentTime/
clampSeek を使って状態に応じた現在時刻と seek 値を算出する。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: `interpretTimelineMouse` 純関数を TDD で追加

**Files:**
- Modify: `src/pose-particles/ui/SectionTimeline.ts`
- Modify: `src/pose-particles/ui/SectionTimeline.test.ts`

タイムラインのマウス操作を「seek するか / 境界編集するか / 何もしないか」に分岐させる純関数を切り出す。クラス内の DOM ハンドラはこれを呼ぶだけになる。

- [ ] **Step 1: 失敗するテストを書く**

`src/pose-particles/ui/SectionTimeline.test.ts` の末尾に追加:

```ts
import { interpretTimelineMouse } from "./SectionTimeline";

describe("interpretTimelineMouse", () => {
  test("Alt なし mousedown は seek", () => {
    const r = interpretTimelineMouse({ kind: "down", altKey: false, mouseT: 12.5, hitWindowSec: 0.5, boundaries: [] });
    expect(r).toEqual({ kind: "seek", t: 12.5 });
  });

  test("Alt あり mousedown は boundary-edit (近い境界が無いので追加)", () => {
    const r = interpretTimelineMouse({ kind: "down", altKey: true, mouseT: 12.5, hitWindowSec: 0.5, boundaries: [] });
    expect(r.kind).toBe("boundary-edit");
    if (r.kind !== "boundary-edit") throw new Error("type narrowing");
    expect(r.next).toHaveLength(1);
    expect(r.next[0]?.t).toBe(12.5);
  });

  test("Alt あり mousedown で hit 範囲内に既存があれば削除", () => {
    const bds = [{ t: 12.4, source: "auto" as const }];
    const r = interpretTimelineMouse({ kind: "down", altKey: true, mouseT: 12.5, hitWindowSec: 0.5, boundaries: bds });
    expect(r.kind).toBe("boundary-edit");
    if (r.kind !== "boundary-edit") throw new Error("type narrowing");
    expect(r.next).toHaveLength(0);
  });

  test("scrub (Alt なし mousemove) は seek", () => {
    const r = interpretTimelineMouse({ kind: "scrub", altKey: false, mouseT: 7.0, hitWindowSec: 0.5, boundaries: [] });
    expect(r).toEqual({ kind: "seek", t: 7.0 });
  });

  test("Alt あり scrub は no-op (Alt 押下中はスクラブしない仕様)", () => {
    const r = interpretTimelineMouse({ kind: "scrub", altKey: true, mouseT: 7.0, hitWindowSec: 0.5, boundaries: [] });
    expect(r).toEqual({ kind: "noop" });
  });
});
```

- [ ] **Step 2: テストが失敗することを確認**

Run: `bun test src/pose-particles/ui/SectionTimeline.test.ts`
Expected: FAIL (`interpretTimelineMouse` not exported)

- [ ] **Step 3: 純関数を実装**

`src/pose-particles/ui/SectionTimeline.ts` の既存 `addOrRemoveBoundary` の下に追加:

```ts
export type TimelineMouseInput = {
  /** "down" は mousedown、"scrub" は mousedown 後の mousemove */
  kind: "down" | "scrub";
  altKey: boolean;
  mouseT: number;
  hitWindowSec: number;
  boundaries: ReadonlyArray<SectionBoundary>;
};

export type TimelineMouseAction =
  | { kind: "seek"; t: number }
  | { kind: "boundary-edit"; next: SectionBoundary[] }
  | { kind: "noop" };

/**
 * タイムライン上のマウス操作を意図 (seek / 境界編集 / 何もしない) に変換する。
 * Alt なし: 常に seek。Alt あり: down 時のみ境界編集 (scrub は無視)。
 */
export function interpretTimelineMouse(input: TimelineMouseInput): TimelineMouseAction {
  if (!input.altKey) {
    return { kind: "seek", t: input.mouseT };
  }
  if (input.kind === "down") {
    return { kind: "boundary-edit", next: addOrRemoveBoundary(input.boundaries, input.mouseT, input.hitWindowSec) };
  }
  return { kind: "noop" };
}
```

- [ ] **Step 4: テストが通ることを確認**

Run: `bun test src/pose-particles/ui/SectionTimeline.test.ts`
Expected: PASS (既存 6 + 新規 5 = 11 tests)

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/ui/SectionTimeline.ts src/pose-particles/ui/SectionTimeline.test.ts
git commit -m "$(cat <<'EOF'
#7 feat: interpretTimelineMouse でクリック分岐を純関数化

通常クリック=seek、Alt クリック=境界編集、Alt+scrub=no-op の
3 分岐を純関数として切り出し、TDD で 5 ケースを担保。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: `SectionTimeline` クラスに再生ボタンと scrub 配線を追加

**Files:**
- Modify: `src/pose-particles/ui/SectionTimeline.ts`

クラス本体の DOM 副作用はブラウザで手動確認 (Task 9)。このタスクは型ビルドが通り、既存 86+11=97 テストが引き続き全件パスすることのみ確認する。

- [ ] **Step 1: コンストラクタ・メソッド・イベント処理を改修**

`src/pose-particles/ui/SectionTimeline.ts` のクラス全体を以下の差分の通りに書き換える。

(1) 定数を追加 (TIMELINE_HEIGHT_PX の下):
```ts
const PLAY_BUTTON_WIDTH_PX = 32;
```

(2) クラスのフィールドに追加:
```ts
private playButton: HTMLButtonElement;
private isPlayingState = false;
private isScrubbing = false;
private onSeek: (t: number) => void;
private onPauseToggle: () => void;
```

(3) コンストラクタシグネチャを変更:
```ts
constructor(handlers: {
  onChange: (next: SectionBoundary[]) => void;
  onSeek: (t: number) => void;
  onPauseToggle: () => void;
}) {
  this.onChange = handlers.onChange;
  this.onSeek = handlers.onSeek;
  this.onPauseToggle = handlers.onPauseToggle;
  // ...既存の element 作成は維持。canvas を入れる前に play button をぶら下げる
}
```

旧フィールド `private onChange: ...` は維持しつつ、コンストラクタ引数だけ単一オブジェクトに変える。

(4) DOM レイアウト: `element` の `innerHTML` または直接生成で、play button (32px 固定) + canvas (残り) の横並び flexbox に。具体的には以下のように構成:

```ts
this.element = document.createElement("div");
this.element.style.cssText = `
  position: fixed; left: 0; right: ${TIMELINE_RIGHT_OFFSET_PX}px; bottom: 0;
  height: ${TIMELINE_HEIGHT_PX}px;
  background: rgba(0,0,0,0.5);
  border-top: 1px solid rgba(255,255,255,0.2);
  z-index: 50;
  display: none;
  flex-direction: row;
`;

this.playButton = document.createElement("button");
this.playButton.type = "button";
this.playButton.textContent = "▶";
this.playButton.setAttribute("aria-label", "再生");
this.playButton.style.cssText = `
  width: ${PLAY_BUTTON_WIDTH_PX}px; height: 100%;
  background: rgba(255,255,255,0.06); color: #fff;
  border: none; border-right: 1px solid rgba(255,255,255,0.15);
  font-size: 14px; cursor: pointer; flex: 0 0 auto;
`;
this.playButton.addEventListener("click", this.handlePlayButton);
this.element.appendChild(this.playButton);

this.canvas = document.createElement("canvas");
this.canvas.style.cssText = "flex: 1 1 auto; height: 100%; display: block; cursor: pointer;";
this.element.appendChild(this.canvas);
document.body.appendChild(this.element);
```

注: `display: none` の下では flex も適用されない。`show()` 内で `display: flex` を使うように改修する:

```ts
show(): void {
  this.element.style.display = "flex";
  this.handleResize();
}
```

(5) 旧 `click` ハンドラを削除し、新ハンドラに差し替える:

```ts
this.canvas.addEventListener("mousedown", this.handleMouseDown);
window.addEventListener("keydown", this.handleAltKeyChange);
window.addEventListener("keyup", this.handleAltKeyChange);
window.addEventListener("resize", this.handleResize);
```

`dispose()` も対応する remove に書き換える。

(6) ハンドラ実装:

```ts
private handlePlayButton = (): void => {
  this.onPauseToggle();
  this.playButton.blur(); // Space で二重発火しないよう focus を外す
};

private mouseTFromEvent(ev: MouseEvent): number | null {
  if (!this.series) return null;
  const rect = this.canvas.getBoundingClientRect();
  if (rect.width <= 0) return null;
  const x = ev.clientX - rect.left;
  return (x / rect.width) * this.series.duration;
}

private handleMouseDown = (ev: MouseEvent): void => {
  if (ev.button !== 0) return; // 左クリックのみ
  const mouseT = this.mouseTFromEvent(ev);
  if (mouseT === null || !this.series) return;
  const hitWindowSec = (8 / this.canvas.getBoundingClientRect().width) * this.series.duration;
  const action = interpretTimelineMouse({
    kind: "down", altKey: ev.altKey, mouseT, hitWindowSec, boundaries: this.boundaries,
  });
  if (action.kind === "seek") {
    this.onSeek(action.t);
    this.isScrubbing = true;
    window.addEventListener("mousemove", this.handleMouseMove);
    window.addEventListener("mouseup", this.handleMouseUp);
  } else if (action.kind === "boundary-edit") {
    this.boundaries = action.next;
    this.draw();
    this.onChange(action.next);
  }
};

private handleMouseMove = (ev: MouseEvent): void => {
  if (!this.isScrubbing) return;
  const mouseT = this.mouseTFromEvent(ev);
  if (mouseT === null || !this.series) return;
  const hitWindowSec = (8 / this.canvas.getBoundingClientRect().width) * this.series.duration;
  const action = interpretTimelineMouse({
    kind: "scrub", altKey: ev.altKey, mouseT, hitWindowSec, boundaries: this.boundaries,
  });
  if (action.kind === "seek") this.onSeek(action.t);
};

private handleMouseUp = (): void => {
  if (!this.isScrubbing) return;
  this.isScrubbing = false;
  window.removeEventListener("mousemove", this.handleMouseMove);
  window.removeEventListener("mouseup", this.handleMouseUp);
};

private handleAltKeyChange = (ev: KeyboardEvent): void => {
  // Alt 押下中は境界編集モードを示すため crosshair に切り替える
  if (ev.key === "Alt") {
    this.canvas.style.cursor = ev.type === "keydown" ? "crosshair" : "pointer";
  }
};
```

(7) 公開メソッドを追加:

```ts
setIsPlaying(playing: boolean): void {
  if (this.isPlayingState === playing) return;
  this.isPlayingState = playing;
  this.playButton.textContent = playing ? "Ⅱ" : "▶";
  this.playButton.setAttribute("aria-label", playing ? "一時停止" : "再生");
}
```

(8) `dispose()` に追加:

```ts
this.canvas.removeEventListener("mousedown", this.handleMouseDown);
this.playButton.removeEventListener("click", this.handlePlayButton);
window.removeEventListener("mousemove", this.handleMouseMove);
window.removeEventListener("mouseup", this.handleMouseUp);
window.removeEventListener("keydown", this.handleAltKeyChange);
window.removeEventListener("keyup", this.handleAltKeyChange);
```

- [ ] **Step 2: TypeScript 型チェック**

Run: `bunx tsc --noEmit`
Expected: 型エラーなし。`SectionTimeline` のコンストラクタ呼び出し側 (`App.ts`) でエラーが出るはず — それは Task 6 で直す。一旦このタスクの完了確認は「`SectionTimeline.ts` 単体の型に問題ないこと」までとする。`App.ts` 経由のエラーが残っていてもこのタスクは進める。

- [ ] **Step 3: 単体テスト確認**

Run: `bun test src/pose-particles/ui/SectionTimeline.test.ts`
Expected: PASS (純関数テストは無関係に通る)

- [ ] **Step 4: コミット**

```bash
git add src/pose-particles/ui/SectionTimeline.ts
git commit -m "$(cat <<'EOF'
#7 feat: SectionTimeline に再生ボタンと seek/scrub を実装

左端 32px に play/pause ボタンを追加し、canvas 上の
mousedown→mousemove→mouseup でスクラブ seek を実装。
Alt 押下中は cursor を crosshair に切り替え、境界編集との
区別を視覚的に示す。コンストラクタは onChange/onSeek/
onPauseToggle の 3 ハンドラオブジェクトに変更 (App.ts は
次タスクで追従)。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: `App` 側でタイムライン配線・Space キー・表示判定を更新

**Files:**
- Modify: `src/pose-particles/App.ts`

- [ ] **Step 1: コンストラクタ呼び出しを 3 ハンドラ形式に変更**

`src/pose-particles/App.ts:110` 周辺の以下を:

```ts
this.sectionTimeline = new SectionTimeline((next) => this.onBoundariesEdited(next));
```

次に置換:

```ts
this.sectionTimeline = new SectionTimeline({
  onChange: (next) => this.onBoundariesEdited(next),
  onSeek: (t) => this.onTimelineSeek(t),
  onPauseToggle: () => this.onPauseToggle(),
});
```

- [ ] **Step 2: 新規プライベートメソッドを追加**

`App.ts` の `onBoundariesEdited` の下に追加:

```ts
private onTimelineSeek(t: number): void {
  if (this.audioInput instanceof FileAudioSource) {
    this.audioInput.seek(t);
  }
}

private onPauseToggle(): void {
  if (this.audioInput instanceof FileAudioSource) {
    this.audioInput.togglePause();
  }
}
```

- [ ] **Step 3: Space キー分岐を `onKeyDown` に追加**

`App.ts:161` 周辺の `onKeyDown` の末尾 (既存の `if (e.key === "h" || ...)` の後) に追加:

```ts
if (e.code === "Space" && this.audioInput instanceof FileAudioSource) {
  e.preventDefault();
  this.audioInput.togglePause();
}
```

- [ ] **Step 4: タイムラインの表示判定を差し替え**

`App.ts:184` 周辺 (`applyUiVisibility` 内):

```ts
if (this.uiVisible && this.settings.auto.enabled) this.sectionTimeline.show();
else this.sectionTimeline.hide();
```

を以下に変更:

```ts
if (this.uiVisible && this.audioInput instanceof FileAudioSource && this.currentSeries !== null) {
  this.sectionTimeline.show();
} else {
  this.sectionTimeline.hide();
}
```

`App.ts:380` 周辺 (`update` 末尾) の同様の表示判定も同じ条件に書き換える:

```ts
if (this.uiVisible && this.audioInput instanceof FileAudioSource && this.currentSeries !== null) {
  this.sectionTimeline.show();
} else {
  this.sectionTimeline.hide();
}
```

- [ ] **Step 5: 毎フレーム `setIsPlaying` を呼ぶ**

`App.ts:326` 周辺 (Auto モード分岐の `setCurrentTime` 呼び出しの近く) を確認し、Auto OFF でも `setCurrentTime` / `setIsPlaying` が更新されるよう、以下の通りに書き換える。

`update()` 内の Auto 分岐:

```ts
if (this.settings.auto.enabled
    && this.parameterAutomation
    && this.audioInput instanceof FileAudioSource) {
  const t = this.audioInput.getCurrentTime();
  this.parameterAutomation.applyAt(t, live as unknown as Record<string, unknown>);
  this.sectionTimeline.setCurrentTime(t);
}
```

の直後に、Auto モードに依存しないタイムライン更新を追加:

```ts
// Auto OFF でもタイムラインが表示されているなら現在時刻と再生状態を反映
if (this.audioInput instanceof FileAudioSource) {
  if (!this.settings.auto.enabled || !this.parameterAutomation) {
    this.sectionTimeline.setCurrentTime(this.audioInput.getCurrentTime());
  }
  this.sectionTimeline.setIsPlaying(this.audioInput.isPlaying());
}
```

- [ ] **Step 6: 全体ビルド確認**

Run: `bunx tsc --noEmit`
Expected: 型エラーなし

Run: `bun test`
Expected: 全件 PASS (97 tests)

- [ ] **Step 7: コミット**

```bash
git add src/pose-particles/App.ts
git commit -m "$(cat <<'EOF'
#7 feat: App に再生コントロールを配線し Space ショートカットを追加

SectionTimeline の onSeek/onPauseToggle を FileAudioSource に
ブリッジし、毎フレーム setIsPlaying/setCurrentTime を反映。
タイムラインの表示判定を auto.enabled 限定からファイル再生中
全般に拡張し、Space キーで pause/resume をトグルする。

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 7: ブラウザ手動確認 + Issue 動作確認依頼

**Files:** (コード変更なし)

- [ ] **Step 1: ローカル dev サーバを起動**

Run: `bun run dev` (もしくは package.json の同等コマンド)
ブラウザで `pose-particles.html` を開く。

- [ ] **Step 2: 確認シナリオ**

以下を順に確認し、すべて期待通りであること:

1. ファイル選択 → 解析完了 → タイムライン表示。Auto OFF でも波形が表示される。
2. タイムライン上をクリック → 曲がその位置にジャンプ。プレイヘッドが追従。
3. タイムライン上を mousedown → mousemove (canvas 外含む) → mouseup でスクラブ可能。
4. Space キーで pause/resume が切り替わる。ボタンも ▶/Ⅱ で同期する。
5. Space キーが GUI 入力 (lil-gui の数値入力など) にフォーカスがあるときは無視される。
6. Auto モード ON で Alt+クリックすると境界線が追加/削除される。Alt 押下中は cursor が crosshair。
7. Auto モード ON で通常クリックすると seek が走り、境界編集はされない。
8. ▶/Ⅱ ボタンを押した直後に Space キーを押しても二重発火しない (ボタンが blur されているため)。

- [ ] **Step 3: 既存機能の回帰確認**

1. Auto モード ON/OFF 切り替えで他のパラメータ自動制御が壊れていない。
2. マイク入力モードで Space キーは何も起こさない (FileAudioSource ではないため)。
3. H キーでの UI 一括非表示が引き続き動く (タイムラインも一緒に消える)。

- [ ] **Step 4: 何か壊れていれば該当タスクへ戻る、すべて OK なら次タスクへ**

(コミットなし)

---

## Task 8: PR 作成・ユーザ動作確認・Issue クローズ

**Files:** (コード変更なし)

- [ ] **Step 1: ブランチを push**

```bash
cd /Users/shun/dev/three-art/.worktrees/7-playback-control
git push -u origin feature/7-playback-control
```

- [ ] **Step 2: PR を作成**

```bash
gh pr create --title "#7 feat: 曲の再生コントロール (seek + pause/resume + Space)" --body "$(cat <<'EOF'
## Summary
- タイムラインクリック/ドラッグで曲の再生位置を変更可能に
- 左端に再生/一時停止ボタンを追加 (▶/Ⅱ)
- Space キーで pause/resume トグル
- Alt+クリックは引き続き境界編集 (Auto モード)
- ファイル再生中はタイムラインを常時表示 (Auto OFF でも波形のみ)

関連 Issue: https://github.com/mishi5/three-art/issues/7

## Test plan
- [x] `bun test` 全件パス (97 tests)
- [x] `bunx tsc --noEmit` 型エラーなし
- [ ] ブラウザで Task 7 の確認シナリオ全項目をユーザが確認

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: ユーザに動作確認を依頼**

以下のメッセージをユーザに伝え、ブラウザで確認してもらう (Task 7 のシナリオを再掲)。

- [ ] **Step 4: ユーザ OK 後、PR をマージ**

```bash
gh pr merge --squash --delete-branch
```

- [ ] **Step 5: Issue にコメントしてクローズ**

```bash
gh issue comment 7 --repo mishi5/three-art --body "$(cat <<'EOF'
## 対応内容
- `src/pose-particles/audio/FileAudioSource.ts`: 状態機械 (stopped/playing/paused) 化、pause/resume/seek/togglePause/isPlaying 追加。`clampSeek` / `computeCurrentTime` を純関数として切り出し
- `src/pose-particles/audio/FileAudioSource.test.ts`: 純関数の TDD テスト 11 件
- `src/pose-particles/ui/SectionTimeline.ts`: 左端再生ボタン、scrub 用 mousedown/mousemove/mouseup、Alt+click 限定境界編集、setIsPlaying。`interpretTimelineMouse` 純関数化
- `src/pose-particles/ui/SectionTimeline.test.ts`: クリック分岐の TDD テスト 5 件
- `src/pose-particles/App.ts`: 配線、Space キー分岐、表示判定差し替え、毎フレーム setIsPlaying/setCurrentTime

PR: <PR URL を入れる>
EOF
)"
gh issue close 7 --repo mishi5/three-art
```

- [ ] **Step 6: 後片付け**

```bash
cd /Users/shun/dev/three-art
git worktree remove .worktrees/7-playback-control
git branch -D feature/7-playback-control 2>/dev/null || true
git pull origin main
```

---

## 自己レビュー (writing-plans skill 必須)

- **Spec coverage:** R1 (seek) → Task 5 / 6, R2 (pause/play UI) → Task 5 / 6, R3 (Space) → Task 6, R4 (境界編集維持) → Task 4 / 5, R5 (常時表示) → Task 6, R6 (回帰なし) → Task 3 / 6 のテスト全件パス確認。すべて担当タスクあり。
- **Placeholder スキャン:** TBD/TODO/「適切に処理する」等なし。すべてのコード step に実コードあり。
- **型整合性:** `PlaybackState` (Task 2 で export)、`TimelineMouseInput`/`TimelineMouseAction` (Task 4 で export)、`SectionTimeline` の新コンストラクタシグネチャ (Task 5) と App 側の呼び出し (Task 6) が一致。`setIsPlaying`/`setCurrentTime` の名前は前後タスクで一致。
