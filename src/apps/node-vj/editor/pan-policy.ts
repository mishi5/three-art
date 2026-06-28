/**
 * #207: ノード・ポート・ラベル等にヒットしなかった「背景」での pointerdown が
 * パンと矩形選択のどちらを開始するかを決める純関数。
 *
 * - 中ボタン / 右ボタン、または Space 併用 → 常にパン（従来どおり）
 * - 左ボタン単独: Shift 併用なら矩形選択、Shift 無しならパン
 *   （#83 では空白左ドラッグ＝矩形選択だったが、#207 で空白左ドラッグをパンに変更）
 */
export type BackgroundDrag = "pan" | "rect";

export function backgroundPointerDrag(opts: {
  button: number;
  shiftKey: boolean;
  spaceDown: boolean;
}): BackgroundDrag {
  if (opts.button !== 0 || opts.spaceDown) return "pan";
  return opts.shiftKey ? "rect" : "pan";
}
