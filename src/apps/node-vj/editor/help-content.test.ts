// #242: ヘルプポップアップの表示データ生成（純関数）のテスト。
// 操作モード（#229 modern/legacy）でパン/矩形選択の記述が差し替わることを確認する。
import { expect, test, describe } from "bun:test";
import { helpSections } from "./help-content";

/** 全項目を「keys desc」の平文にして検索しやすくする。 */
function flatten(mode: "modern" | "legacy"): string[] {
  return helpSections(mode).flatMap((s) => s.items.map((i) => `${i.keys} ${i.desc}`));
}

describe("helpSections", () => {
  test("セクションは 3 つ（パン・選択 / ノード・接続 / キーボード）で、見出し・項目が非空", () => {
    for (const mode of ["modern", "legacy"] as const) {
      const sections = helpSections(mode);
      expect(sections.length).toBe(3);
      for (const s of sections) {
        expect(s.title.length).toBeGreaterThan(0);
        expect(s.items.length).toBeGreaterThan(0);
        for (const i of s.items) {
          expect(i.keys.length).toBeGreaterThan(0);
          expect(i.desc.length).toBeGreaterThan(0);
        }
      }
    }
  });

  test("modern: 空白左ドラッグ=パン / Shift+左ドラッグ=矩形選択", () => {
    const all = flatten("modern");
    expect(all.some((t) => t.includes("空白を左ドラッグ") && t.includes("パン"))).toBe(true);
    expect(all.some((t) => t.includes("Shift") && t.includes("矩形選択"))).toBe(true);
  });

  test("legacy: 空白左ドラッグ=矩形選択（Shift の記述はない）", () => {
    const all = flatten("legacy");
    expect(all.some((t) => t.includes("空白を左ドラッグ") && t.includes("矩形選択"))).toBe(true);
    expect(all.some((t) => t.includes("Shift+左ドラッグ"))).toBe(false);
  });

  test("モード共通のマウス操作（右クリックメニュー・ズーム・中/右ドラッグパン）が両モードにある", () => {
    for (const mode of ["modern", "legacy"] as const) {
      const all = flatten(mode);
      expect(all.some((t) => t.includes("右クリック") && t.includes("メニュー"))).toBe(true);
      expect(all.some((t) => t.includes("ホイール") && t.includes("ズーム"))).toBe(true);
      expect(all.some((t) => t.includes("中・右ドラッグ") && t.includes("パン"))).toBe(true);
    }
  });

  test("ノード・接続の操作（移動・接続・切断・スライダ編集）が両モードにある", () => {
    for (const mode of ["modern", "legacy"] as const) {
      const all = flatten(mode);
      expect(all.some((t) => t.includes("接続"))).toBe(true);
      expect(all.some((t) => t.includes("切断"))).toBe(true);
      expect(all.some((t) => t.includes("スライダ"))).toBe(true);
      expect(all.some((t) => t.includes("移動"))).toBe(true);
    }
  });

  test("キーボード操作（Space・Cmd+Z・Delete・コピー/貼り付け・グループ化・0・Esc）が両モードにある", () => {
    for (const mode of ["modern", "legacy"] as const) {
      const all = flatten(mode);
      expect(all.some((t) => t.includes("Space") && t.includes("パン"))).toBe(true);
      expect(all.some((t) => t.includes("Cmd+Z"))).toBe(true);
      expect(all.some((t) => t.includes("Shift+Cmd+Z"))).toBe(true);
      expect(all.some((t) => t.includes("Delete"))).toBe(true);
      expect(all.some((t) => t.includes("Cmd+C") && t.includes("コピー"))).toBe(true);
      expect(all.some((t) => t.includes("Cmd+V") && t.includes("貼り付け"))).toBe(true);
      expect(all.some((t) => t.includes("Cmd+G") && t.includes("グループ"))).toBe(true);
      expect(all.some((t) => t.includes("0") && t.includes("100%"))).toBe(true);
      expect(all.some((t) => t.includes("Esc"))).toBe(true);
    }
  });

  test("毎回新しい配列を返す（呼び出し側の変更が共有されない）", () => {
    const a = helpSections("modern");
    const b = helpSections("modern");
    expect(a).not.toBe(b);
    expect(a[0]!.items).not.toBe(b[0]!.items);
  });
});
