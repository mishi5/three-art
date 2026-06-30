// #202: texture シーケンサ。複数 texture 入力を trigger の立ち上がりごとに順送りで 1 つ出力する。
// 動的ポートは未対応のため固定 N 個の texture 入力（接続済みのみを定義順に巡回）＋ trigger / reset。
// 出力は選択中入力の texture をそのままパススルー（RT 不要）。
import type { NodeState, NodeTypeDef } from "../graph/node-type";

/** texture 入力スロット数（固定）。 */
export const SEQ_TEX_COUNT = 8;
/** texture 入力ポート id（tex1..texN・定義順＝巡回順）。 */
export const SEQ_INPUTS: readonly string[] =
  Array.from({ length: SEQ_TEX_COUNT }, (_, i) => `tex${i + 1}`);

/** TextureSequencer のフレーム間状態。step は trigger 累積回数、prev で各 trigger のエッジ検出。 */
export class TextureSequencerRuntime {
  step = 0;
  prevTrigger = false;
  prevReset = false;
}

/**
 * #202: 次の step を求める純関数。reset 立ち上がりで 0（優先）、trigger 立ち上がりで進める。
 * random=on のときは trigger ごとに接続数 count 内のランダムな位置へ（rng は 0..1 の乱数源）、
 * off のときは +1（読み出し側で接続数 wrap）。エッジでなければ据え置き。
 */
export function sequencerStep(
  step: number,
  prev: { trigger: boolean; reset: boolean },
  cur: { trigger: boolean; reset: boolean },
  opts: { count: number; random: boolean; rng: () => number },
): number {
  if (cur.reset && !prev.reset) return 0;
  if (cur.trigger && !prev.trigger) {
    return opts.random ? Math.floor(opts.rng() * Math.max(1, opts.count)) : step + 1;
  }
  return step;
}

/**
 * #202: 接続済みポート index 配列の中から step に対応するものを選ぶ。
 * step を接続数で wrap するため、接続数が変わっても破綻しない（接続なしは null）。
 */
export function selectSeqPort(step: number, connectedPorts: readonly number[]): number | null {
  const n = connectedPorts.length;
  if (n === 0) return null;
  return connectedPorts[((step % n) + n) % n] ?? null;
}

/** texture シーケンサノード（#202）。trigger 受信ごとに接続済み texture 入力を順送りで出力・ループ。 */
export const TextureSequencerNode: NodeTypeDef = {
  type: "TextureSequencer",
  category: "process",
  description: "複数の texture 入力を trigger の発火ごとに 1 つずつ順送りで出力する（末尾でループ）。onset/拍に合わせて映像ネタを切り替える用途。接続したスロットだけを定義順に巡回する。",
  inputs: [
    ...SEQ_INPUTS.map((id, i) => ({
      id, label: `t${i + 1}`, type: "texture" as const,
      description: `シーケンス入力 ${i + 1}。接続したスロットだけを順番に巡回する。`,
    })),
    { id: "trigger", label: "trig", type: "trigger", description: "立ち上がりエッジで次の texture へ進める。" },
    { id: "reset", label: "reset", type: "trigger", description: "立ち上がりエッジで先頭（最初の接続スロット）へ戻す。" },
  ],
  outputs: [{ id: "texture", label: "tex", type: "texture", description: "現在選択中の入力 texture（接続なしは無出力）。" }],
  params: [
    { id: "random", label: "random", kind: "enum", default: "off", options: ["off", "on"],
      description: "ON で trigger ごとに接続中の texture からランダムに選ぶ（OFF は順送り）。" },
  ],
  createState: () => new TextureSequencerRuntime(),
  evaluate: (ctx) => {
    const s = ctx.state as TextureSequencerRuntime | undefined;
    if (!s) return { texture: undefined };
    const trigger = Boolean(ctx.input("trigger"));
    const reset = Boolean(ctx.input("reset"));
    const random = ctx.param("random") === "on";
    // 接続済みスロット（ctx.input が undefined なら未接続）を定義順に集める。
    const textures = SEQ_INPUTS.map((id) => ctx.input(id));
    const connected = textures.map((t, i) => (t != null ? i : -1)).filter((i) => i >= 0);
    s.step = sequencerStep(
      s.step, { trigger: s.prevTrigger, reset: s.prevReset }, { trigger, reset },
      { count: connected.length, random, rng: Math.random },
    );
    s.prevTrigger = trigger;
    s.prevReset = reset;
    const port = selectSeqPort(s.step, connected);
    return { texture: port === null ? undefined : textures[port] };
  },
};
