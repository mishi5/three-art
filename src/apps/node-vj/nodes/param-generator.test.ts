import { expect, test, describe } from "bun:test";
import { pulseStep, rerollDue, randomRange } from "./param-gen-logic";
import { PulseNode } from "./PulseNode";
import { RandomValueNode } from "./RandomValueNode";
import { createDefaultRegistry } from "./registry";

describe("pulseStep (#155)", () => {
  test("経過が interval 未満は発火しない（lastFire 据え置き）", () => {
    const r = pulseStep(0.3, 0.0, 0.5);
    expect(r.fired).toBe(false);
    expect(r.lastFire).toBe(0.0);
  });
  test("経過が interval 以上で発火し lastFire を now に更新", () => {
    const r = pulseStep(0.6, 0.0, 0.5);
    expect(r.fired).toBe(true);
    expect(r.lastFire).toBe(0.6);
  });
});

describe("rerollDue (#155)", () => {
  test("interval=0 は自動再ロールしない", () => {
    expect(rerollDue(100, 0, 0)).toBe(false);
  });
  test("interval>0 で経過到達なら true", () => {
    expect(rerollDue(1.0, 0.0, 0.5)).toBe(true);
    expect(rerollDue(0.4, 0.0, 0.5)).toBe(false);
  });
});

describe("randomRange (#155)", () => {
  test("rand 線形補間・min>max 入替", () => {
    expect(randomRange(0, 1, 0)).toBe(0);
    expect(randomRange(0, 1, 1)).toBe(1);
    expect(randomRange(2, 5, 0.5)).toBeCloseTo(3.5);
    expect(randomRange(5, 2, 0)).toBe(2);
  });
});

describe("PulseNode (#155)", () => {
  test("generator・sync trigger 入力（#270）・trigger 出力", () => {
    expect(PulseNode.type).toBe("Pulse");
    expect(PulseNode.category).toBe("control");
    expect(PulseNode.inputs.map((p) => p.id)).toEqual(["sync"]);
    expect(PulseNode.inputs[0]?.type).toBe("trigger");
    expect(PulseNode.outputs.map((p) => p.id)).toEqual(["trigger"]);
    expect(PulseNode.outputs[0]?.type).toBe("trigger");
    expect(PulseNode.params.find((p) => p.id === "interval")?.kind).toBe("number");
  });
  test("interval ごとに trigger を発火（state あり）", () => {
    const s = PulseNode.createState!({} as never);
    const mk = (t: number) => PulseNode.evaluate({ timeSec: t, input: () => undefined, param: () => 0.5, node: { id: "p", type: "Pulse", params: {} }, state: s } as never);
    expect(mk(0).trigger).toBe(false);    // prime（lastFire=0）
    expect(mk(0.3).trigger).toBe(false);
    expect(mk(0.6).trigger).toBe(true);   // 0.5 経過で発火
    expect(mk(0.7).trigger).toBe(false);
  });
});

describe("PulseNode: sync（#270）", () => {
  const mk = (s: unknown) => (t: number, sync?: boolean) => PulseNode.evaluate({
    timeSec: t, input: (id: string) => (id === "sync" ? sync : undefined), param: () => 0.5,
    node: { id: "p", type: "Pulse", params: {} }, state: s,
  } as never);

  test("sync の立ち上がりでそのフレームに発火し、lastFire がリセットされる", () => {
    const ev = mk(PulseNode.createState!({} as never));
    expect(ev(0).trigger).toBe(false);        // prime
    expect(ev(0.3, true).trigger).toBe(true); // sync エッジ → 即発火＋lastFire=0.3
    expect(ev(0.6).trigger).toBe(false);      // 0.3 経過（<0.5）: リセットが効いている
    expect(ev(0.85).trigger).toBe(true);      // 0.55 経過で通常発火
  });

  test("sync 押しっぱなし（エッジなし）では連続発火しない", () => {
    const ev = mk(PulseNode.createState!({} as never));
    ev(0);
    expect(ev(0.3, true).trigger).toBe(true);
    expect(ev(0.35, true).trigger).toBe(false); // エッジではないので通常判定（0.05<0.5）
  });

  test("sync 未接続時は従来どおり", () => {
    const ev = mk(PulseNode.createState!({} as never));
    expect(ev(0).trigger).toBe(false);
    expect(ev(0.6).trigger).toBe(true);
  });
});

describe("RandomValueNode (#155)", () => {
  test("generator・trigger 入力・number 出力", () => {
    expect(RandomValueNode.type).toBe("RandomValue");
    expect(RandomValueNode.category).toBe("control");
    expect(RandomValueNode.inputs.find((p) => p.id === "trigger")?.type).toBe("trigger");
    expect(RandomValueNode.outputs.map((p) => p.id)).toEqual(["out"]);
    const ids = RandomValueNode.params.map((p) => p.id);
    expect(ids).toEqual(["min", "max", "interval"]);
  });
  test("trigger 立ち上がりで値が再ロールされ、min/max 範囲に収まる", () => {
    const s = RandomValueNode.createState!({} as never);
    const ev = (t: number, trig: boolean) => RandomValueNode.evaluate({
      timeSec: t, input: (id: string) => (id === "trigger" ? trig : undefined),
      param: (id: string) => ({ min: 0, max: 1, interval: 0 }[id]),
      node: { id: "r", type: "RandomValue", params: {} }, state: s,
    } as never);
    const v0 = ev(0, false).out as number;       // 初期ロール
    expect(v0).toBeGreaterThanOrEqual(0);
    expect(v0).toBeLessThanOrEqual(1);
    const v1 = ev(0.1, false).out as number;     // trigger なし→据え置き
    expect(v1).toBe(v0);
    ev(0.2, true);                                // 立ち上がり→再ロール
    const v2 = ev(0.3, true).out as number;       // 据え置き（エッジ済み）
    expect(v2).toBeGreaterThanOrEqual(0);
    expect(v2).toBeLessThanOrEqual(1);
  });
});

describe("registry (#155)", () => {
  test("Pulse / RandomValue が登録されている", () => {
    const r = createDefaultRegistry();
    expect(r.get("Pulse")).toBeDefined();
    expect(r.get("RandomValue")).toBeDefined();
  });
});
