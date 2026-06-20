import { expect, test, describe } from "bun:test";
import { AudioDelayNode } from "./AudioDelayNode";
import { createDefaultRegistry } from "./registry";
import type { EvalContext } from "../graph/node-type";

const noCtx = (): EvalContext => ({
  timeSec: 0, input: () => undefined, param: () => undefined,
  node: { id: "x", type: "AudioDelay", params: {} },
});

describe("AudioDelayNode (#135)", () => {
  test("process・audio in → audio out", () => {
    expect(AudioDelayNode.type).toBe("AudioDelay");
    expect(AudioDelayNode.category).toBe("process");
    expect(AudioDelayNode.inputs.map((p) => `${p.id}:${p.type}`)).toEqual(["audio:audio"]);
    expect(AudioDelayNode.outputs.map((p) => `${p.id}:${p.type}`)).toEqual(["audio:audio"]);
  });

  test("params: delayMs（ms・既定 0）", () => {
    expect(AudioDelayNode.params.map((p) => p.id)).toEqual(["delayMs"]);
    const d = AudioDelayNode.params.find((p) => p.id === "delayMs");
    expect(d?.default).toBe(0);
    expect(d?.max).toBe(2000);
  });

  test("state 無しは audio=undefined（headless）", () => {
    expect(AudioDelayNode.evaluate(noCtx())).toEqual({ audio: undefined });
  });

  test("レジストリに登録されている", () => {
    expect(createDefaultRegistry().get("AudioDelay")).toBeDefined();
  });
});
