# pose-particles: プリセット管理機能 — 設計

- 対象 Issue: https://github.com/mishi5/three-art/issues/26
- 作品: pose-particles
- 作成日: 2026-05-21
- ブランチ: `feature/26-preset-manager`

## 1. ゴール

サムネイル画像と説明文付きでパラメータ設定（プリセット）を localStorage に登録・選択できるようにし、登録済みプリセットを順番／ランダムに切り替えるボタンを提供する。プリセット一式は YAML で export / import 可能。

既存の単一 `Settings` 用 export/import・auto-save (`pose-particles.settings.v1`) は壊さず温存する。

## 2. スコープ

- Issue #26 の完了条件 8 項目すべてを 1 PR で実装する
- 段階分割はしない（機能単位で TDD で進められる粒度のため）

## 3. アーキテクチャ

```
src/pose-particles/
├── presets/                            (NEW)
│   ├── types.ts                        Preset, PresetBundle 型
│   ├── PresetStore.ts                  CRUD + 順序 + next/random
│   ├── PresetStore.test.ts
│   ├── storage.ts                      localStorage I/O (key 隔離)
│   ├── storage.test.ts
│   ├── thumbnail-capture.ts            WebGLRenderTarget → WebP DataURL
│   ├── thumbnail-capture.test.ts
│   ├── bundle-yaml.ts                  PresetBundle ⇄ YAML
│   └── bundle-yaml.test.ts
├── ui/
│   ├── PresetManagerPanel.ts           (NEW) 中央オーバーレイモーダル
│   ├── PresetManagerPanel.test.ts
│   └── SettingsPanel.ts                (EDIT) Preset フォルダにボタン追加
└── App.ts                              (EDIT) PresetStore / Panel を wiring
```

依存関係:
- `PresetStore` は `storage` のみ依存（pure ロジック + 永続化）
- `thumbnail-capture` は three.js のみ依存（store には依存しない）
- `bundle-yaml` は `yaml` パッケージと `types` のみ依存
- `PresetManagerPanel` は `PresetStore` と `bundle-yaml` を使う。`thumbnail-capture` は callback 経由で外から注入（DOM 層から three.js を直接呼ばないため、テストしやすい）
- `SettingsPanel` は callback 経由でモーダル開閉・next/random をトリガし、PresetManagerPanel を直接参照しない

## 4. データモデル

### 4.1 Preset 型

```ts
export interface Preset {
  id: string;            // crypto.randomUUID()。不変
  name: string;          // 表示名。空文字不可（保存時に "untitled" に強制）
  description: string;   // 複数行可。空文字許可
  thumbnail: string;     // data URL ("data:image/webp;base64,..." 推奨。PNG fallback 可)
  settings: Settings;    // makeDefaultSettings() と同形（既存 Settings 型）
  createdAt: number;     // Date.now()
  updatedAt: number;     // Date.now()
}

export interface PresetBundle {
  version: 1;
  presets: Preset[];
}
```

### 4.2 永続化

- localStorage key: `"pose-particles.presets.v1"`
- 値: `JSON.stringify(PresetBundle)`
- 読み込み失敗（JSON parse error / null）→ 空 Bundle (`{ version: 1, presets: [] }`)
- 保存失敗 (`QuotaExceededError`) → `alert("プリセット保存容量を超えました…")` で通知し、変更前状態に rollback
- 上限: ソフトリミット 50 件。超過時は `add()` が throw（モーダル UI 側で catch して alert）

## 5. PresetStore API

`PresetStore` は localStorage アダプタ（または in-memory adapter）を constructor に受けるクラス。

```ts
type Adapter = {
  read(): PresetBundle;          // 失敗時は空 Bundle
  write(b: PresetBundle): void;  // QuotaExceededError は throw
};

class PresetStore {
  constructor(adapter: Adapter);
  list(): Preset[];                                   // createdAt 昇順
  get(id: string): Preset | null;
  add(input: { name; description; thumbnail; settings }): Preset;
  update(id: string, patch: Partial<{ name; description; thumbnail; settings }>): Preset;
  remove(id: string): void;
  replaceAll(presets: Preset[]): void;               // bundle import 用
  toBundle(): PresetBundle;
  fromBundle(bundle: PresetBundle): void;            // replaceAll + write
  nextOf(currentId: string | null): Preset | null;   // 末尾→先頭ラップ。空なら null
  randomOf(excludeId: string | null, rng?: () => number): Preset | null;
                                                     // 直前と被らない。1 件しかなければそれを返す
}
```

- `add` で id/createdAt/updatedAt を自動付与
- `update` は `updatedAt` を Date.now() に更新
- `add` の上限超過は `RangeError("preset limit reached")` を throw
- `randomOf` は `rng` を注入可能（テスト用に決定論化）

## 6. サムネイルキャプチャ

### 6.1 方式

`THREE.WebGLRenderTarget` を **キャプチャごとに作成→使用→ dispose** する。常設しないため GPU メモリも常時負荷もゼロ。

```ts
function captureThumbnail(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  opts?: { width?: number; height?: number; mime?: "image/webp" | "image/png"; quality?: number }
): string {  // data URL
  const W = opts?.width ?? 256;
  const H = opts?.height ?? 144;
  const rt = new THREE.WebGLRenderTarget(W, H, {
    type: THREE.UnsignedByteType,
    format: THREE.RGBAFormat,
  });
  try {
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);
    const buf = new Uint8Array(W * H * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, W, H, buf);
    renderer.setRenderTarget(null);
    return bufferToDataURL(buf, W, H, opts?.mime ?? "image/webp", opts?.quality ?? 0.7);
  } finally {
    rt.dispose();
  }
}
```

`bufferToDataURL`:
1. オフスクリーン `OffscreenCanvas` または `document.createElement("canvas")` (W×H, 2d)
2. WebGL は左下原点なので **上下反転して** `ImageData` に詰める
3. `canvas.toDataURL(mime, quality)` を返す
4. WebP 非対応ブラウザでは結果が `data:image/png` で返るのでそのまま許容

### 6.2 任意画像差し替え

```ts
async function imageToThumbnailDataURL(file: File, W=256, H=144): Promise<string>
```

- `createImageBitmap(file)` → 2D canvas (W×H) に **contain** で描画（アスペクト保持＋黒余白）
- `toDataURL("image/webp", 0.7)` を返す

### 6.3 サイズと容量見積もり

- 256×144 WebP q=0.7 → 1 枚 8–15KB
- 50 件 ≈ 0.4–0.75MB → localStorage 5MB 制限内に十分収まる

## 7. バンドル YAML

### 7.1 形式

```yaml
version: 1
presets:
  - id: "f1d5..."
    name: "Wave Cool"
    description: |
      lattice mode, low bass-driven amplitude.
    thumbnail: "data:image/webp;base64,UklGRhYAAABXRUJQVlA4..."
    settings:
      mode: lattice
      audioGain:
        volume: 2.0
        ...
    createdAt: 1730000000000
    updatedAt: 1730000000000
```

### 7.2 API

```ts
function serializeBundleYaml(b: PresetBundle): string;
function parseBundleYaml(text: string): PresetBundle;  // version !== 1 → throw
```

- 必須フィールド欠損は安全側にフォールバック:
  - `name` 欠損/空 → "untitled"
  - `description` 欠損 → ""
  - `thumbnail` 欠損 → 透明 1×1 WebP data URL（定数）
  - `createdAt` / `updatedAt` 欠損 → Date.now()
  - `id` 欠損 → `crypto.randomUUID()`
  - `settings` 欠損 / parse 不能 → そのエントリを drop
- `version` が 1 以外なら `throw new Error("unsupported preset bundle version: <n>")`

### 7.3 既存単一 Settings YAML との関係

- 既存 `preset-yaml.ts`（単一 Settings 用）はそのまま温存
- bundle import は **bundle 形式のみ** を受け付ける（単一 Settings 直接 import は SettingsPanel 既存ボタンを使う、YAGNI）

## 8. UI: PresetManagerPanel（中央オーバーレイモーダル）

### 8.1 レイアウト

```
┌── Preset Manager ─────────────────────────────── [×] ┐
│ [ + Save current as preset ]                          │
│                                                       │
│ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐         │
│ │ thumb  │ │ thumb  │ │ thumb  │ │ thumb  │ ...      │
│ │【選択中】│ │        │ │        │ │        │         │
│ └────────┘ └────────┘ └────────┘ └────────┘         │
│  name      name      name      name                  │
│                                                       │
│ Detail (選択中)                                       │
│   name: [____________]                                │
│   description: [_______________________________]      │
│   [ apply ] [ replace thumb ] [ delete ]              │
│                                                       │
│ [ Export all (.yaml) ] [ Import all (.yaml) ]         │
└───────────────────────────────────────────────────────┘
```

### 8.2 DOM / スタイル

- ルート: `position: fixed; inset: 0; z-index: 80; backdrop: rgba(0,0,0,0.55)`
- 内側 panel: `max-width: 880px; max-height: 90vh; overflow-y: auto; margin: 5vh auto; background: #1a1a1a; color: #eee; border-radius: 8px;`
- グリッド: `display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 12px`
- カード: サムネ (`object-fit: contain`) + 名前。選択中は枠 `outline: 2px solid #5ac`
- ESC / 背景クリック / `×` で `hide()`

### 8.3 構築

```ts
interface PresetManagerCallbacks {
  /** 現在の Settings を取得 */
  getCurrentSettings: () => Settings;
  /** プリセット適用（App 側で SettingsPanel.applyPreset を呼ぶ） */
  onApply: (preset: Preset) => void;
  /** サムネ取得（App 側で captureThumbnail を呼ぶ） */
  captureThumbnail: () => string;
}

class PresetManagerPanel {
  constructor(store: PresetStore, callbacks: PresetManagerCallbacks);
  show(): void;
  hide(): void;
  dispose(): void;
  /** lil-gui 側から呼ぶ。activePresetId を更新するため */
  getActivePresetId(): string | null;
  /** activePresetId を更新し、モーダル表示中なら選択枠ハイライトの DOM も同期する */
  setActivePresetId(id: string | null): void;
}
```

### 8.4 操作

| 操作 | 挙動 |
|------|------|
| Save current | `prompt("name?", default="untitled #<N>")` → `captureThumbnail()` ＋ `getCurrentSettings()` → `store.add({ name, description: "", thumbnail, settings })` → 再描画 → 新規を選択中に |
| カードクリック | `onApply(preset)` ＋ `activePresetId = preset.id` ＋ ハイライト更新 |
| name / description 入力 | onInput で `store.update(id, { name | description })`（debounce 不要・lil-gui の onChange と同等） |
| replace thumb | `<input type=file>` → `imageToThumbnailDataURL()` → `store.update(id, { thumbnail })` |
| delete | `confirm("削除します。よろしいですか?")` → `store.remove(id)` → 選択解除 |
| Export all | `serializeBundleYaml(store.toBundle())` → Blob ダウンロード（既存 export と同じ手順） |
| Import all | `<input type=file accept=".yaml,.yml">` → `parseBundleYaml(text)` → `store.fromBundle(b)` → 再描画 |
| ESC / × / backdrop | `hide()` |

## 9. SettingsPanel への統合

既存 Preset フォルダはそのまま温存し、ボタンを追加する。

```ts
// 既存
presets.add(actions, "reset").name("reset to defaults");
presets.add(actions, "exportYaml").name("export preset (.yaml)");
presets.add(actions, "importYaml").name("import preset (.yaml)");
presets.add(randomizeActions, "randomize").name("randomize (current mode)");
this.undoController = presets.add(randomizeActions, "undo").name("undo randomize").disable();

// 追加 (Issue #26)
presets.add({ manage: () => callbacks.onOpenPresetManager?.() }, "manage").name("manage presets…");
presets.add({ next: () => callbacks.onNextPreset?.() }, "next").name("next preset ▶");
presets.add({ random: () => callbacks.onRandomPreset?.() }, "random").name("random preset");
```

`SettingsPanelCallbacks` に以下を追加:

```ts
onOpenPresetManager?: () => void;
onNextPreset?: () => void;
onRandomPreset?: () => void;
```

## 10. App.ts での wiring

```ts
const presetStore = new PresetStore(localStorageAdapter("pose-particles.presets.v1"));
const presetManager = new PresetManagerPanel(presetStore, {
  getCurrentSettings: () => structuredClone(settings),
  onApply: (p) => {
    settingsPanel.applyPreset(p.settings);
    presetManager.setActivePresetId(p.id);
  },
  captureThumbnail: () => captureThumbnail(renderer, scene, camera),
});

const settingsPanel = new SettingsPanel(settings, onReanalyze, {
  onImageRequest, onImageRegridRequest,
  onOpenPresetManager: () => presetManager.show(),
  onNextPreset: () => {
    const p = presetStore.nextOf(presetManager.getActivePresetId());
    if (p) { settingsPanel.applyPreset(p.settings); presetManager.setActivePresetId(p.id); }
  },
  onRandomPreset: () => {
    const p = presetStore.randomOf(presetManager.getActivePresetId());
    if (p) { settingsPanel.applyPreset(p.settings); presetManager.setActivePresetId(p.id); }
  },
});
```

「次へ / ランダム」適用時に image preset の差替えが必要なケースは、`SettingsPanel.applyPreset` が既に `deepAssign` 経由で settings を更新する。ただし image preset 変更時のサイド効果（`onImageRequest` 通知）は現状 randomize には実装済み (`applyImageSideEffects`) なので、**プリセット適用にも同じ side-effect ルートを通す**ように `applyPreset` を拡張する（before / after を渡す）。

## 11. テスト戦略 (TDD)

| ファイル | 主なケース |
|---|---|
| `PresetStore.test.ts` | add/get/update/remove/list 順序 / 上限 50 / nextOf wrap / randomOf 直前除外 (rng 注入) / replaceAll / toBundle/fromBundle round-trip |
| `storage.test.ts` | read 失敗時の空 Bundle / write 成功 / QuotaExceededError throw |
| `thumbnail-capture.test.ts` | mock renderer で setRenderTarget→render→readRenderTargetPixels→setRenderTarget(null)→dispose の呼び出し順 / 返り値が `data:image/(webp\|png);base64,` で始まる |
| `bundle-yaml.test.ts` | round-trip / version mismatch throw / 欠損フィールドのフォールバック / settings 欠損エントリの drop |
| `PresetManagerPanel.test.ts` (jsdom) | 一覧描画 / カードクリックで onApply 呼び出し / name 編集で store.update / delete confirm / Export-Import round-trip (file I/O はモック) / ESC で hide |
| `SettingsPanel` 既存テストへ追加 | `manage presets / next / random` ボタンが対応 callback を呼ぶ |

既存テスト（197 件）はすべて維持し、追加でこれらが pass することを完了条件とする。

## 12. やらないこと（YAGNI）

- 自動巡回タイマー（順送り / 一定時間ごと）。Issue 側でも明示スコープ外。
- 単一 Settings YAML の bundle import への自動 promote
- プリセットの mode 別フィルタ / 検索
- ドラッグ&ドロップによる順序入れ替え
- クラウド共有
- 古い bundle version の migration（version=1 のみ受け付ける）

## 13. 影響範囲（既存への副作用）

- `pose-particles.settings.v1` localStorage キーは変更なし
- 既存 `preset-yaml.ts` の単一 Settings export/import は変更なし
- `SettingsPanel.applyPreset` に `applyImageSideEffects` を呼ぶ拡張のみ追加（randomize 同等の挙動）
- 既存 197 テスト全件パスを維持
