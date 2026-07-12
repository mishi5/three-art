// #282: Screen ノード別の専用出力ウィンドウのマネージャ。
// 各 Screen の「⧉ 出力」トグルで、その Screen 専用のオフスクリーン 2D canvas ＋
// 別ウィンドウ（OutputWindow の汎用ミラー）を開く。毎フレーム GraphRuntime の評価後に
// renderFrame が呼ばれ、各 Screen の texture をコーナーピンワープ（逆 homography）付きで
// 出力 canvas へ転写する（描画の実体は deps.drawWarped＝メイン renderer の default
// framebuffer 経由の GPU-GPU コピー。読み戻しはしない）。
// DOM/renderer 依存は deps 注入で差し替え可能（ClipLauncher の ClipMediaDeps パターン）。
import type * as THREE from "three";
import type { GraphDoc } from "./graph/graph-doc";
import { SCREEN_TEXTURE_KEY } from "./graph/texture-screen";
import {
  WARP_PARAM_IDS, homographyFromCorners, sanitizeCorners, type Mat3, type WarpParamId,
} from "./warp-logic";
import { WARP_STATE_TYPE } from "./warp-messages";
import { WarpBlitter } from "./warp-blit";
import { OutputWindow } from "./output-window";
import { buildScreenOutputHtml, screenOutputWindowName } from "./screen-output-html";

/** OutputWindow の最小サーフェス（テストではフェイクを注入する）。 */
export interface MirrorWindowLike {
  /** ウィンドウが閉じられた時に呼ばれる（手動クローズの polling 検知含む）。 */
  onClose: (() => void) | null;
  isOpen(): boolean;
  open(source: HTMLCanvasElement): void;
  close(): void;
  contentWindow(): Window | null;
}

/** ScreenOutputs の外部依存（DOM/renderer）。 */
export interface ScreenOutputsDeps {
  /** Screen 1 系統ぶんの出力用 2D canvas を作る。 */
  createCanvas(): HTMLCanvasElement;
  /** Screen ノード id 専用の出力ウィンドウを作る（window name はユニーク化する）。 */
  createWindow(nodeId: string): MirrorWindowLike;
  /**
   * texture を逆 homography（uInvH）付きでワープ描画し dst canvas へ転写する。
   * 実装はメイン renderer の default framebuffer へ描いて drawImage する GPU 経路
   * （読み戻し禁止・texture は WebGL コンテキストを跨げない）。
   */
  drawWarped(texture: unknown, invH: Mat3, dst: HTMLCanvasElement): void;
}

/**
 * 実 DOM/renderer を使う既定 deps。ワープ描画はメイン renderer の default framebuffer へ
 * 全画面クアッドを描き、renderer.domElement を出力 canvas へ drawImage（GPU-GPU コピー）する。
 * readRenderTargetPixels（CPU 読み戻し）は 60fps で重いため使わない。
 */
export function domScreenOutputDeps(renderer: THREE.WebGLRenderer): ScreenOutputsDeps {
  const warp = new WarpBlitter();
  return {
    createCanvas: () => document.createElement("canvas"),
    createWindow: (nodeId) =>
      new OutputWindow({ name: screenOutputWindowName(nodeId), html: buildScreenOutputHtml(nodeId) }),
    drawWarped: (texture, invH, dst) => {
      const prev = renderer.getRenderTarget();
      renderer.setRenderTarget(null);
      warp.blit(renderer, texture as THREE.Texture, invH);
      renderer.setRenderTarget(prev);
      const src = renderer.domElement;
      if (src.width === 0 || src.height === 0) return;
      if (dst.width !== src.width || dst.height !== src.height) {
        dst.width = src.width;
        dst.height = src.height;
      }
      dst.getContext("2d")?.drawImage(src, 0, 0);
    },
  };
}

interface Entry {
  canvas: HTMLCanvasElement;
  window: MirrorWindowLike;
  /** 直近に子ウィンドウへ同期した 4 隅 param のシリアライズ（変化検知用）。 */
  lastStateJson: string | null;
}

/**
 * Screen ノード id → { 出力 canvas, 出力ウィンドウ } を管理するマネージャ。
 * 開閉状態の変化（トグル・手動クローズ・ノード削除）は onOpenStateChange で親へ通知し、
 * 親（main.ts）が描画解像度と keepAlive を同期する。
 */
export class ScreenOutputs {
  /** 開閉状態が変わったとき（トグル・手動クローズ・ノード削除）。 */
  onOpenStateChange: (() => void) | null = null;
  private entries = new Map<string, Entry>();

  constructor(private readonly deps: ScreenOutputsDeps) {}

  /** 指定 Screen の出力ウィンドウが開いているか。 */
  isOpen(nodeId: string): boolean {
    return this.entries.get(nodeId)?.window.isOpen() ?? false;
  }

  /** いずれかの Screen 出力が開いているか（描画解像度/keepAlive の判定用）。 */
  anyOpen(): boolean {
    for (const e of this.entries.values()) {
      if (e.window.isOpen()) return true;
    }
    return false;
  }

  /** 出力ウィンドウの開閉をトグルする（ノード上の「⧉ 出力」ボタン）。 */
  toggle(nodeId: string): void {
    if (this.isOpen(nodeId)) {
      this.close(nodeId);
      return;
    }
    const canvas = this.deps.createCanvas();
    const win = this.deps.createWindow(nodeId);
    win.onClose = () => {
      // 手動クローズ（polling 検知）と close() の両方がここへ来る＝片付けの単一経路。
      if (this.entries.get(nodeId)?.window === win) {
        this.entries.delete(nodeId);
        this.onOpenStateChange?.();
      }
    };
    win.open(canvas);
    if (!win.isOpen()) return; // ポップアップブロック時はエントリを持たない
    this.entries.set(nodeId, { canvas, window: win, lastStateJson: null });
    this.onOpenStateChange?.();
  }

  /** 指定 Screen の出力ウィンドウを閉じる。 */
  close(nodeId: string): void {
    this.entries.get(nodeId)?.window.close(); // onClose 経由でエントリ削除・通知
  }

  /** 全出力ウィンドウを閉じる（アプリ終了・全クリーンアップ用）。 */
  closeAll(): void {
    for (const id of [...this.entries.keys()]) this.close(id);
  }

  /** 管理中の出力ウィンドウの Window か（子からの postMessage の e.source 検証）。 */
  ownsWindow(source: unknown): boolean {
    if (!source) return false;
    for (const e of this.entries.values()) {
      if (e.window.contentWindow() === source) return true;
    }
    return false;
  }

  /** 指定 Screen の出力ウィンドウの Window（未 open は null）。 */
  windowFor(nodeId: string): Window | null {
    return this.entries.get(nodeId)?.window.contentWindow() ?? null;
  }

  /**
   * 毎フレームの描画（GraphRuntime の評価後・メイン合成前に呼ぶ）。
   * - グラフから消えた Screen（削除・シーン切替）はウィンドウを閉じる
   * - 4 隅 param が変化していれば子ウィンドウへ warp-state を同期する
   * - texture があればワープ（逆 homography）付きで出力 canvas へ転写する
   */
  renderFrame(graph: GraphDoc, outputs: ReadonlyMap<string, Record<string, unknown>>): void {
    for (const [id, entry] of [...this.entries]) {
      const node = graph.nodes.find((n) => n.id === id);
      if (!node) {
        this.close(id);
        continue;
      }
      this.syncWarpState(id, entry, node.params);
      const tex = outputs.get(id)?.[SCREEN_TEXTURE_KEY];
      if (!tex) continue;
      const { inverse } = homographyFromCorners(sanitizeCorners(node.params));
      this.deps.drawWarped(tex, inverse, entry.canvas);
    }
  }

  /** 4 隅 param の変化時（と初回）に warp-state を子ウィンドウへ送る（ハンドル位置の同期）。 */
  private syncWarpState(id: string, entry: Entry, params: Record<string, unknown>): void {
    const c = sanitizeCorners(params);
    const corners: Record<WarpParamId, number> = {
      tlX: c.tl.x, tlY: c.tl.y, trX: c.tr.x, trY: c.tr.y,
      blX: c.bl.x, blY: c.bl.y, brX: c.br.x, brY: c.br.y,
    };
    const json = JSON.stringify(WARP_PARAM_IDS.map((pid) => corners[pid]));
    if (json === entry.lastStateJson) return;
    entry.lastStateJson = json;
    entry.window.contentWindow()?.postMessage({ type: WARP_STATE_TYPE, screenId: id, corners }, "*");
  }
}
