/**
 * render mode → そのモードで通常表示 (enable) すべき Mode ゾーンサブフォルダ
 * 集合の写像 (Issue #23)。SettingsPanel の disable 制御の正本。純粋関数。
 */
import type { RenderMode } from "../settings";

/** Mode ゾーン配下のサブフォルダ識別子。 */
export type ModeFolderKey = "shape" | "wave" | "lattice" | "image" | "rain";

/** その mode で enable すべきモードフォルダ集合。bones は空集合。 */
export function activeModeFolders(mode: RenderMode): ReadonlySet<ModeFolderKey> {
  switch (mode) {
    case "bones":
      return new Set();
    case "cube":
    case "sphere":
      return new Set(["shape"]);
    case "lattice":
      return new Set(["wave", "lattice"]);
    case "image":
      return new Set(["wave", "image"]);
    case "rain":
      return new Set(["rain"]);
  }
}
