import { expect, test, describe } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";
import {
  buildNodeAddSections, nodeAddViewRect, viewCenter, findFreeSpot, nodeAddPanelDef,
  createNodeAddPanel, wireDropPosition, filterBadgeText, matchesQuery,
  panelDropPosition, NODE_TYPE_MIME,
} from "./node-add-panel";
import { BAR_W, TOP, PANEL_W } from "./side-dock";
import { TITLE_H } from "./layout";

// #243: サイドドック「ノード追加」パネルの一覧データ生成・配置座標の純関数と DOM mount。
// #258: 互換フィルタ（エッジドロップ → 接続可能ノードのみ表示）と右ドック化に伴う可視領域。

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

  // #258: 互換フィルタ。allowedTypes 指定時は該当型のみ・空になったセクションは落とす。
  test("allowedTypes で項目を絞り、空セクションは含めない", () => {
    const sections = buildNodeAddSections(defs, new Set(["Sine", "Screen"]));
    expect(sections.map((s) => s.category)).toEqual(["control", "output"]);
    expect(sections.flatMap((s) => s.items.map((i) => i.type))).toEqual(["Sine", "Screen"]);
  });

  test("allowedTypes が空集合なら空配列", () => {
    expect(buildNodeAddSections(defs, new Set())).toEqual([]);
  });

  test("allowedTypes 未指定（undefined/null）は従来どおり全件", () => {
    expect(buildNodeAddSections(defs, null).flatMap((s) => s.items).length).toBe(4);
  });
});

describe("nodeAddViewRect / viewCenter", () => {
  // #258: パネルは右ドックへ移動。可視領域は「左バー右端〜右ドック（バー+パネル）左端」。
  test("左バー右端〜右ドック左端・ツールバー下〜画面下端", () => {
    const view = nodeAddViewRect(1200, 800);
    expect(view).toEqual({ left: BAR_W, top: TOP, right: 1200 - BAR_W - PANEL_W, bottom: 800 });
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

// #258: エッジドロップ位置 → ノード配置座標。
describe("wireDropPosition", () => {
  test("入力ポート側（左上）が drop 付近に来るよう TITLE_H ぶん上げる", () => {
    expect(wireDropPosition({ x: 300, y: 200 }, [])).toEqual({ x: 300, y: 200 - TITLE_H });
  });

  test("既存ノードと重なる場合は findFreeSpot で回避する", () => {
    const p = wireDropPosition({ x: 300, y: 200 }, [{ x: 300, y: 200 - TITLE_H }]);
    expect(Math.hypot(p.x - 300, p.y - (200 - TITLE_H))).toBeGreaterThan(0);
  });
});

// #257: パネルチップの D&D ドロップ位置 → ノード配置座標（findFreeSpot は使わない）。
describe("panelDropPosition", () => {
  test("入力ポート側（左上）が drop 付近に来るよう TITLE_H ぶん上げる", () => {
    expect(panelDropPosition({ x: 300, y: 200 })).toEqual({ x: 300, y: 200 - TITLE_H });
  });

  test("既存ノードと重なっていても座標をずらさない（ユーザが狙って落とすため）", () => {
    // wireDropPosition と異なり occupied を受け取らない＝常に同じ結果。
    expect(panelDropPosition({ x: 0, y: 0 })).toEqual({ x: 0, y: -TITLE_H });
  });
});

// #258: フィルタバッジの表示文言（ja 既定）。
describe("filterBadgeText", () => {
  test("ポート型名を含む", () => {
    expect(filterBadgeText("texture")).toContain("texture");
    expect(filterBadgeText("number")).toContain("number");
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

  test("#256: チップ本体はノード名のみ・説明は title ツールチップ（名前 — 説明）に寄せる", () => {
    const host = mountPanel(() => {});
    const camera = host.querySelector("[data-node-type=Camera]") as HTMLElement;
    expect(camera.textContent).toBe("Camera"); // チップは名前のみ（スクロール圧縮）
    expect(camera.title).toBe("Camera — カメラ映像入力。"); // 全文はツールチップ
  });

  test("#256: 説明なしノードの title はノード名のみ", () => {
    const host = mountPanel(() => {});
    const sine = host.querySelector("[data-node-type=Sine]") as HTMLElement;
    expect(sine.title).toBe("Sine");
  });

  test("#256: カテゴリはグループボックス（カテゴリ色の左ボーダー）で囲まれる", () => {
    const host = mountPanel(() => {});
    const groups = [...host.querySelectorAll("[data-role=group]")].map((el) => (el as HTMLElement).dataset.category);
    expect(groups).toEqual(["source", "control", "output"]);
  });

  test("項目クリックで onAdd(type) が呼ばれる", () => {
    const added: string[] = [];
    const host = mountPanel((t) => added.push(t));
    (host.querySelector("[data-node-type=Screen]") as HTMLElement).click();
    expect(added).toEqual(["Screen"]);
  });

  // #257: チップからキャンバスへの D&D 追加。draggable + dragstart で dataTransfer にノード型を積む。
  test("#257: チップは draggable=true", () => {
    const host = mountPanel(() => {});
    const camera = host.querySelector("[data-node-type=Camera]") as HTMLElement;
    expect(camera.draggable).toBe(true);
  });

  test("#257: dragstart で dataTransfer に NODE_TYPE_MIME でノード型を積み、effectAllowed=copy にする", () => {
    const host = mountPanel(() => {});
    const camera = host.querySelector("[data-node-type=Camera]") as HTMLElement;
    // happy-dom は DragEvent コンストラクタ経由では dataTransfer を渡せないため、
    // 生成後に実 DataTransfer を代入して dispatch する（実ブラウザと同じ setData/getData 経路）。
    const dt = new DataTransfer();
    const ev = new DragEvent("dragstart", { bubbles: true, cancelable: true });
    Object.defineProperty(ev, "dataTransfer", { value: dt, configurable: true });
    camera.dispatchEvent(ev);
    expect(dt.getData(NODE_TYPE_MIME)).toBe("Camera");
    expect(dt.effectAllowed).toBe("copy");
  });

  test("#257: クリック追加はドラッグ配線を追加しても従来どおり動く（共存確認）", () => {
    const added: string[] = [];
    const host = mountPanel((t) => added.push(t));
    (host.querySelector("[data-node-type=Camera]") as HTMLElement).click();
    expect(added).toEqual(["Camera"]);
  });

  // #256: 検索ボックスによる絞り込み
  test("#256: 検索でノード名の部分一致に絞る（空カテゴリは消える）", () => {
    const host = mountPanel(() => {});
    const search = host.querySelector("[data-role=search]") as HTMLInputElement;
    search.value = "cam";
    search.dispatchEvent(new Event("input"));
    const items = [...host.querySelectorAll("[data-node-type]")].map((el) => el.getAttribute("data-node-type"));
    expect(items).toEqual(["Camera"]);
    const groups = [...host.querySelectorAll("[data-role=group]")].map((el) => (el as HTMLElement).dataset.category);
    expect(groups).toEqual(["source"]); // control/output は該当なしで非表示
  });

  test("#256: 検索は説明にもマッチし大小を無視する", () => {
    const host = mountPanel(() => {});
    const search = host.querySelector("[data-role=search]") as HTMLInputElement;
    search.value = "最終"; // Screen の説明「最終出力。」
    search.dispatchEvent(new Event("input"));
    const items = [...host.querySelectorAll("[data-node-type]")].map((el) => el.getAttribute("data-node-type"));
    expect(items).toEqual(["Screen"]);
  });

  test("#256: 該当なしのときは search-empty を表示", () => {
    const host = mountPanel(() => {});
    const search = host.querySelector("[data-role=search]") as HTMLInputElement;
    search.value = "zzzzz";
    search.dispatchEvent(new Event("input"));
    expect(host.querySelectorAll("[data-node-type]").length).toBe(0);
    expect(host.querySelector("[data-role=search-empty]")).not.toBeNull();
  });
});

describe("matchesQuery (#256)", () => {
  const item = { type: "AudioFilter", description: "音声フィルタ。" };
  test("空クエリは全件通す", () => {
    expect(matchesQuery(item, "")).toBe(true);
    expect(matchesQuery(item, "   ")).toBe(true);
  });
  test("ノード名の部分一致（大小無視）", () => {
    expect(matchesQuery(item, "filter")).toBe(true);
    expect(matchesQuery(item, "AUDIO")).toBe(true);
  });
  test("説明の部分一致", () => {
    expect(matchesQuery(item, "フィルタ")).toBe(true);
  });
  test("非マッチは false", () => {
    expect(matchesQuery(item, "video")).toBe(false);
  });
});

// #258: 互換フィルタ付きパネル（エッジドロップからの自動オープン）。
describe("createNodeAddPanel filter (DOM)", () => {
  registerHappyDom();

  const defs = [
    { type: "Camera", category: "source", description: "カメラ映像入力。" },
    { type: "Sine", category: "control" },
    { type: "Screen", category: "output", description: "最終出力。" },
  ];

  interface Ctx {
    host: HTMLElement;
    pane: HTMLElement;
    panel: ReturnType<typeof createNodeAddPanel>;
    added: string[];
    picked: string[];
  }

  /** dock-pane 相当のラッパごと body に mount する（外側クリック判定のため）。 */
  function mount(): Ctx {
    const added: string[] = [];
    const picked: string[] = [];
    const panel = createNodeAddPanel({ defs: () => defs, onAdd: (t) => added.push(t) });
    const pane = document.createElement("div");
    pane.dataset.role = "dock-pane";
    const host = document.createElement("div");
    pane.appendChild(host);
    document.body.appendChild(pane);
    panel.def.mount(host);
    return { host, pane, panel, added, picked };
  }

  function cleanup(ctx: Ctx): void {
    ctx.panel.clearFilter();
    ctx.pane.remove();
  }

  function types(host: HTMLElement): (string | null)[] {
    return [...host.querySelectorAll("[data-node-type]")].map((el) => el.getAttribute("data-node-type"));
  }

  test("setFilter で互換型のみ表示・バッジと解除ボタンが出る", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "texture", types: new Set(["Screen"]), onPick: (t) => ctx.picked.push(t) });
    expect(types(ctx.host)).toEqual(["Screen"]);
    const badge = ctx.host.querySelector("[data-role=filter-badge]") as HTMLElement;
    expect(badge.textContent).toContain("texture");
    expect(ctx.host.querySelector("[data-role=filter-clear]")).not.toBeNull();
    cleanup(ctx);
  });

  test("フィルタ中の項目クリックは onPick（onAdd ではない）・フィルタは解除される", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "texture", types: new Set(["Screen"]), onPick: (t) => ctx.picked.push(t) });
    (ctx.host.querySelector("[data-node-type=Screen]") as HTMLElement).click();
    expect(ctx.picked).toEqual(["Screen"]);
    expect(ctx.added).toEqual([]);
    expect(ctx.panel.getFilter()).toBeNull();
    expect(types(ctx.host)).toEqual(["Camera", "Sine", "Screen"]); // 全件表示に戻る
    cleanup(ctx);
  });

  test("解除ボタンで何も追加せず全件表示に戻る", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "number", types: new Set(["Sine"]), onPick: (t) => ctx.picked.push(t) });
    (ctx.host.querySelector("[data-role=filter-clear]") as HTMLElement).click();
    expect(ctx.picked).toEqual([]);
    expect(ctx.panel.getFilter()).toBeNull();
    expect(types(ctx.host)).toEqual(["Camera", "Sine", "Screen"]);
    cleanup(ctx);
  });

  test("Esc でフィルタ解除（何も追加しない）", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "number", types: new Set(["Sine"]), onPick: (t) => ctx.picked.push(t) });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(ctx.panel.getFilter()).toBeNull();
    expect(ctx.picked).toEqual([]);
    cleanup(ctx);
  });

  test("ペイン外 pointerdown でフィルタ解除・ペイン内では解除しない", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "number", types: new Set(["Sine"]), onPick: () => {} });
    // ペイン内（項目の上）では解除されない。
    ctx.host.querySelector("[data-node-type=Sine]")!
      .dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(ctx.panel.getFilter()).not.toBeNull();
    // ペイン外（body 直下）で解除。
    document.body.dispatchEvent(new Event("pointerdown", { bubbles: true }));
    expect(ctx.panel.getFilter()).toBeNull();
    cleanup(ctx);
  });

  test("パネル非表示（onHide）でフィルタ解除", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "number", types: new Set(["Sine"]), onPick: () => {} });
    ctx.panel.def.onHide?.();
    expect(ctx.panel.getFilter()).toBeNull();
    expect(types(ctx.host)).toEqual(["Camera", "Sine", "Screen"]);
    cleanup(ctx);
  });

  test("互換ノードが無い場合は空表示メッセージを出す", () => {
    const ctx = mount();
    ctx.panel.setFilter({ portType: "trigger", types: new Set(), onPick: () => {} });
    expect(types(ctx.host)).toEqual([]);
    expect(ctx.host.querySelector("[data-role=filter-empty]")).not.toBeNull();
    cleanup(ctx);
  });
});
