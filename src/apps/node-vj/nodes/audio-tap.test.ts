import { expect, test, describe } from "bun:test";
import { AudioNodeTap } from "./audio-tap";

/** connect/disconnect の呼び出しを記録するフェイク AudioNode。 */
function fakeNode(id: string): AudioNode & { connectedTo: AudioNode[]; disconnectedFrom: AudioNode[] } {
  const connectedTo: AudioNode[] = [];
  const disconnectedFrom: AudioNode[] = [];
  return {
    _id: id,
    connectedTo,
    disconnectedFrom,
    connect: (dest: AudioNode) => { connectedTo.push(dest); },
    disconnect: (dest?: AudioNode) => { if (dest) disconnectedFrom.push(dest); },
  } as unknown as AudioNode & { connectedTo: AudioNode[]; disconnectedFrom: AudioNode[] };
}

describe("AudioNodeTap (#240 タップの差分接続管理)", () => {
  test("初回 update(src) で src→target を接続し current に控える", () => {
    const target = fakeNode("target");
    const src = fakeNode("src");
    const tap = new AudioNodeTap(target);
    expect(tap.current).toBeNull();

    tap.update(src);

    expect(src.connectedTo).toEqual([target]);
    expect(tap.current).toBe(src);
  });

  test("同じ src での update は再接続しない（毎フレーム呼んでも接続は 1 回）", () => {
    const target = fakeNode("target");
    const src = fakeNode("src");
    const tap = new AudioNodeTap(target);

    tap.update(src);
    tap.update(src);
    tap.update(src);

    expect(src.connectedTo).toEqual([target]);
  });

  test("src 差し替えで旧を物理 disconnect してから新を接続する", () => {
    const target = fakeNode("target");
    const a = fakeNode("a");
    const b = fakeNode("b");
    const tap = new AudioNodeTap(target);

    tap.update(a);
    tap.update(b);

    expect(a.disconnectedFrom).toEqual([target]);
    expect(b.connectedTo).toEqual([target]);
    expect(tap.current).toBe(b);
  });

  test("update(null) で切断して current を null にする（参照先消滅）", () => {
    const target = fakeNode("target");
    const src = fakeNode("src");
    const tap = new AudioNodeTap(target);

    tap.update(src);
    tap.update(null);

    expect(src.disconnectedFrom).toEqual([target]);
    expect(tap.current).toBeNull();
  });

  test("dispose は接続中の src を物理 disconnect する（#198 不変条件）", () => {
    const target = fakeNode("target");
    const src = fakeNode("src");
    const tap = new AudioNodeTap(target);

    tap.update(src);
    tap.dispose();

    expect(src.disconnectedFrom).toEqual([target]);
    expect(tap.current).toBeNull();
  });

  test("disconnect が例外を投げても新 src の接続を続行する（merge 破棄済みなど）", () => {
    const target = fakeNode("target");
    const bad = {
      connect: () => {},
      disconnect: () => { throw new Error("already disconnected"); },
    } as unknown as AudioNode;
    const next = fakeNode("next");
    const tap = new AudioNodeTap(target);

    tap.update(bad);
    expect(() => tap.update(next)).not.toThrow();
    expect(next.connectedTo).toEqual([target]);
    expect(tap.current).toBe(next);
  });
});
