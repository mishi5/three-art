import type { Settings } from "../settings";

/**
 * 1 プリセット = 設定スナップショット + メタ情報 + サムネ。
 * id は不変、settings は登録時点の値を構造コピーで保持する。
 */
export interface Preset {
  /** crypto.randomUUID() で発番。不変。 */
  id: string;
  /** 表示名。空文字不可 (保存側で "untitled" に強制する)。 */
  name: string;
  /** 説明文。複数行可。空文字許可。 */
  description: string;
  /** "data:image/webp;base64,..." または "data:image/png;base64,..."。 */
  thumbnail: string;
  /** 登録時点の Settings スナップショット (構造コピー)。 */
  settings: Settings;
  /** Date.now()。 */
  createdAt: number;
  /** Date.now()。update のたびに更新。 */
  updatedAt: number;
}

/** YAML 一式 export/import の上位コンテナ。 */
export interface PresetBundle {
  version: 1;
  presets: Preset[];
}

/** ストアの永続化アダプタ。in-memory / localStorage を差し替え可能にする。 */
export interface PresetStorageAdapter {
  /** 失敗時は空 Bundle ({ version: 1, presets: [] }) を返す。throw しない。 */
  read(): PresetBundle;
  /** QuotaExceededError 等は呼び出し側で catch するため throw して良い。 */
  write(bundle: PresetBundle): void;
}

/** add 時に必要な入力。id / createdAt / updatedAt はストアが付与する。 */
export interface PresetInput {
  name: string;
  description: string;
  thumbnail: string;
  settings: Settings;
}

/** update のパッチ。id / createdAt は変更不可。 */
export type PresetPatch = Partial<Pick<Preset, "name" | "description" | "thumbnail" | "settings">>;

/** ソフトリミット (UI 側で alert)。 */
export const PRESET_LIMIT = 50;
