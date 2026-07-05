// #244: 軽量 i18n モジュールのテスト。純関数（translate / interpolate）と
// モジュール状態（setLang / getLang / t）を確認する。
// 既存テストは既定言語 ja を前提とするため、setLang を触るテストは必ず ja へ戻す。
import { afterEach, describe, expect, it } from "bun:test";
import { CATALOG, getLang, interpolate, setLang, t, translate, type Catalog } from "./i18n";

const TEST_CATALOG: Catalog = {
  "test.hello": { ja: "こんにちは", en: "Hello" },
  "test.jaOnly": { ja: "日本語のみ" },
  "test.count": { ja: "{n} 件あります", en: "{n} items" },
  "test.pair": { ja: "{a} と {b}", en: "{a} and {b}" },
};

describe("interpolate (#244)", () => {
  it("vars 無しはテンプレートをそのまま返す", () => {
    expect(interpolate("hello {name}")).toBe("hello {name}");
  });

  it("{name} を置換する（数値も文字列化）", () => {
    expect(interpolate("hello {name}", { name: "world" })).toBe("hello world");
    expect(interpolate("{n} 件", { n: 3 })).toBe("3 件");
  });

  it("複数プレースホルダ・同名の複数出現を置換する", () => {
    expect(interpolate("{a}+{b}={a}{b}", { a: 1, b: 2 })).toBe("1+2=12");
  });

  it("vars に無いプレースホルダはそのまま残す（壊れない）", () => {
    expect(interpolate("{a} {b}", { a: "x" })).toBe("x {b}");
  });
});

describe("translate (#244)", () => {
  it("ja はカタログの ja を返す", () => {
    expect(translate(TEST_CATALOG, "ja", "test.hello")).toBe("こんにちは");
  });

  it("en はカタログの en を返す", () => {
    expect(translate(TEST_CATALOG, "en", "test.hello")).toBe("Hello");
  });

  it("en が未翻訳なら ja へフォールバックする", () => {
    expect(translate(TEST_CATALOG, "en", "test.jaOnly")).toBe("日本語のみ");
  });

  it("未知キーはキー名をそのまま返す（壊れない）", () => {
    expect(translate(TEST_CATALOG, "ja", "test.missing")).toBe("test.missing");
    expect(translate(TEST_CATALOG, "en", "test.missing")).toBe("test.missing");
  });

  it("補間つきで引ける", () => {
    expect(translate(TEST_CATALOG, "ja", "test.count", { n: 5 })).toBe("5 件あります");
    expect(translate(TEST_CATALOG, "en", "test.count", { n: 5 })).toBe("5 items");
    expect(translate(TEST_CATALOG, "en", "test.pair", { a: "x", b: "y" })).toBe("x and y");
  });
});

describe("setLang / getLang / t (#244)", () => {
  afterEach(() => setLang("ja")); // 他テストへ状態を漏らさない

  it("既定言語は ja", () => {
    expect(getLang()).toBe("ja");
  });

  it("setLang で t の言語が切り替わる", () => {
    expect(t("panel.settings")).toBe("設定");
    setLang("en");
    expect(getLang()).toBe("en");
    expect(t("panel.settings")).toBe("Settings");
  });

  it("t は補間をサポートする", () => {
    expect(t("menu.duplicateN", { n: 3 })).toBe("複製 (3)");
    setLang("en");
    expect(t("menu.duplicateN", { n: 3 })).toBe("Duplicate (3)");
  });
});

describe("CATALOG (#244)", () => {
  it("全キーの ja / en が非空文字列", () => {
    for (const [key, entry] of Object.entries(CATALOG)) {
      expect(typeof entry.ja, `${key}.ja`).toBe("string");
      expect(entry.ja.length, `${key}.ja`).toBeGreaterThan(0);
      expect(typeof entry.en, `${key}.en`).toBe("string");
      expect((entry.en ?? "").length, `${key}.en`).toBeGreaterThan(0);
    }
  });

  it("補間プレースホルダは ja / en で一致する（翻訳漏れ検知）", () => {
    const names = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort();
    for (const [key, entry] of Object.entries(CATALOG)) {
      expect(names(entry.en ?? ""), key).toEqual(names(entry.ja));
    }
  });
});
