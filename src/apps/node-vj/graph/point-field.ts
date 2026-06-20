// #101: GPGPU 位置テクスチャ方式の点群データ表現。
// ノード間（PointShape → PointTransform → ParticleRender）を流れる points ポートの値。
import type * as THREE from "three";

/**
 * GPU 常駐の点群。位置テクスチャ（RGBA32F, 1テクセル=1粒子, RGB=xyz）と粒子数・寸法を持つ。
 * texture は生成元ノードの RenderTarget.texture 参照（毎フレーム更新される安定参照）。
 */
export interface PointField {
  texture: THREE.Texture;
  count: number;
  texW: number;
  texH: number;
  /**
   * #121: 任意の per-particle 色テクスチャ（RGBA32F, RGB=色, 1テクセル=1粒子）。
   * image モード等が出力する。無ければ ParticleRender は従来の HSV(seed) で着色する。
   */
  colorTexture?: THREE.Texture;
}

/**
 * count 粒子を収める位置テクスチャの寸法。texW=ceil(sqrt(count)) のほぼ正方形。
 * count<=0 でも RT を作れるよう最小 1x1 を返す。
 */
export function fieldTexSize(count: number): { w: number; h: number } {
  if (count <= 0) return { w: 1, h: 1 };
  const w = Math.ceil(Math.sqrt(count));
  const h = Math.ceil(count / w);
  return { w, h };
}
