// param 編集用の一時 HTML input オーバーレイ。
// Canvas2D 全描画方針のなか、テキスト/数値入力だけは native input を一時的に重ねる。
import type { ParamKind } from "../graph/node-type";

export interface ParamInputOptions {
  /** 画面座標（CSS px）。 */
  screenX: number;
  screenY: number;
  width: number;
  value: unknown;
  kind: ParamKind;
  options?: string[];
  onCommit: (value: unknown) => void;
}

/** param 編集用の input/select を生成して表示する。commit/cancel で自動的に除去。 */
export function openParamInput(opts: ParamInputOptions): void {
  const isEnum = opts.kind === "enum" && opts.options && opts.options.length > 0;
  const el: HTMLInputElement | HTMLSelectElement = isEnum
    ? document.createElement("select")
    : document.createElement("input");

  el.style.cssText =
    `position:fixed;left:${opts.screenX}px;top:${opts.screenY}px;width:${opts.width}px;` +
    "z-index:200;font:12px monospace;box-sizing:border-box;";

  if (el instanceof HTMLSelectElement) {
    for (const o of opts.options!) {
      const opt = document.createElement("option");
      opt.value = o; opt.textContent = o;
      if (o === String(opts.value)) opt.selected = true;
      el.appendChild(opt);
    }
  } else {
    el.type = opts.kind === "boolean" ? "text" : opts.kind === "string" ? "text" : "number";
    el.value = String(opts.value ?? "");
  }

  let done = false;
  const cleanup = (): void => { if (!done) { done = true; el.remove(); } };

  const commit = (): void => {
    if (done) return;
    opts.onCommit(parseValue(el.value, opts.kind));
    cleanup();
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key === "Enter") { e.preventDefault(); commit(); }
    else if (e.key === "Escape") { e.preventDefault(); cleanup(); }
  };
  el.addEventListener("keydown", onKey as EventListener);
  el.addEventListener("blur", commit);
  if (el instanceof HTMLSelectElement) el.addEventListener("change", commit);

  document.body.appendChild(el);
  el.focus();
  if (el instanceof HTMLInputElement) el.select();
}

function parseValue(raw: string, kind: ParamKind): unknown {
  switch (kind) {
    case "number": return Number(raw);
    case "int": return Math.round(Number(raw));
    case "boolean": return raw === "true" || raw === "1";
    default: return raw;
  }
}
