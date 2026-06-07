import { expect, test, describe } from "bun:test";
import { NodeRegistry, type NodeTypeDef } from "./node-type";

function stub(type: string): NodeTypeDef {
  return { type, inputs: [], outputs: [], params: [], evaluate: () => ({}) };
}

describe("NodeRegistry", () => {
  test("register / get / require / list", () => {
    const r = new NodeRegistry();
    const a = stub("A");
    r.register(a);
    expect(r.get("A")).toBe(a);
    expect(r.require("A")).toBe(a);
    expect(r.list()).toEqual([a]);
  });

  test("未登録 get は undefined、require は throw", () => {
    const r = new NodeRegistry();
    expect(r.get("X")).toBeUndefined();
    expect(() => r.require("X")).toThrow();
  });

  test("重複登録は throw", () => {
    const r = new NodeRegistry();
    r.register(stub("A"));
    expect(() => r.register(stub("A"))).toThrow();
  });
});
