// 全画面テクスチャ転写（#76）。RT に描いた Visual の結果を canvas へ出すための
// 最小ヘルパ。1 枚目は通常合成（背景を覆う）、2 枚目以降は加算合成で重ねる。
import * as THREE from "three";

export class TextureBlitter {
  private scene = new THREE.Scene();
  private camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  private material: THREE.MeshBasicMaterial;
  private mesh: THREE.Mesh;

  constructor() {
    this.material = new THREE.MeshBasicMaterial({ depthTest: false, depthWrite: false });
    // 全画面を覆う 2 三角形クアッド
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.material);
    this.scene.add(this.mesh);
  }

  /**
   * texture を画面（現在の renderTarget=null）へ全画面転写する。
   * additive=false は通常描画（既存内容を覆う）、true は加算合成。
   */
  blit(renderer: THREE.WebGLRenderer, texture: THREE.Texture, additive: boolean): void {
    this.material.map = texture;
    this.material.blending = additive ? THREE.AdditiveBlending : THREE.NormalBlending;
    this.material.transparent = additive;
    this.material.needsUpdate = true;
    const prevAutoClear = renderer.autoClear;
    renderer.autoClear = false; // 複数枚の転写を上書きしない
    renderer.render(this.scene, this.camera);
    renderer.autoClear = prevAutoClear;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}
