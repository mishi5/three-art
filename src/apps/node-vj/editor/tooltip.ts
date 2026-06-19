// #114: ノード/param/ポートのマウスオーバー説明ツールチップ。
// ヒット結果→表示テキストの解決と、画面端を避ける配置・テキスト折り返しを純関数で持つ。
// 描画とホバー判定タイミングは NodeEditor 側（canvas 直描画・ズーム非依存のスクリーン座標）。
import type { NodeRegistry } from "../graph/node-type";
import type { HitResult } from "./hit-test";

export interface TooltipContent {
  /** 見出し（ノード type / param ラベル / ポートラベル）。 */
  title: string;
  /** 説明本文（description）。 */
  body: string;
}

/**
 * ヒット結果から表示するツールチップ内容を引く。説明（description）が無ければ null。
 * - node  : ノード type を見出し、def.description を本文に
 * - param : param ラベルを見出し、param.description を本文に
 * - port  : ポートラベルを見出し、port.description（param 入力は params から解決）を本文に
 */
export function tooltipForHit(hit: HitResult, registry: NodeRegistry): TooltipContent | null {
  if (!hit) return null;
  const def = registry.get(hit.node.type);
  if (!def) return null;

  if (hit.kind === "node") {
    return def.description ? { title: def.type, body: def.description } : null;
  }

  if (hit.kind === "param") {
    const pd = def.params[hit.paramIndex];
    return pd?.description ? { title: pd.label, body: pd.description } : null;
  }

  if (hit.kind === "port") {
    const list = hit.portKind === "output" ? def.outputs : def.inputs;
    const port = list.find((p) => p.id === hit.port);
    if (port?.description) return { title: port.label, body: port.description };
    // param 入力ポート（数値 param のドット）は inputs に無いので params から解決。
    const param = def.params.find((p) => p.id === hit.port);
    if (param?.description) return { title: param.label, body: param.description };
    return null;
  }

  return null;
}

export interface TooltipBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * カーソル (sx,sy スクリーン座標) の右下にサイズ (w,h) の箱を出す。
 * 右/下にはみ出すなら左/上へ反転し、それでも収まらなければ最小マージンへクランプ。
 */
export function tooltipBox(
  sx: number,
  sy: number,
  w: number,
  h: number,
  viewW: number,
  viewH: number,
  cursorGap = 14,
  margin = 6,
): TooltipBox {
  let x = sx + cursorGap;
  let y = sy + cursorGap;
  if (x + w + margin > viewW) x = sx - cursorGap - w; // 左へ反転
  if (y + h + margin > viewH) y = sy - cursorGap - h; // 上へ反転
  if (x + w + margin > viewW) x = viewW - margin - w;
  if (y + h + margin > viewH) y = viewH - margin - h;
  if (x < margin) x = margin;
  if (y < margin) y = margin;
  return { x, y, w, h };
}

/**
 * テキストを最大幅 maxWidth(px) で折り返す。measure は文字列の描画幅を返す関数。
 * 空白区切りで貪欲に詰め、1 単語が幅を超える場合はその単語を 1 行に置く（はみ出し許容）。
 */
export function wrapLines(text: string, maxWidth: number, measure: (s: string) => number): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  const words = trimmed.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && measure(candidate) > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines;
}
