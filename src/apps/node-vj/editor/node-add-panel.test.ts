import { expect, test, describe } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import {
  buildNodeAddSections, nodeAddViewRect, viewCenter, findFreeSpot, nodeAddPanelDef,
} from "./node-add-panel";
import { BAR_W, TOP, PANEL_W } from "./side-dock";

// #243: サイドドック「ノード追加」パネルの一覧データ生成・配置座標の純関数と DOM mount。

describe("buildNodeAddSections", () => {
  const defs = [
    { type: "Screen", category: "output", description: "最終出力。" },
    { type: "Camera", category: "source", description: "カメラ映像入力。" },
    { type: "Sine", category: "control" }, // description なし
    { type: "Envelope", category: "control", description: "音量エンベロープ。" },
  ];

  test("groupNodesByCategory と同じカテゴリ順（source→control→…→output）に並ぶ", () => {
    const sections = buildNodeAddSections(defs);
    expect(sections.map((s) => s.category)).toEqual(["source", "control", "output"]);
  });

  test("各項目に type と description を引き回す（レジストリ順を維持）", () => {
    const sections = buildNodeAddSections(defs);
    const ctl = sections.find((s) => s.category === "control")!;
    expect(ctl.items.map((i) => i.type)).toEqual(["Sine", "Envelope"]);
    expect(ctl.items[1]!.description).toBe("音量エンベロープ。");
  });

  test("description が無い型は空文字にする", () => {
    const sections = buildNodeAddSections(defs);
    const ctl = sections.find((s) => s.category === "control")!;
    expect(ctl.items[0]!.description).toBe("");
  });

  test("空定義なら空配列", () => {
    expect(buildNodeAddSections([])).toEqual([]);
  });
});

describe("nodeAddViewRect / viewCenter", () => {
  test("ドック（バー+パネル）の右端〜画面右端・ツールバー下〜画面下端", () => {
    const view = nodeAddViewRect(1200, 800);
    expect(view).toEqual({ left: BAR_W + PANEL_W, top: TOP, right: 1200, bottom: 800 });
  });

  test("viewCenter は矩形の中心", () => {
    expect(viewCenter({ left: 100, top: 40, right: 300, bottom: 240 })).toEqual({ x: 200, y: 140 });
  });
});

describe("findFreeSpot", () => {
  test("近くに既存ノードが無ければ desired のまま", () => {
    expect(findFreeSpot({ x: 100, y: 100 }, [])).toEqual({ x: 100, y: 100 });
    expect(findFreeSpot({ x: 100, y: 100 }, [{ x: 500, y: 500 }])).toEqual({ x: 100, y: 100 });
  });

  test("desired に近接する既存ノードがあれば右下へずらす", () => {
    const p = findFreeSpot({ x: 100, y: 100 }, [{ x: 100, y: 100 }]);
    expect(p.x).toBeGreaterThan(100);
    expect(p.y).toBeGreaterThan(100);
  });

  test("ずらした先も塞がっていればさらに回避する（連続追加で重ならない）", () => {
    const occupied = [{ x: 100, y: 100 }, { x: 128, y: 128 }];
    const p = findFreeSpot({ x: 100, y: 100 }, occupied);
    for (const o of occupied) {
      expect(Math.hypot(o.x - p.x, o.y - p.y)).toBeGreaterThanOrEqual(40);
    }
  });

  test("全て塞がっていても有限回で打ち切って返す（無限ループしない）", () => {
    const occupied = Array.from({ length: 100 }, (_, i) => ({ x: 100 + i * 28, y: 100 + i * 28 }));
    const p = findFreeSpot({ x: 100, y: 100 }, occupied);
    expect(Number.isFinite(p.x)).toBe(true);
    expect(Number.isFinite(p.y)).toBe(true);
  });
});

describe("nodeAddPanelDef (DOM)", () => {
  registerHappyDom();

  const defs = [
    { type: "Camera", category: "source", description: "カメラ映像入力。" },
    { type: "Sine", category: "control" },
    { type: "Screen", category: "output", description: "最終出力。" },
  ];

  function mountPanel(onAdd: (type: string) => void): HTMLElement {
    const host = document.createElement("div");
    const def = nodeAddPanelDef({ defs: () => defs, onAdd });
    def.mount(host);
    return host;
  }

  test("パネル定義（id / title / ＋アイコン）", () => {
    const def = nodeAddPanelDef({ defs: () => defs, onAdd: () => {} });
    expect(def.id).toBe("node-add");
    expect(def.title).toBe("ノード追加");
    expect(def.icon).toContain("<svg");
  });

  test("カテゴリごとのセクション見出しと項目が registry から生成される", () => {
    const host = mountPanel(() => {});
    const headings = [...host.querySelectorAll("[data-role=section]")].map((el) => el.textContent);
    expect(headings).toEqual(["source", "control", "output"]);
    const items = [...host.querySelectorAll("[data-node-type]")].map((el) => el.getAttribute("data-node-type"));
    expect(items).toEqual(["Camera", "Sine", "Screen"]);
  });

  test("項目に説明（小さな説明文 + title ツールチップ）が付く", () => {
    const host = mountPanel(() => {});
    const camera = host.querySelector("[data-node-type=Camera]") as HTMLElement;
    expect(camera.title).toBe("カメラ映像入力。");
    expect(camera.textContent).toContain("カメラ映像入力。");
  });

  test("項目クリックで onAdd(type) が呼ばれる", () => {
    const added: string[] = [];
    const host = mountPanel((t) => added.push(t));
    (host.querySelector("[data-node-type=Screen]") as HTMLElement).click();
    expect(added).toEqual(["Screen"]);
  });
});
