# Issue #16: PC オーディオ (Chrome タブ音声) ソース対応 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

対象 Issue: https://github.com/mishi5/three-art/issues/16
対応する spec: `docs/superpowers/specs/2026-05-14-issue-16-pc-audio-source-design.md`

**Goal:** Chrome タブ音声を `getDisplayMedia` 経由でキャプチャし、ビジュアルの音源として使えるようにする。UI に「PC音声」ボタンを追加して既存の「ファイル」「マイク」と並列に切り替えできるようにする。

**Architecture:** 既存 `AudioInput` インターフェース実装の `DisplayAudioSource` を新規追加。`MicAudioSource` と同じ構造で、`getDisplayMedia({audio:true, video:{...}})` を呼んで video track は即破棄、audio track を `MediaStreamSourceNode → AudioAnalyzer` に繋ぐ。`destination` 非接続。UI 側は `switchToMic` パターンを踏襲し「PC音声」ボタンを追加する。

**Tech Stack:** TypeScript / bun:test / Web Audio API / getDisplayMedia / 既存の `AudioInput` / `AudioAnalyzer` / `UI` クラス

---

## ファイル構成

- 新規: `src/pose-particles/audio/DisplayAudioSource.ts` — `AudioInput` 実装。`getDisplayMedia` でタブ音声を取得し analyzer に繋ぐ。
- 新規: `src/pose-particles/audio/DisplayAudioSource.test.ts` — `bun:test`。`getDisplayMedia`・`AudioContext`・`MediaStreamTrack` を fake にしてロジック検証。
- 修正: `src/pose-particles/ui/UI.ts` — `type Mode` に `"display"` 追加、「PC音声」ボタンを追加、`switchToDisplay` メソッドを実装。

---

## Task 1: DisplayAudioSource の骨組み（成功パスのみ）

**Files:**
- Create: `src/pose-particles/audio/DisplayAudioSource.ts`
- Test: `src/pose-particles/audio/DisplayAudioSource.test.ts`

このタスクでは正常パス（getDisplayMedia が audio+video を返す → video stop → analyzer に connect → stop で全 track 停止）だけを実装する。

- [ ] **Step 1: テストファイル冒頭の共通ヘルパーを書く**

`src/pose-particles/audio/DisplayAudioSource.test.ts` を新規作成し、以下を貼る:

```typescript
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { DisplayAudioSource } from "./DisplayAudioSource";
import { DEFAULT_AUDIO_FEATURES } from "../types";

type FakeTrack = {
  kind: "audio" | "video";
  stopped: boolean;
  stop(): void;
  addEventListener(type: string, cb: () => void): void;
  removeEventListener(): void;
  _emitEnded(): void;
};

function makeFakeTrack(kind: "audio" | "video"): FakeTrack {
  let endedHandler: (() => void) | null = null;
  return {
    kind,
    stopped: false,
    stop() {
      this.stopped = true;
    },
    addEventListener(type, cb) {
      if (type === "ended") endedHandler = cb;
    },
    removeEventListener() {
      endedHandler = null;
    },
    _emitEnded() {
      endedHandler?.();
    },
  };
}

function makeFakeStream(tracks: FakeTrack[]) {
  return {
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === "audio"),
    getVideoTracks: () => tracks.filter((t) => t.kind === "video"),
  } as unknown as MediaStream;
}

function makeFakeCtx(): AudioContext {
  return {
    sampleRate: 48000,
    createAnalyser: () => ({
      fftSize: 2048,
      smoothingTimeConstant: 0.7,
      frequencyBinCount: 1024,
      getByteFrequencyData: (_arr: Uint8Array) => {},
    }),
    createMediaStreamSource: (_stream: MediaStream) => {
      const node = {
        connect: (_input: unknown) => node,
        disconnect: () => {},
      };
      return node;
    },
  } as unknown as AudioContext;
}

let originalNavigator: typeof globalThis.navigator | undefined;

function installGetDisplayMedia(impl: () => Promise<MediaStream>): void {
  (globalThis as { navigator: unknown }).navigator = {
    mediaDevices: { getDisplayMedia: impl },
  };
}

beforeEach(() => {
  originalNavigator = (globalThis as { navigator?: typeof globalThis.navigator }).navigator;
});

afterEach(() => {
  (globalThis as { navigator: unknown }).navigator = originalNavigator;
});
```

- [ ] **Step 2: 最初の失敗テストを書く（成功パス → read が DEFAULT 以外を返す）**

同ファイルに追加:

```typescript
describe("DisplayAudioSource - 成功パス", () => {
  it("start() 後に read() が DEFAULT_AUDIO_FEATURES 以外を返す", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    const features = src.read();

    expect(features).not.toBe(DEFAULT_AUDIO_FEATURES);
    expect(features.volume).toBe(0); // fake analyzer は 0 を返すが構造は別オブジェクト
    expect(features.fft).toBeDefined();
  });
});
```

- [ ] **Step 3: テスト実行して失敗確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: `Cannot find module './DisplayAudioSource'` で fail

- [ ] **Step 4: DisplayAudioSource を実装する**

`src/pose-particles/audio/DisplayAudioSource.ts` を新規作成:

```typescript
import { DEFAULT_AUDIO_FEATURES, type AudioFeatures } from "../types";
import { AudioAnalyzer } from "./AudioAnalyzer";
import type { AudioInput } from "./AudioInput";

/**
 * Chrome タブ音声を `getDisplayMedia` で取得して analyzer に繋ぐ AudioInput。
 * - video track は即 stop して捨てる（Chrome は audio-only を許可しない）
 * - destination には繋がない（タブ自体が元々スピーカーに鳴っているため聞こえ続ける）
 */
export class DisplayAudioSource implements AudioInput {
  private ctx: AudioContext;
  private analyzer: AudioAnalyzer;
  private stream: MediaStream | null = null;
  private node: MediaStreamAudioSourceNode | null = null;
  private active = false;

  constructor(ctx: AudioContext) {
    this.ctx = ctx;
    this.analyzer = new AudioAnalyzer(ctx);
  }

  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    });
    for (const t of stream.getVideoTracks()) t.stop();
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyzer.input);
    this.active = true;
  }

  stop(): void {
    if (this.node) {
      this.node.disconnect();
      this.node = null;
    }
    if (this.stream) {
      for (const track of this.stream.getTracks()) track.stop();
      this.stream = null;
    }
    this.active = false;
  }

  read(): AudioFeatures {
    if (!this.active) return DEFAULT_AUDIO_FEATURES;
    return this.analyzer.read(this.ctx.sampleRate);
  }
}
```

- [ ] **Step 5: テストパス確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 1 test pass

- [ ] **Step 6: video track の即時 stop と stop() の挙動を追加検証**

テストファイルの `describe("DisplayAudioSource - 成功パス", ...)` ブロック内に以下を追加:

```typescript
  it("start() で video track が即時 stop される", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();

    expect(video.stopped).toBe(true);
    expect(audio.stopped).toBe(false);
  });

  it("stop() で全 track が stop され read() が DEFAULT を返す", async () => {
    const audio = makeFakeTrack("audio");
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([audio, video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    src.stop();

    expect(audio.stopped).toBe(true);
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });

  it("二重 stop() が安全に呼べる", async () => {
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(async () => makeFakeStream([audio]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    src.stop();
    src.stop(); // throw しないこと
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
```

- [ ] **Step 7: テスト全件パス確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 4 tests pass

- [ ] **Step 8: コミット**

```bash
git add src/pose-particles/audio/DisplayAudioSource.ts src/pose-particles/audio/DisplayAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#16 feat: DisplayAudioSource を追加（getDisplayMedia でタブ音声を取得）

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: audio track 0 個のときエラーを投げる

**Files:**
- Modify: `src/pose-particles/audio/DisplayAudioSource.ts`
- Modify: `src/pose-particles/audio/DisplayAudioSource.test.ts`

ユーザがウィンドウ/画面を選んだ、または「タブの音声を共有」を ON にしなかった場合、取得した stream の audio track は 0 個になる。このとき stream を解放してから明確なエラーを投げる。

- [ ] **Step 1: 失敗テストを書く**

テストファイルに新規 describe を追加:

```typescript
describe("DisplayAudioSource - audio track 無し", () => {
  it("audio track が無いとき start() が reject し、video track が stop される", async () => {
    const video = makeFakeTrack("video");
    installGetDisplayMedia(async () => makeFakeStream([video]));

    const src = new DisplayAudioSource(makeFakeCtx());
    let caught: unknown = null;
    try {
      await src.start();
    } catch (e) {
      caught = e;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toContain("タブの音声共有");
    expect(video.stopped).toBe(true);
    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
});
```

- [ ] **Step 2: テスト実行して失敗確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 新規テスト 1 件 fail（実装は audio 無しでも throw しないため）

- [ ] **Step 3: 実装を更新**

`DisplayAudioSource.start()` を以下に置き換え:

```typescript
  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    });
    for (const t of stream.getVideoTracks()) t.stop();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error(
        "タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください",
      );
    }
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyzer.input);
    this.active = true;
  }
```

- [ ] **Step 4: テスト全件パス確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 5 tests pass

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/audio/DisplayAudioSource.ts src/pose-particles/audio/DisplayAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#16 feat: audio track が無いとき明確なエラーを投げる

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: 外部停止（track の ended イベント）で active を倒す

**Files:**
- Modify: `src/pose-particles/audio/DisplayAudioSource.ts`
- Modify: `src/pose-particles/audio/DisplayAudioSource.test.ts`

Chrome 下部の「共有を停止」ボタンやタブ閉じで audio track が ended する。これを検知して `active=false` に倒し、`read()` が DEFAULT を返すようにする。UI 更新は行わない（spec の方針）。

- [ ] **Step 1: 失敗テストを書く**

テストファイルに新規 describe を追加:

```typescript
describe("DisplayAudioSource - 外部停止検知", () => {
  it("audio track の ended イベント後 read() が DEFAULT を返す", async () => {
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(async () => makeFakeStream([audio]));

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    expect(src.read()).not.toBe(DEFAULT_AUDIO_FEATURES);

    audio._emitEnded();

    expect(src.read()).toBe(DEFAULT_AUDIO_FEATURES);
  });
});
```

- [ ] **Step 2: テスト実行して失敗確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 新規テスト 1 件 fail（ended ハンドラが無いため active は true のまま）

- [ ] **Step 3: 実装を更新**

`DisplayAudioSource.start()` で audio track 取得後、ended ハンドラを登録する。`audioTracks.length === 0` チェックの直後に以下を挿入:

```typescript
    audioTracks[0]!.addEventListener("ended", () => {
      this.active = false;
    });
```

`start()` 全体は以下のようになる:

```typescript
  async start(): Promise<void> {
    const stream = await navigator.mediaDevices.getDisplayMedia({
      audio: true,
      video: { width: 1, height: 1, frameRate: 1 },
    });
    for (const t of stream.getVideoTracks()) t.stop();
    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) {
      for (const t of stream.getTracks()) t.stop();
      throw new Error(
        "タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください",
      );
    }
    audioTracks[0]!.addEventListener("ended", () => {
      this.active = false;
    });
    this.stream = stream;
    this.node = this.ctx.createMediaStreamSource(stream);
    this.node.connect(this.analyzer.input);
    this.active = true;
  }
```

- [ ] **Step 4: テスト全件パス確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 6 tests pass

- [ ] **Step 5: コミット**

```bash
git add src/pose-particles/audio/DisplayAudioSource.ts src/pose-particles/audio/DisplayAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#16 feat: track の ended イベントで read() を DEFAULT に倒す

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: start() の二重呼び出しガード

**Files:**
- Modify: `src/pose-particles/audio/DisplayAudioSource.ts`
- Modify: `src/pose-particles/audio/DisplayAudioSource.test.ts`

`getDisplayMedia` を呼んでいる間にユーザがもう一度ボタンを押した場合、permission prompt が二重に出たり stream リークが起きないようにガードする。

- [ ] **Step 1: 失敗テストを書く**

テストファイルに新規 describe を追加:

```typescript
describe("DisplayAudioSource - 二重起動ガード", () => {
  it("start() の in-flight 中に再度 start() を呼んでも getDisplayMedia は 1 回しか呼ばれない", async () => {
    let calls = 0;
    let resolveStream: ((s: MediaStream) => void) | null = null;
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(() => {
      calls++;
      return new Promise<MediaStream>((res) => {
        resolveStream = res;
      });
    });

    const src = new DisplayAudioSource(makeFakeCtx());
    const p1 = src.start();
    const p2 = src.start();
    resolveStream!(makeFakeStream([audio]));
    await Promise.all([p1, p2]);

    expect(calls).toBe(1);
  });

  it("既に active な状態で start() を呼んでも getDisplayMedia は呼ばれない", async () => {
    let calls = 0;
    const audio = makeFakeTrack("audio");
    installGetDisplayMedia(async () => {
      calls++;
      return makeFakeStream([audio]);
    });

    const src = new DisplayAudioSource(makeFakeCtx());
    await src.start();
    await src.start();

    expect(calls).toBe(1);
  });
});
```

- [ ] **Step 2: テスト実行して失敗確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 新規テスト 2 件 fail（getDisplayMedia は毎回呼ばれているため）

- [ ] **Step 3: 実装を更新**

`DisplayAudioSource` クラスに `starting` フィールドを追加し、`start()` 冒頭で gate する:

```typescript
  private active = false;
  private starting = false;
```

```typescript
  async start(): Promise<void> {
    if (this.starting || this.active) return;
    this.starting = true;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        audio: true,
        video: { width: 1, height: 1, frameRate: 1 },
      });
      for (const t of stream.getVideoTracks()) t.stop();
      const audioTracks = stream.getAudioTracks();
      if (audioTracks.length === 0) {
        for (const t of stream.getTracks()) t.stop();
        throw new Error(
          "タブの音声共有が ON になっていません。Chrome タブを選び『タブの音声を共有』を有効にしてください",
        );
      }
      audioTracks[0]!.addEventListener("ended", () => {
        this.active = false;
      });
      this.stream = stream;
      this.node = this.ctx.createMediaStreamSource(stream);
      this.node.connect(this.analyzer.input);
      this.active = true;
    } finally {
      this.starting = false;
    }
  }
```

- [ ] **Step 4: テスト全件パス確認**

```bash
bun test src/pose-particles/audio/DisplayAudioSource.test.ts
```

期待: 8 tests pass

- [ ] **Step 5: 全テスト suite が壊れていないか確認**

```bash
bun test
```

期待: 既存 125 件 + 新規 8 件 = 133 件 pass

- [ ] **Step 6: コミット**

```bash
git add src/pose-particles/audio/DisplayAudioSource.ts src/pose-particles/audio/DisplayAudioSource.test.ts
git commit -m "$(cat <<'EOF'
#16 feat: start() の二重呼び出しをガード

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: UI に「PC音声」ボタンを統合

**Files:**
- Modify: `src/pose-particles/ui/UI.ts`

「ファイル」「マイク」と並列に「PC音声」ボタンを追加し、押下時に `DisplayAudioSource` を起動する。エラー時は既存の `errBox` にメッセージ表示。`NotAllowedError`（ユーザキャンセル）と `NotSupportedError`（非対応ブラウザ）は専用メッセージに置換する。

このタスクは UI のためユニットテストは無く、`bun build` での型・ビルドチェックと手動動作確認で検証する。

- [ ] **Step 1: `type Mode` に `"display"` を追加**

`src/pose-particles/ui/UI.ts:5` を:

```typescript
type Mode = "none" | "file" | "mic" | "display";
```

- [ ] **Step 2: `DisplayAudioSource` を import**

ファイル冒頭の import 群（既存の `MicAudioSource` の隣）に追加:

```typescript
import { DisplayAudioSource } from "../audio/DisplayAudioSource";
```

- [ ] **Step 3: ボタンとステータス要素を `panel.innerHTML` に追加**

`showControlPanel` の `panel.innerHTML` テンプレートを以下に置き換え（src/pose-particles/ui/UI.ts:81-92 周辺）:

```typescript
    panel.innerHTML = `
      <div style="display:flex;gap:4px">
        <button data-mode="file"    style="${btnCss}">ファイル</button>
        <button data-mode="mic"     style="${btnCss}">マイク</button>
        <button data-mode="display" style="${btnCss}">PC音声</button>
      </div>
      <div id="file-controls" style="display:none">
        <input id="file-input" type="file" accept="audio/*" style="font-size:11px;color:#ccc">
        <div id="file-status" style="margin-top:6px;opacity:0.7"></div>
      </div>
      <div id="mic-status" style="display:none;opacity:0.7">マイク使用中</div>
      <div id="display-status" style="display:none;opacity:0.7">PC音声 使用中</div>
      <div id="audio-error" style="color:#f88;display:none"></div>
    `;
```

- [ ] **Step 4: ステータス要素の参照を取得**

`showControlPanel` 内の DOM 参照取得部に `displayStatus` を追加（既存 `micStatus` の隣）:

```typescript
    const displayStatus = panel.querySelector("#display-status") as HTMLDivElement;
```

- [ ] **Step 5: ボタンクリックハンドラを 3 モード対応に書き換える**

既存のクリックハンドラ（src/pose-particles/ui/UI.ts:101-114 周辺）を以下に置き換え:

```typescript
    panel.querySelectorAll<HTMLButtonElement>("button[data-mode]").forEach((b) => {
      b.addEventListener("click", () => {
        const mode = b.dataset.mode as Mode;
        // 全ステータスを一旦隠す
        fileCtrl.style.display = "none";
        micStatus.style.display = "none";
        displayStatus.style.display = "none";
        if (mode === "file") {
          fileCtrl.style.display = "block";
          this.switchToFile();
        } else if (mode === "mic") {
          micStatus.style.display = "block";
          this.switchToMic(errBox);
        } else if (mode === "display") {
          displayStatus.style.display = "block";
          displayStatus.textContent = "PC音声を取得中…";
          this.switchToDisplay(errBox, displayStatus);
        }
      });
    });
```

- [ ] **Step 6: `switchToDisplay` メソッドを追加**

`UI` クラスの末尾（`switchToMic` の下）に追加:

```typescript
  private async switchToDisplay(errBox: HTMLElement, statusEl: HTMLElement): Promise<void> {
    try {
      const ctx = this.app.getOrCreateAudioContext();
      const display = new DisplayAudioSource(ctx);
      await display.start();
      this.app.setAudio(display);
      this.mode = "display";
      statusEl.textContent = "PC音声 使用中";
      errBox.style.display = "none";
    } catch (e) {
      const msg = this.displayErrorMessage(e);
      errBox.style.display = "block";
      errBox.textContent = msg;
      statusEl.style.display = "none";
      this.mode = "none";
    }
  }

  private displayErrorMessage(e: unknown): string {
    if (e instanceof Error) {
      if (e.name === "NotAllowedError") return "PC音声の取得がキャンセルされました";
      if (e.name === "NotSupportedError") return "このブラウザは PC 音声取得に対応していません";
      return e.message;
    }
    return "PC音声の取得に失敗しました";
  }
```

- [ ] **Step 7: ビルドが通ることを確認**

```bash
bun build ./pose-particles.html --outdir /tmp/build-check --minify 2>&1 | tail -20
```

期待: エラー無くビルド完了

- [ ] **Step 8: 全テスト suite を実行**

```bash
bun test
```

期待: 133 件 pass（UI 修正でテスト数は増えない）

- [ ] **Step 9: コミット**

```bash
git add src/pose-particles/ui/UI.ts
git commit -m "$(cat <<'EOF'
#16 feat: UI に「PC音声」ボタンを追加

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 6: 手動動作確認

ユーザに依頼するチェック項目。コードに変更は無し。

- [ ] **Step 1: dev サーバ起動**

```bash
bun --hot ./pose-particles.html
```

- [ ] **Step 2: 受け入れ条件チェック**

ブラウザ（Chrome）で確認:

1. 「開始」 → カメラ権限を許可 → コントロールパネルに「ファイル」「マイク」「PC音声」の 3 ボタンが並んで見える。
2. 「PC音声」を押下 → 画面共有ダイアログが出る → Chrome タブを 1 つ選択 → 「タブの音声を共有」を ON → 「共有」。
3. YouTube などタブで音を出している状態でビジュアルが反応する（point cloud が音に合わせて動く）。
4. ステータスに「PC音声 使用中」が表示される。
5. 「マイク」に切り替え → タブ音声のキャプチャが止まり、Chrome の共有インジケータが消える。
6. もう一度「PC音声」を押し、ダイアログをキャンセル → エラー領域に「PC音声の取得がキャンセルされました」が出る。
7. 「PC音声」を押し、「タブの音声を共有」OFF のまま共有 → エラー領域に「タブの音声共有が ON になっていません〜」が出る。
8. PC音声 使用中に Chrome 下部の「共有を停止」ボタンを押す → ビジュアルが自動的に静止する（パネル表記はそのまま）。別のソースに切り替え可能なこと。

---

## Task 7: PR 作成

- [ ] **Step 1: push & PR 作成**

```bash
git push -u origin feature/16-pc-audio-source
gh pr create --title "#16 feat: PC音声 (Chrome タブ音声) ソース対応" --body "$(cat <<'EOF'
## 概要

Chrome タブ音声を `getDisplayMedia` 経由でキャプチャし、ビジュアルの音源として使えるようにする。Issue #16 対応。

- `DisplayAudioSource` を新規追加（`AudioInput` 実装）
- UI に「PC音声」ボタンを並列追加
- 外部停止検知・二重起動ガード・エラーメッセージを含む

## Spec / Plan

- spec: `docs/superpowers/specs/2026-05-14-issue-16-pc-audio-source-design.md`
- plan: `docs/superpowers/plans/2026-05-14-issue-16-pc-audio-source.md`

## Test plan

- [ ] Chrome で `bun --hot ./pose-particles.html` を起動
- [ ] 「PC音声」ボタンからタブ音声をキャプチャしてビジュアルが反応する
- [ ] ソース切り替え（ファイル / マイク / PC音声）が想定通り動く
- [ ] ダイアログキャンセル時にエラーメッセージが表示される
- [ ] 「タブの音声を共有」OFF のときエラーメッセージが表示される
- [ ] 「共有を停止」ボタンでビジュアルが自動で静止する

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: PR URL を控える**

---

## Self-Review チェック結果

- **Spec coverage**: spec の全要件（DisplayAudioSource 実装 / UI ボタン / 4 種のエラーパス / 外部停止検知 / video track 即破棄 / destination 非接続 / テスト）に対応するタスクあり ✓
- **Placeholder scan**: TBD / TODO / 「適切に」「対応する」のような曖昧文言なし ✓
- **Type consistency**: `start/stop/read` シグネチャは `AudioInput` 互換、`DisplayAudioSource` のフィールド名は全タスクで `active` / `starting` / `stream` / `node` で一貫 ✓
