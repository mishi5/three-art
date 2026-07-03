// #230: コントロールパネル（サイドドック）の枠組みテスト。
// セクション見出しの縦並びと、各セクション mount の呼び出しを検証する。
// 各コントロールの中身（ボタン配線）は既存コードの移設のため手動確認。
import { expect, test, describe } from "bun:test";
import { registerHappyDom } from "../../../test-setup/dom";

registerHappyDom();

const { controlsPanelDef } = await import("./controls-panel");

describe("controlsPanelDef", () => {
  test("パネル定義のメタ情報（id/タイトル/SVG アイコン）", () => {
    const def = controlsPanelDef([]);
    expect(def.id).toBe("controls");
    expect(def.title).toBe("コントロール");
    expect(def.icon).toContain("<svg");
  });

  test("セクション見出しが指定順に縦へ並ぶ", () => {
    const def = controlsPanelDef([
      { title: "入力", mount: () => {} },
      { title: "出力・録画", mount: () => {} },
      { title: "シーン", mount: () => {} },
      { title: "プロジェクト", mount: () => {} },
    ]);
    const host = document.createElement("div");
    def.mount(host);
    const texts = [...host.querySelectorAll("div")].map((el) => el.textContent);
    const idx = (t: string): number => texts.indexOf(t);
    expect(idx("入力")).toBeGreaterThanOrEqual(0);
    expect(idx("入力")).toBeLessThan(idx("出力・録画"));
    expect(idx("出力・録画")).toBeLessThan(idx("シーン"));
    expect(idx("シーン")).toBeLessThan(idx("プロジェクト"));
  });

  test("各セクションの mount がパネル内の host で 1 回ずつ呼ばれる", () => {
    const calls: HTMLElement[] = [];
    const def = controlsPanelDef([
      { title: "A", mount: (h) => calls.push(h) },
      { title: "B", mount: (h) => calls.push(h) },
    ]);
    const host = document.createElement("div");
    def.mount(host);
    expect(calls.length).toBe(2);
    for (const h of calls) expect(host.contains(h)).toBe(true);
    // セクションごとに別の host（内容が混ざらない）
    expect(calls[0]).not.toBe(calls[1]);
  });

  test("セクション内容は自分の host に追加され見出しの後に表示される", () => {
    const def = controlsPanelDef([
      {
        title: "入力",
        mount: (h) => {
          const btn = document.createElement("button");
          btn.textContent = "▶ 入力開始";
          h.appendChild(btn);
        },
      },
    ]);
    const host = document.createElement("div");
    def.mount(host);
    const btn = host.querySelector("button");
    expect(btn?.textContent).toBe("▶ 入力開始");
  });
});
