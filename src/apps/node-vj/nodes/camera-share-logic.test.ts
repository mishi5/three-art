import { expect, test, describe } from "bun:test";
import { anyGraphHasCameraInput, shouldAutoStopCamera, CAMERA_INPUT_TYPE } from "./camera-share-logic";
import type { GraphDoc, NodeInstance } from "../graph/graph-doc";

function node(type: string, id = type): NodeInstance {
  return { id, type, params: {} };
}
function graph(...types: string[]): GraphDoc {
  return { version: 1, nodes: types.map((t, i) => node(t, `${t}-${i}`)), connections: [] };
}

describe("anyGraphHasCameraInput (#214)", () => {
  test("CameraInput が 1 シーンにあれば true", () => {
    const graphs = [graph("MicInput"), graph("Screen", CAMERA_INPUT_TYPE)];
    expect(anyGraphHasCameraInput(graphs)).toBe(true);
  });

  test("どのシーンにも CameraInput が無ければ false", () => {
    const graphs = [graph("MicInput", "Screen"), graph("VideoFileInput")];
    expect(anyGraphHasCameraInput(graphs)).toBe(false);
  });

  test("同一シーンに複数の CameraInput があっても true", () => {
    expect(anyGraphHasCameraInput([graph(CAMERA_INPUT_TYPE, CAMERA_INPUT_TYPE)])).toBe(true);
  });

  test("空配列は false", () => {
    expect(anyGraphHasCameraInput([])).toBe(false);
    expect(anyGraphHasCameraInput([graph()])).toBe(false);
  });
});

describe("shouldAutoStopCamera (#214)", () => {
  test("稼働中 かつ 全シーンに CameraInput 無し → 停止すべき(true)", () => {
    expect(shouldAutoStopCamera([graph("MicInput")], true)).toBe(true);
  });

  test("稼働中 でも どこかに CameraInput が残る → 停止しない(false)", () => {
    expect(shouldAutoStopCamera([graph(CAMERA_INPUT_TYPE)], true)).toBe(false);
  });

  test("そもそも稼働していなければ false（CameraInput 有無に依らず）", () => {
    expect(shouldAutoStopCamera([graph("MicInput")], false)).toBe(false);
    expect(shouldAutoStopCamera([graph(CAMERA_INPUT_TYPE)], false)).toBe(false);
  });
});
