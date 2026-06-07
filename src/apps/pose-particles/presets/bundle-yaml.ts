import * as YAML from "yaml";
import type { Preset, PresetBundle } from "./types";

/** 透明 1×1 WebP (任意画像差し替え前のデフォルト)。 */
export const TRANSPARENT_THUMBNAIL =
  "data:image/webp;base64,UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA";

export function serializeBundleYaml(b: PresetBundle): string {
  return YAML.stringify(b);
}

/**
 * YAML テキストを PresetBundle にパースする。version が 1 以外、または最低限の
 * 形 (object + presets:array) を満たさない場合は throw する。
 * 各エントリは欠損フィールドを安全側のデフォルトで埋める。
 * settings が欠落・非オブジェクトのエントリは drop する (壊れて見えるよりよい)。
 */
export function parseBundleYaml(text: string): PresetBundle {
  const raw = YAML.parse(text) as unknown;
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("bundle YAML must be an object");
  }
  const obj = raw as Record<string, unknown>;
  if (obj.version !== 1) {
    throw new Error(`unsupported preset bundle version: ${String(obj.version)}`);
  }
  if (!Array.isArray(obj.presets)) {
    throw new Error("bundle YAML must have a 'presets' array");
  }
  const presets: Preset[] = [];
  for (const entry of obj.presets) {
    const p = coercePreset(entry);
    if (p) presets.push(p);
  }
  return { version: 1, presets };
}

function coercePreset(entry: unknown): Preset | null {
  if (!entry || typeof entry !== "object") return null;
  const e = entry as Record<string, unknown>;
  if (!e.settings || typeof e.settings !== "object" || Array.isArray(e.settings)) return null;
  const now = Date.now();
  const id = typeof e.id === "string" && e.id.length > 0 ? e.id : fallbackId();
  const name = typeof e.name === "string" && e.name.length > 0 ? e.name : "untitled";
  const description = typeof e.description === "string" ? e.description : "";
  const thumbnail = typeof e.thumbnail === "string" && e.thumbnail.length > 0
    ? e.thumbnail
    : TRANSPARENT_THUMBNAIL;
  const createdAt = typeof e.createdAt === "number" ? e.createdAt : now;
  const updatedAt = typeof e.updatedAt === "number" ? e.updatedAt : createdAt;
  return {
    id, name, description, thumbnail,
    // settings はそのまま渡す (Settings 型に合致しているかは呼び出し側で deepMerge する想定)
    settings: e.settings as Preset["settings"],
    createdAt, updatedAt,
  };
}

function fallbackId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  return `p_${Math.random().toString(36).slice(2)}_${Date.now().toString(36)}`;
}
