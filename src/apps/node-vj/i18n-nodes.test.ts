// #254: ノード定義文言の i18n 網羅テスト。
// registry を走査し、全ノードの description / ポート説明 / param 説明が
// NODE_CATALOG のキーであることを検証する（新ノード追加時のキー漏れ・訳漏れを自動検出）。
import { describe, expect, test } from "bun:test";
import { NODE_CATALOG } from "./i18n-nodes";
import { getLang, resolveNodeText, setLang, t } from "./i18n";
import { createDefaultRegistry } from "./nodes/registry";

/** 意図的に翻訳しない description の例外リスト（値そのものを列挙。現状なし）。 */
const EXCEPTIONS = new Set<string>([]);

/** registry の全 description を「参照元の説明付き」で列挙する。 */
function collectDescriptionRefs(): { at: string; text: string }[] {
  const out: { at: string; text: string }[] = [];
  for (const def of createDefaultRegistry().list()) {
    if (def.description) out.push({ at: `${def.type}.description`, text: def.description });
    for (const p of def.inputs) {
      if (p.description) out.push({ at: `${def.type}.inputs.${p.id}`, text: p.description });
    }
    for (const p of def.outputs) {
      if (p.description) out.push({ at: `${def.type}.outputs.${p.id}`, text: p.description });
    }
    for (const p of def.params) {
      if (p.description) out.push({ at: `${def.type}.params.${p.id}`, text: p.description });
    }
  }
  return out;
}

describe("i18n-nodes: カタログ網羅", () => {
  test("全ノードの description / ポート / param 説明がカタログのキーである", () => {
    const missing = collectDescriptionRefs()
      .filter((r) => !EXCEPTIONS.has(r.text) && !(r.text in NODE_CATALOG))
      .map((r) => `${r.at}: ${r.text}`);
    expect(missing).toEqual([]);
  });

  test("カタログの全キーがいずれかのノード定義から参照されている（死にキーなし）", () => {
    const used = new Set(collectDescriptionRefs().map((r) => r.text));
    const dead = Object.keys(NODE_CATALOG).filter((k) => !used.has(k));
    expect(dead).toEqual([]);
  });

  test("全エントリが命名規約 node.* に従い、ja / en とも非空である", () => {
    const bad: string[] = [];
    for (const [key, entry] of Object.entries(NODE_CATALOG)) {
      if (!/^node\./.test(key)) bad.push(`命名規約違反: ${key}`);
      if (!entry.ja) bad.push(`ja 欠落: ${key}`);
      if (!(entry as { en?: string }).en) bad.push(`en 欠落: ${key}`);
    }
    expect(bad).toEqual([]);
  });
});

describe("i18n-nodes: resolveNodeText", () => {
  test("現在言語で解決し、en 切替で英語になる", () => {
    const prev = getLang();
    try {
      setLang("ja");
      expect(resolveNodeText("node.Sine.desc")).toBe(NODE_CATALOG["node.Sine.desc"].ja);
      setLang("en");
      expect(resolveNodeText("node.Sine.desc")).toBe(NODE_CATALOG["node.Sine.desc"].en);
    } finally {
      setLang(prev);
    }
  });

  test("カタログに無い文字列はそのまま返す（未キー化・動的文字列を壊さない）", () => {
    expect(resolveNodeText("自由入力の説明")).toBe("自由入力の説明");
    expect(resolveNodeText("")).toBe("");
  });

  test("t() からもノード文言キーを引ける（カタログ merge）", () => {
    const prev = getLang();
    try {
      setLang("ja");
      expect(t("node.Screen.desc")).toBe(NODE_CATALOG["node.Screen.desc"].ja);
    } finally {
      setLang(prev);
    }
  });
});
