import { expect, test, describe, mock } from "bun:test";
import { AudioFileInputRuntime } from "./AudioFileInputNode";

describe("AudioFileInput 二重再生防止 (#125)", () => {
  test("loadFile は新ファイル読込前に既存 source を stop する", async () => {
    const rt = new AudioFileInputRuntime();
    const stop = mock(() => {});
    // 再生中の旧 source を模した stub を仕込む。
    (rt as unknown as { source: unknown }).source = { stop };
    // bun 環境には AudioContext が無いため後段は throw するが、stop は冒頭で呼ばれるはず。
    await rt.loadFile(new File([], "second.mp3")).catch(() => { /* AudioContext 不在 */ });
    expect(stop).toHaveBeenCalledTimes(1);
  });
});
