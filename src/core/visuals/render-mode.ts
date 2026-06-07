// レンダリングモードの共有定義。pose-particles / node-vj 双方の visual が参照する。
// shader の switch と一致する整数マッピングを含む。

export type RenderMode = "bones" | "cube" | "sphere" | "lattice" | "image" | "rain";

export const RENDER_MODES: ReadonlyArray<RenderMode> = ["bones", "cube", "sphere", "lattice", "image", "rain"];

export type PolyhedronFaces = 4 | 6 | 8 | 12;
export const POLYHEDRON_FACES: ReadonlyArray<PolyhedronFaces> = [4, 6, 8, 12];

/** Numeric mode passed to shaders (must match shader switch). */
export function modeToInt(mode: RenderMode): number {
  switch (mode) {
    case "bones": return 0;
    case "cube": return 1;
    case "sphere": return 2;
    case "lattice": return 3;
    case "image": return 4;
    case "rain": return 5;
  }
}
