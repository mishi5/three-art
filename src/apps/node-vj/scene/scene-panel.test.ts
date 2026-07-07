import { expect, test, describe } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import { panelDisplay, createRenderHold, scenePanelDef } from "./scene-panel";
import type { ScenePanelActions } from "./scene-panel";
import type { Scene } from "./scene-store";
import type { GraphDoc } from "../graph/graph-doc";

describe("panelDisplay", () => {
  test("open=true は flex・false は none", () => {
    expect(panelDisplay(true)).toBe("flex");
    expect(panelDisplay(false)).toBe("none");
  });
});

// #255: 編集中は再描画を保留する状態機械。
describe("createRenderHold", () => {
  test("非編集中の request は即 render する", () => {
    let calls = 0;
    const hold = createRenderHold(() => { calls++; });
    hold.request();
    expect(calls).toBe(1);
    expect(hold.editing()).toBe(false);
  });

  test("編集中の request は保留され render されない", () => {
    let calls = 0;
    const hold = createRenderHold(() => { calls++; });
    hold.beginEdit();
    expect(hold.editing()).toBe(true);
    hold.request();
    hold.request();
    expect(calls).toBe(0);
  });

  test("endEdit で保留分を 1 回だけ flush する", () => {
    let calls = 0;
    const hold = createRenderHold(() => { calls++; });
    hold.beginEdit();
    hold.request();
    hold.request();
    hold.endEdit();
    expect(calls).toBe(1);
    expect(hold.editing()).toBe(false);
  });

  test("保留が無ければ endEdit は render しない", () => {
    let calls = 0;
    const hold = createRenderHold(() => { calls++; });
    hold.beginEdit();
    hold.endEdit();
    expect(calls).toBe(0);
  });

  test("flush 後の request は再び即時実行に戻る", () => {
    let calls = 0;
    const hold = createRenderHold(() => { calls++; });
    hold.beginEdit();
    hold.request();
    hold.endEdit();
    hold.request();
    expect(calls).toBe(2);
  });
});

// #255: シーンパネル DOM。編集中の onChange（自動保存の commit 相当）で input を壊さない。
describe("scenePanelDef (DOM)", () => {
  registerHappyDom();

  function emptyGraph(): GraphDoc {
    return { version: 1, nodes: [], connections: [] };
  }

  function makeActions(names: string[]): {
    actions: ScenePanelActions;
    scenes: Scene[];
    fire: () => void;
    renamed: Array<{ id: string; name: string }>;
  } {
    const scenes: Scene[] = names.map((n, i) => ({ id: `s${i}`, name: n, graph: emptyGraph() }));
    const listeners: Array<() => void> = [];
    const fire = (): void => { for (const cb of listeners) cb(); };
    const renamed: Array<{ id: string; name: string }> = [];
    const actions: ScenePanelActions = {
      list: () => scenes,
      activeId: () => scenes[0]!.id,
      switchTo: () => {},
      add: () => scenes[0]!,
      duplicate: () => {},
      remove: () => {},
      rename: (id, name) => {
        renamed.push({ id, name });
        const s = scenes.find((x) => x.id === id);
        if (s) s.name = name;
        fire();
      },
      onChange: (cb) => { listeners.push(cb); return () => {}; },
      outputId: () => null,
      setOutput: () => {},
    };
    return { actions, scenes, fire, renamed };
  }

  function mountPanel(actions: ScenePanelActions): HTMLElement {
    const host = document.createElement("div");
    document.body.appendChild(host);
    scenePanelDef(actions).mount(host);
    return host;
  }

  /** 行 index の名前要素をダブルクリックして編集 input を返す。 */
  function startEdit(host: HTMLElement, index: number): HTMLInputElement {
    const listEl = host.children[0]!;
    const row = listEl.children[index]!;
    const name = row.children[0]!;
    name.dispatchEvent(new Event("dblclick", { bubbles: true }));
    return host.querySelector("input") as HTMLInputElement;
  }

  test("ダブルクリックで編集 input が表示される", () => {
    const { actions } = makeActions(["Scene 1", "Scene 2"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    expect(input).not.toBeNull();
    expect(input.value).toBe("Scene 1");
  });

  test("編集中に onChange（自動保存）が来ても input が生き残り値も保持される", () => {
    const { actions, fire } = makeActions(["Scene 1", "Scene 2"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "Typing...";
    fire(); // 5 秒周期の snapshotActiveScene → commit → onChange 相当
    fire();
    expect(host.querySelector("input")).toBe(input);
    expect(input.value).toBe("Typing...");
  });

  test("Enter 確定で rename が呼ばれ、通常表示に戻る", () => {
    const { actions, renamed } = makeActions(["Scene 1", "Scene 2"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "New Name";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(renamed).toEqual([{ id: "s0", name: "New Name" }]);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("New Name");
  });

  test("Enter 確定後の blur で二重 rename しない", () => {
    const { actions, renamed } = makeActions(["Scene 1"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "Once";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    input.dispatchEvent(new Event("blur"));
    expect(renamed).toEqual([{ id: "s0", name: "Once" }]);
  });

  test("blur 確定でも rename が呼ばれる", () => {
    const { actions, renamed } = makeActions(["Scene 1", "Scene 2"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "Blurred";
    input.dispatchEvent(new Event("blur"));
    expect(renamed).toEqual([{ id: "s0", name: "Blurred" }]);
    expect(host.querySelector("input")).toBeNull();
  });

  test("Escape キャンセルで rename されず表示復元・保留 render が flush される", () => {
    const { actions, scenes, fire, renamed } = makeActions(["Scene 1", "Scene 2"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "Discarded";
    // 編集中に別の変更（他シーンの名称変更）が起きても保留される
    scenes[1]!.name = "Changed Elsewhere";
    fire();
    expect(host.querySelector("input")).toBe(input);
    expect(host.textContent).not.toContain("Changed Elsewhere");
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(renamed).toEqual([]);
    expect(host.querySelector("input")).toBeNull();
    // 保留していた render が走り、編集中に来た変更が反映される
    expect(host.textContent).toContain("Scene 1");
    expect(host.textContent).toContain("Changed Elsewhere");
  });

  test("空文字で確定した場合は rename せず表示復元する", () => {
    const { actions, renamed } = makeActions(["Scene 1"]);
    const host = mountPanel(actions);
    const input = startEdit(host, 0);
    input.value = "   ";
    input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
    expect(renamed).toEqual([]);
    expect(host.querySelector("input")).toBeNull();
    expect(host.textContent).toContain("Scene 1");
  });
});
