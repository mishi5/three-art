import type {
  Preset,
  PresetBundle,
  PresetInput,
  PresetPatch,
  PresetStorageAdapter,
} from "./types";
import { PRESET_LIMIT } from "./types";

/**
 * プリセットの CRUD + 永続化を担うストア。
 *
 * 設定変更との分離:
 *   add 時に settings は structuredClone で保持するため、呼び出し側の Settings
 *   オブジェクトをその後ライブ編集してもストアには影響しない。
 *
 * 順序:
 *   list() は createdAt 昇順 (= 登録順)。 next preset / random preset で
 *   この順序が UX 上の「登録順」と一致する。
 */
export class PresetStore {
  private bundle: PresetBundle;

  constructor(private readonly adapter: PresetStorageAdapter) {
    this.bundle = adapter.read();
    if (!this.bundle || this.bundle.version !== 1 || !Array.isArray(this.bundle.presets)) {
      this.bundle = { version: 1, presets: [] };
    }
  }

  list(): Preset[] {
    return [...this.bundle.presets].sort((a, b) => a.createdAt - b.createdAt);
  }

  get(id: string): Preset | null {
    return this.bundle.presets.find((p) => p.id === id) ?? null;
  }

  add(input: PresetInput): Preset {
    if (this.bundle.presets.length >= PRESET_LIMIT) {
      throw new RangeError(`preset limit reached (${PRESET_LIMIT})`);
    }
    const now = Date.now();
    const p: Preset = {
      id: cryptoRandomId(),
      name: input.name && input.name.length > 0 ? input.name : "untitled",
      description: input.description,
      thumbnail: input.thumbnail,
      settings: structuredClone(input.settings),
      createdAt: now,
      updatedAt: now,
    };
    this.bundle.presets.push(p);
    this.flush();
    return p;
  }

  update(id: string, patch: PresetPatch): Preset {
    const idx = this.bundle.presets.findIndex((p) => p.id === id);
    if (idx < 0) throw new Error(`preset not found: ${id}`);
    const prev = this.bundle.presets[idx];
    const next: Preset = {
      ...prev,
      ...(patch.name !== undefined ? { name: patch.name.length > 0 ? patch.name : "untitled" } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.thumbnail !== undefined ? { thumbnail: patch.thumbnail } : {}),
      ...(patch.settings !== undefined ? { settings: structuredClone(patch.settings) } : {}),
      updatedAt: Date.now(),
    };
    this.bundle.presets[idx] = next;
    this.flush();
    return next;
  }

  remove(id: string): void {
    const before = this.bundle.presets.length;
    this.bundle.presets = this.bundle.presets.filter((p) => p.id !== id);
    if (this.bundle.presets.length !== before) this.flush();
  }

  toBundle(): PresetBundle {
    return structuredClone(this.bundle);
  }

  fromBundle(bundle: PresetBundle): void {
    if (bundle.version !== 1) throw new Error(`unsupported bundle version: ${bundle.version}`);
    this.bundle = { version: 1, presets: structuredClone(bundle.presets) };
    this.flush();
  }

  replaceAll(presets: Preset[]): void {
    this.bundle = { version: 1, presets: structuredClone(presets) };
    this.flush();
  }

  private flush(): void {
    this.adapter.write(this.bundle);
  }
}

/** crypto.randomUUID() を使い、未サポート環境 (古いノード等) では fallback。 */
function cryptoRandomId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
