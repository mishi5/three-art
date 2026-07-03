/**
 * #207: ノード・ポート・ラベル等にヒットしなかった「背景」での pointerdown が
 * パンと矩形選択のどちらを開始するかを決める純関数。
 *
 * #229: 操作モード（PanSelectMode）で左ボタン単独の挙動を切り替えられる。
 * - 中ボタン / 右ボタン、または Space 併用 → 常にパン（モード共通・従来どおり）
 * - `modern`（既定・#207 現行）: 左ボタン単独は Shift 併用なら矩形選択、Shift 無しならパン
 * - `legacy`（#207 以前）: 左ボタン単独は Shift 有無を問わず矩形選択
 *   （#83 の「空白左ドラッグ＝矩形選択」。パンは Space+左・中・右ドラッグ）
 */
export type BackgroundDrag = "pan" | "rect";

/** #229: 空白左ドラッグの操作モード。modern=#207 現行 / legacy=#207 以前。 */
export type PanSelectMode = "modern" | "legacy";

export function backgroundPointerDrag(opts: {
  button: number;
  shiftKey: boolean;
  spaceDown: boolean;
  mode: PanSelectMode;
}): BackgroundDrag {
  if (opts.button !== 0 || opts.spaceDown) return "pan";
  if (opts.mode === "legacy") return "rect";
  return opts.shiftKey ? "rect" : "pan";
}
