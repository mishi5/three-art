import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import type { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import type { PostEffect, SmoothedAudio } from "./PostEffect";
import type { Settings } from "../../settings";
import { BlurEffect } from "./BlurEffect";
import { KaleidoscopeEffect } from "./KaleidoscopeEffect";

/**
 * 部品化された post effect を順序付きで直列接続するパイプライン。
 *
 * 順序入れ替え時のみ EffectComposer を再構築 (`rebuild`)。毎フレームの
 * update では `syncOrder` で等価比較し、変化なしなら no-op。サムネ用には
 * `createPassesForTarget` が現在の順序で全 effect 分の独立 pass を生成する。
 */
export class PostPipeline {
  private composer: EffectComposer;
  private renderPass: RenderPass;
  private outputPass: OutputPass;
  private effects: Map<string, PostEffect>;
  private order: string[];

  constructor(
    private renderer: THREE.WebGLRenderer,
    scene: THREE.Scene,
    camera: THREE.Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.renderPass = new RenderPass(scene, camera);
    this.outputPass = new OutputPass();
    this.effects = new Map<string, PostEffect>();
    this.effects.set("blur", new BlurEffect());
    this.effects.set("kaleidoscope", new KaleidoscopeEffect());
    this.order = ["blur", "kaleidoscope", "fractal"];
    this.rebuild();
  }

  hasEffect(id: string): boolean {
    return this.effects.has(id);
  }

  currentOrder(): string[] {
    return this.order.slice();
  }

  /** 未知 ID を除外しつつ既知 effect の順序を newOrder の出現順に揃える。 */
  syncOrder(newOrder: string[]): void {
    const filtered: string[] = [];
    const seen = new Set<string>();
    for (const id of newOrder) {
      if (this.effects.has(id) && !seen.has(id)) {
        filtered.push(id);
        seen.add(id);
      }
    }
    for (const id of this.effects.keys()) {
      if (!seen.has(id)) filtered.push(id);
    }
    if (arraysEqual(filtered, this.order)) return;
    this.order = filtered;
    this.rebuild();
  }

  private rebuild(): void {
    while (this.composer.passes.length > 0) this.composer.removePass(this.composer.passes[0]!);
    this.composer.addPass(this.renderPass);
    for (const id of this.order) {
      const e = this.effects.get(id);
      if (!e) continue;
      for (const p of e.passes) this.composer.addPass(p);
    }
    this.composer.addPass(this.outputPass);
  }

  setSize(w: number, h: number): void {
    this.composer.setSize(w, h);
    const dpr = this.renderer.getPixelRatio();
    for (const e of this.effects.values()) e.setSize(w, h, dpr);
  }

  update(settings: Settings, audio: SmoothedAudio): void {
    this.syncOrder(settings.post.order);
    for (const e of this.effects.values()) e.update(settings, audio);
  }

  render(): void {
    this.composer.render();
  }

  createPassesForTarget(
    targetW: number,
    targetH: number,
    fullSourceW: number,
  ): ShaderPass[] {
    const out: ShaderPass[] = [];
    for (const id of this.order) {
      const e = this.effects.get(id);
      if (!e) continue;
      out.push(...e.createPassesForTarget(targetW, targetH, fullSourceW));
    }
    return out;
  }

  dispose(): void {
    for (const e of this.effects.values()) e.dispose();
    this.outputPass.dispose();
    this.renderPass.dispose?.();
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}
