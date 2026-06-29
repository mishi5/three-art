// #206: クリップ項目（コピーしたノード群）のミニ配置図サムネイル。
// ノードの位置・サイズ・カテゴリ色と内部接続を小さな canvas に描いて data URL 化し、履歴一覧で表示する。
// 配置変換（bbox を枠内に収める）は純関数 thumbTransform で切り出してテストする。
import { nodeRect, CATEGORY_COLORS } from "./layout";
import type { Connection, NodeInstance } from "../graph/graph-doc";
import type { NodeRegistry } from "../graph/node-type";

export interface Rect { x: number; y: number; w: number; h: number }
export interface ThumbTransform { scale: number; ox: number; oy: number }

/**
 * rects（world 座標）を W×H（内側 pad 付き）へ中央寄せ・アスペクト維持で収める変換を返す。
 * world(x,y) → 画面 = x*scale+ox, y*scale+oy。空集合は等倍・原点。
 */
export function thumbTransform(rects: readonly Rect[], W: number, H: number, pad: number): ThumbTransform {
  if (rects.length === 0) return { scale: 1, ox: 0, oy: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x); minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w); maxY = Math.max(maxY, r.y + r.h);
  }
  const bw = Math.max(1, maxX - minX), bh = Math.max(1, maxY - minY);
  const innerW = Math.max(1, W - pad * 2), innerH = Math.max(1, H - pad * 2);
  const scale = Math.min(innerW / bw, innerH / bh);
  const ox = pad + (innerW - bw * scale) / 2 - minX * scale;
  const oy = pad + (innerH - bh * scale) / 2 - minY * scale;
  return { scale, ox, oy };
}

/** ノードの矩形（registry から引けないノードは標準サイズで近似）。 */
function rectsOf(nodes: readonly NodeInstance[], registry: NodeRegistry): Map<string, Rect> {
  const m = new Map<string, Rect>();
  for (const n of nodes) {
    const def = registry.get(n.type);
    m.set(n.id, def ? nodeRect(n, def) : { x: n.position?.x ?? 0, y: n.position?.y ?? 0, w: 168, h: 40 });
  }
  return m;
}

/** クリップのミニ配置図を W×H の PNG data URL で返す（canvas 不可時は空文字）。 */
export function renderClipThumbnail(
  nodes: readonly NodeInstance[], connections: readonly Connection[], registry: NodeRegistry,
  W = 116, H = 56,
): string {
  const canvas = document.createElement("canvas");
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext("2d");
  if (!ctx) return "";
  ctx.fillStyle = "#0e0e13";
  ctx.fillRect(0, 0, W, H);

  const rmap = rectsOf(nodes, registry);
  const t = thumbTransform([...rmap.values()], W, H, 4);

  // 内部接続（出力右辺中央 → 入力左辺中央）。
  ctx.strokeStyle = "#3a5a7a";
  ctx.lineWidth = 1;
  for (const c of connections) {
    const a = rmap.get(c.from.node), b = rmap.get(c.to.node);
    if (!a || !b) continue;
    ctx.beginPath();
    ctx.moveTo((a.x + a.w) * t.scale + t.ox, (a.y + a.h / 2) * t.scale + t.oy);
    ctx.lineTo(b.x * t.scale + t.ox, (b.y + b.h / 2) * t.scale + t.oy);
    ctx.stroke();
  }

  // ノード矩形（カテゴリ色）。
  for (const n of nodes) {
    const r = rmap.get(n.id);
    if (!r) continue;
    ctx.fillStyle = CATEGORY_COLORS[registry.get(n.type)?.category ?? ""] ?? "#333";
    ctx.strokeStyle = "rgba(0,0,0,0.5)";
    const x = r.x * t.scale + t.ox, y = r.y * t.scale + t.oy;
    const w = Math.max(2, r.w * t.scale), h = Math.max(2, r.h * t.scale);
    ctx.fillRect(x, y, w, h);
    ctx.strokeRect(x, y, w, h);
  }
  return canvas.toDataURL("image/png");
}
