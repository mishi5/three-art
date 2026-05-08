import YAML from "yaml";
import type { StylePreset } from "./AutomationMap";
import { DEFAULT_STYLE_PRESETS } from "./AutomationMap";

const YAML_URL = "/pose-particles/auto-styles.yaml";

interface YamlFeatures {
  energyNorm: number;
  bassAbs: number;
  midAbs: number;
  trebleAbs: number;
}

interface YamlStyle {
  name?: string;
  features: YamlFeatures;
  overrides?: Record<string, unknown>;
}

interface YamlDoc {
  styles: YamlStyle[];
}

function isFiniteNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function validateFeatures(f: unknown, ctx: string): YamlFeatures {
  const obj = f as Partial<YamlFeatures> | null;
  if (
    !obj ||
    !isFiniteNumber(obj.energyNorm) ||
    !isFiniteNumber(obj.bassAbs) ||
    !isFiniteNumber(obj.midAbs) ||
    !isFiniteNumber(obj.trebleAbs)
  ) {
    throw new Error(`${ctx}: features 不正 (energyNorm/bassAbs/midAbs/trebleAbs が必須)`);
  }
  return {
    energyNorm: obj.energyNorm,
    bassAbs: obj.bassAbs,
    midAbs: obj.midAbs,
    trebleAbs: obj.trebleAbs,
  };
}

/**
 * YAML から StylePreset[] を読み込む。失敗時は fallback (コード埋め込みの
 * DEFAULT_STYLE_PRESETS) を返す。
 */
export async function loadStylePresets(): Promise<ReadonlyArray<StylePreset>> {
  try {
    const res = await fetch(YAML_URL);
    if (!res.ok) {
      console.warn(`[style-loader] failed to fetch ${YAML_URL}: ${res.status}, using fallback`);
      return DEFAULT_STYLE_PRESETS;
    }
    const text = await res.text();
    const doc = YAML.parse(text) as YamlDoc | null;
    if (!doc || !Array.isArray(doc.styles)) {
      console.warn("[style-loader] invalid YAML: missing 'styles' array, using fallback");
      return DEFAULT_STYLE_PRESETS;
    }
    const presets: StylePreset[] = doc.styles.map((s, i) => ({
      features: validateFeatures(s.features, `style[${i}] (${s.name ?? "anon"})`),
      overrides: s.overrides ?? {},
    }));
    if (presets.length === 0) {
      console.warn("[style-loader] empty styles array, using fallback");
      return DEFAULT_STYLE_PRESETS;
    }
    console.log(`[style-loader] loaded ${presets.length} style presets from ${YAML_URL}`);
    return presets;
  } catch (e) {
    console.warn("[style-loader] error, using fallback:", e);
    return DEFAULT_STYLE_PRESETS;
  }
}
