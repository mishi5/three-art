/**
 * lil-gui コントローラへのホバーで {@link PARAM_DOCS} の説明を表示する
 * ツールチップ機能 (Issue #27)。
 *
 * GUI パネルは画面右端にあるため、ツールチップはコントローラの「左側」に出して
 * レンダリング画面 / パネルを覆わないようにする。
 */
import type GUI from "lil-gui";
import { PARAM_DOCS, resolveDocKey } from "./param-docs";

interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
interface Size {
  width: number;
  height: number;
}
interface Viewport {
  width: number;
  height: number;
}

/** ツールチップとアンカーの隙間 (px)。 */
const GAP = 10;

/**
 * アンカー (コントローラ行) の左側にツールチップを配置する座標を計算する。
 * 画面外にはみ出す場合はビューポート内にクランプする。純粋関数。
 */
export function computeTooltipPosition(
  anchor: Rect,
  tip: Size,
  viewport: Viewport,
): { left: number; top: number } {
  let left = anchor.left - GAP - tip.width;
  // 左に収まらなければビューポート内へクランプ (右端は anchor.left を超えない)。
  if (left < 0) left = 0;
  const maxLeft = Math.max(0, Math.min(anchor.left, viewport.width) - tip.width);
  if (left > maxLeft) left = maxLeft;

  let top = anchor.top;
  const maxTop = Math.max(0, viewport.height - tip.height);
  if (top > maxTop) top = maxTop;
  if (top < 0) top = 0;

  return { left, top };
}

/**
 * GUI 配下の全コントローラにホバーツールチップを付与する。
 * - doc がある → ホバーで summary / effect を表示
 * - settings の leaf だが doc 未登録 → console.warn (GUI 追加時のドリフト検知)
 * - settings 外 (アクションボタン等) → 何もしない
 */
export function attachParamTooltips(gui: GUI, settings: object): void {
  const tip = document.createElement("div");
  tip.className = "param-tooltip";
  Object.assign(tip.style, {
    position: "fixed",
    zIndex: "60",
    maxWidth: "260px",
    padding: "8px 10px",
    background: "rgba(20,20,24,0.95)",
    color: "#eee",
    font: "12px/1.5 system-ui, sans-serif",
    borderRadius: "6px",
    border: "1px solid rgba(255,255,255,0.15)",
    boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
    pointerEvents: "none",
    display: "none",
    whiteSpace: "normal",
  } as Partial<CSSStyleDeclaration>);
  document.body.appendChild(tip);

  const show = (anchorEl: HTMLElement, summary: string, effect: string) => {
    tip.innerHTML = "";
    const s = document.createElement("div");
    s.textContent = summary;
    const e = document.createElement("div");
    e.textContent = `▸ ${effect}`;
    e.style.marginTop = "4px";
    e.style.opacity = "0.85";
    tip.append(s, e);
    tip.style.display = "block";
    const a = anchorEl.getBoundingClientRect();
    const pos = computeTooltipPosition(
      { left: a.left, top: a.top, right: a.right, bottom: a.bottom },
      { width: tip.offsetWidth, height: tip.offsetHeight },
      { width: window.innerWidth, height: window.innerHeight },
    );
    tip.style.left = `${pos.left}px`;
    tip.style.top = `${pos.top}px`;
  };
  const hide = () => {
    tip.style.display = "none";
  };

  for (const c of gui.controllersRecursive()) {
    const key = resolveDocKey(settings, c.object, c.property);
    if (key === null) continue; // アクションボタン等
    const doc = PARAM_DOCS[key];
    if (!doc) {
      console.warn(`[param-tooltip] 説明未登録のパラメータ: ${key}`);
      continue;
    }
    const el = c.domElement as HTMLElement;
    el.addEventListener("mouseenter", () => show(el, doc.summary, doc.effect));
    el.addEventListener("mouseleave", hide);
  }
}
