// #74: 数値 param への接続で手動値が上書きされること（既存ノード横断）。
import { expect, test, describe } from "bun:test";
import { evaluate } from "../graph/evaluator";
import { createGraph, addNode, addConnection } from "../graph/graph-doc";
import { createDefaultRegistry } from "./registry";

const r = createDefaultRegistry();
const conn = (id: string, fn: string, fp: string, tn: string, tp: string) =>
  ({ id, from: { node: fn, port: fp }, to: { node: tn, port: tp } });

describe("param 入力 override (#74)", () => {
  test("param-only だった Sine.freq へ接続すると手動値を上書き", () => {
    const g = createGraph();
    // freq を手動 0.5 にしておき、Number 2 を freq に接続 → t=... で sin(2π·2·t)
    addNode(g, { id: "n", type: "Number", params: { value: 2 } });
    addNode(g, { id: "s", type: "Sine", params: { freq: 0.5, amplitude: 1, offset: 0 } });
    // 接続前: freq=0.5, t=0.25 → sin(2π·0.5·0.25)=sin(π/4)
    expect((evaluate(g, r, { timeSec: 0.25 }).get("s")!.out as number)).toBeCloseTo(Math.sin(Math.PI / 4), 6);
    // freq へ Number(2) を接続
    expect(addConnection(g, r, conn("e", "n", "out", "s", "freq")).ok).toBe(true);
    // 接続後: freq=2（手動 0.5 を無視）, t=0.25 → sin(2π·2·0.25)=sin(π)=0
    expect((evaluate(g, r, { timeSec: 0.25 }).get("s")!.out as number)).toBeCloseTo(0, 6);
  });

  test("RainVisual の param-only だった ampGain へ接続できる（検証 OK）", () => {
    const g = createGraph();
    addNode(g, { id: "n", type: "Number", params: { value: 2 } });
    addNode(g, { id: "rv", type: "RainVisual", params: {} });
    // ampGain はかつて param のみ。今は接続可。
    expect(addConnection(g, r, conn("e", "n", "out", "rv", "ampGain")).ok).toBe(true);
  });

  test("enum param（mode）へは接続できない", () => {
    const g = createGraph();
    addNode(g, { id: "n", type: "Number", params: { value: 1 } });
    addNode(g, { id: "pc", type: "PointCloudVisual", params: {} });
    const res = addConnection(g, r, conn("e", "n", "out", "pc", "mode"));
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("port not found");
  });

  test("数値 param（PointCloudVisual.radius）へは接続できる", () => {
    const g = createGraph();
    addNode(g, { id: "n", type: "Number", params: { value: 1.2 } });
    addNode(g, { id: "pc", type: "PointCloudVisual", params: {} });
    expect(addConnection(g, r, conn("e", "n", "out", "pc", "radius")).ok).toBe(true);
  });
});
