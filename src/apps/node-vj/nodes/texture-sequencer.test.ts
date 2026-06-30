import { expect, test, describe } from "bun:test";
import {
  TextureSequencerNode, TextureSequencerRuntime,
  sequencerStep, selectSeqPort, SEQ_INPUTS, SEQ_TEX_COUNT,
} from "./TextureSequencerNode";
import type { EvalContext } from "../graph/node-type";

/** 入力 map から EvalContext を作る（texture はマーカ文字列、trigger/reset は boolean）。 */
function ctx(state: TextureSequencerRuntime | undefined, inputs: Record<string, unknown>): EvalContext {
  return {
    timeSec: 0,
    input: (id) => inputs[id],
    param: () => undefined,
    node: { id: "seq", type: "TextureSequencer", params: {} },
    state,
  };
}
const tex = (r: Record<string, unknown>): unknown => (r as { texture: unknown }).texture;

describe("#202 sequencerStep（純関数）", () => {
  test("trigger 立ち上がりで +1・true 維持中は据え置き", () => {
    expect(sequencerStep(0, { trigger: false, reset: false }, { trigger: true, reset: false })).toBe(1);
    expect(sequencerStep(1, { trigger: true, reset: false }, { trigger: true, reset: false })).toBe(1);
    expect(sequencerStep(1, { trigger: true, reset: false }, { trigger: false, reset: false })).toBe(1);
  });
  test("reset 立ち上がりで 0・reset 優先", () => {
    expect(sequencerStep(5, { trigger: false, reset: false }, { trigger: false, reset: true })).toBe(0);
    expect(sequencerStep(5, { trigger: false, reset: false }, { trigger: true, reset: true })).toBe(0);
  });
});

describe("#202 selectSeqPort（純関数）", () => {
  test("接続なしは null", () => {
    expect(selectSeqPort(0, [])).toBeNull();
    expect(selectSeqPort(3, [])).toBeNull();
  });
  test("接続済みポートを step で wrap（接続数が変わっても破綻しない）", () => {
    expect(selectSeqPort(0, [0, 2, 5])).toBe(0);
    expect(selectSeqPort(1, [0, 2, 5])).toBe(2);
    expect(selectSeqPort(2, [0, 2, 5])).toBe(5);
    expect(selectSeqPort(3, [0, 2, 5])).toBe(0); // ループ
    // 接続数が 2 に減っても範囲内
    expect(selectSeqPort(3, [0, 2])).toBe(2);
  });
});

describe("#202 TextureSequencerNode 定義", () => {
  test("texture 入力 N 本＋trigger/reset・texture 出力・process", () => {
    expect(TextureSequencerNode.type).toBe("TextureSequencer");
    expect(TextureSequencerNode.category).toBe("process");
    expect(SEQ_INPUTS.length).toBe(SEQ_TEX_COUNT);
    const inIds = TextureSequencerNode.inputs.map((p) => p.id);
    expect(inIds).toEqual([...SEQ_INPUTS, "trigger", "reset"]);
    expect(TextureSequencerNode.inputs.filter((p) => p.type === "texture").length).toBe(SEQ_TEX_COUNT);
    expect(TextureSequencerNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["texture:texture"]);
  });
});

describe("#202 TextureSequencerNode evaluate", () => {
  test("接続済み texture を trigger ごとに順送り・末尾でループ", () => {
    const s = new TextureSequencerRuntime();
    // tex1="A", tex3="C" を接続（tex2 等は未接続）。
    const base = { tex1: "A", tex3: "C" } as Record<string, unknown>;
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: false })))).toBe("A"); // step0→先頭
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: true })))).toBe("C");  // 立ち上がり→次
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: true })))).toBe("C");  // 維持中は進まない
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: false })))).toBe("C"); // 非発火
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: true })))).toBe("A");  // 再発火→先頭へループ
  });

  test("接続なしは無出力（undefined）", () => {
    const s = new TextureSequencerRuntime();
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { trigger: false })))).toBeUndefined();
  });

  test("reset で先頭へ戻る", () => {
    const s = new TextureSequencerRuntime();
    const base = { tex1: "A", tex2: "B", tex3: "C" } as Record<string, unknown>;
    TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: true }));  // →B
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, trigger: false })))).toBe("B");
    TextureSequencerNode.evaluate(ctx(s, { ...base, reset: true }));    // reset→先頭
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...base, reset: false })))).toBe("A");
  });

  test("接続数が途中で変わっても範囲内（破綻しない）", () => {
    const s = new TextureSequencerRuntime();
    // 3 本接続で 2 回進めて C を選択。
    let inputs = { tex1: "A", tex2: "B", tex3: "C" } as Record<string, unknown>;
    TextureSequencerNode.evaluate(ctx(s, { ...inputs, trigger: true }));  // →B (step1)
    TextureSequencerNode.evaluate(ctx(s, { ...inputs, trigger: false }));
    TextureSequencerNode.evaluate(ctx(s, { ...inputs, trigger: true }));  // →C (step2)
    expect(tex(TextureSequencerNode.evaluate(ctx(s, { ...inputs, trigger: false })))).toBe("C");
    // tex3 を外す（2 本接続）。step2 % 2 = 0 → 先頭 A。範囲内で例外なし。
    inputs = { tex1: "A", tex2: "B" };
    const out = tex(TextureSequencerNode.evaluate(ctx(s, { ...inputs, trigger: false })));
    expect(["A", "B"]).toContain(out as string);
  });
});
