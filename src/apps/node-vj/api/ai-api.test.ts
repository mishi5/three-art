// #177: AI 操作インターフェース（コマンド API）のテスト。
// カタログ生成・値要約・setParam 検証・applyGraphYaml の履歴（Cmd+Z 相当）を
// フェイクフック＋実 registry/serialize で検証する。
import { describe, expect, test } from "bun:test";
import {
  buildNodeCatalog, createAiApi, summarizeOutputValue, validateParamValue,
  type AiApiHooks,
} from "./ai-api";
import { addNode, createGraph, replaceGraph, type GraphDoc } from "../graph/graph-doc";
import { History } from "../graph/history";
import { NodeRegistry, type ParamDef } from "../graph/node-type";
import { deserializeGraph, serializeGraph } from "../graph/serialize";
import { createDefaultRegistry } from "../nodes/registry";

// ---- テスト用ミニ registry（実 registry 非依存の検証に使う） ----

function miniRegistry(): NodeRegistry {
  const r = new NodeRegistry();
  r.register({
    type: "Num",
    category: "value",
    description: "数値ソース",
    inputs: [],
    outputs: [{ id: "out", label: "out", type: "number", description: "値" }],
    params: [
      { id: "value", label: "value", kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, description: "出力値" },
      { id: "count", label: "count", kind: "int", default: 3, min: 1, max: 10 },
      { id: "on", label: "on", kind: "boolean", default: false },
      { id: "mode", label: "mode", kind: "enum", default: "a", options: ["a", "b"] },
      { id: "name", label: "name", kind: "string", default: "", noInput: true, hidden: true },
    ],
    evaluate: (ctx) => ({ out: Number(ctx.param("value")) }),
  });
  r.register({
    type: "Sig",
    inputs: [{ id: "tex", label: "tex", type: "texture" }],
    outputs: [],
    params: [],
    isSink: true,
    evaluate: () => ({}),
  });
  return r;
}

/** scenes フックのフェイク（#245: シーン管理コマンド追加でメンバが増えたため helper 化）。 */
function fakeSceneHooks(over: Partial<AiApiHooks["scenes"]> = {}): AiApiHooks["scenes"] {
  return {
    list: () => [{ id: "s1", name: "Scene 1" }],
    activeId: () => "s1",
    outputId: () => null,
    switchTo: () => {},
    add: () => "s-new",
    rename: () => {},
    remove: () => {},
    setOutput: () => {},
    ...over,
  };
}

function fakeHooks(over: Partial<AiApiHooks> = {}): AiApiHooks {
  const graph = createGraph();
  return {
    graph,
    registry: miniRegistry(),
    history: new History(),
    getOutputs: () => undefined,
    scenes: fakeSceneHooks(),
    applyYaml: () => [],
    ...over,
  };
}

// ---- buildNodeCatalog ----

describe("buildNodeCatalog", () => {
  test("type/category/description と入出力・param 仕様を JSON セーフに出す", () => {
    const catalog = buildNodeCatalog(miniRegistry());
    expect(catalog.map((n) => n.type)).toEqual(["Num", "Sig"]);
    const num = catalog[0]!;
    expect(num.category).toBe("value");
    expect(num.description).toBe("数値ソース");
    expect(num.outputs).toEqual([{ id: "out", type: "number", label: "out", description: "値" }]);
    const value = num.params.find((p) => p.id === "value")!;
    expect(value).toEqual({
      id: "value", label: "value", kind: "number", default: 0.5, min: 0, max: 1, step: 0.01, description: "出力値",
    });
    // min/max/step/options 無しの param はキー自体を出さない
    const on = num.params.find((p) => p.id === "on")!;
    expect("min" in on).toBe(false);
    expect("options" in on).toBe(false);
    // JSON ラウンドトリップ可能（関数等を含まない）
    expect(JSON.parse(JSON.stringify(catalog))).toEqual(catalog);
  });

  test("inputs は実効入力ポート（数値 param 由来を含む・noInput は除外）", () => {
    const catalog = buildNodeCatalog(miniRegistry());
    const num = catalog[0]!;
    const ids = num.inputs.map((p) => p.id);
    expect(ids).toContain("value"); // number param → 入力ポート
    expect(ids).toContain("count"); // int param → 入力ポート
    expect(ids).not.toContain("on"); // boolean は入力ポートにならない
    expect(ids).not.toContain("name"); // noInput
    // param 由来入力にも description が付く（ParamDef から補完）
    expect(num.inputs.find((p) => p.id === "value")!.description).toBe("出力値");
    // 宣言入力（texture）はそのまま
    expect(catalog[1]!.inputs).toEqual([{ id: "tex", type: "texture", label: "tex" }]);
  });

  test("実 registry 全ノードで JSON シリアライズ可能", () => {
    const catalog = buildNodeCatalog(createDefaultRegistry());
    expect(catalog.length).toBeGreaterThan(10);
    expect(() => JSON.stringify(catalog)).not.toThrow();
    // 代表ノードの仕様が引ける（AI がグラフを書ける粒度）
    const number = catalog.find((n) => n.type === "Number")!;
    expect(number.outputs.some((p) => p.type === "number")).toBe(true);
    expect(number.params.some((p) => p.id === "value")).toBe(true);
  });
});

// ---- summarizeOutputValue ----

describe("summarizeOutputValue", () => {
  test("プリミティブはそのまま", () => {
    expect(summarizeOutputValue(1.25)).toBe(1.25);
    expect(summarizeOutputValue(0)).toBe(0);
    expect(summarizeOutputValue(true)).toBe(true);
    expect(summarizeOutputValue(false)).toBe(false);
    expect(summarizeOutputValue("abc")).toBe("abc");
  });

  test("非有限数は文字列化（JSON で null 化させない）", () => {
    expect(summarizeOutputValue(NaN)).toBe("NaN");
    expect(summarizeOutputValue(Infinity)).toBe("Infinity");
  });

  test("null/undefined/配列/オブジェクトは型名文字列", () => {
    expect(summarizeOutputValue(null)).toBe("<null>");
    expect(summarizeOutputValue(undefined)).toBe("<undefined>");
    expect(summarizeOutputValue([1, 2, 3])).toBe("<Array(3)>");
    expect(summarizeOutputValue({})).toBe("<Object>");
    class GainNodeLike {}
    expect(summarizeOutputValue(new GainNodeLike())).toBe("<GainNodeLike>");
  });

  test("THREE.Texture 相当は isTexture フラグで <Texture>", () => {
    expect(summarizeOutputValue({ isTexture: true, uuid: "x" })).toBe("<Texture>");
  });
});

// ---- validateParamValue ----

describe("validateParamValue", () => {
  const num: ParamDef = { id: "v", label: "v", kind: "number", default: 0, min: 0, max: 1 };

  test("number: 範囲内はそのまま・範囲外はクランプ", () => {
    expect(validateParamValue(num, 0.5)).toEqual({ ok: true, value: 0.5 });
    expect(validateParamValue(num, -2)).toEqual({ ok: true, value: 0 });
    expect(validateParamValue(num, 9)).toEqual({ ok: true, value: 1 });
  });

  test("number: min/max 無しはクランプしない", () => {
    const free: ParamDef = { id: "v", label: "v", kind: "number", default: 0 };
    expect(validateParamValue(free, -123.5)).toEqual({ ok: true, value: -123.5 });
  });

  test("number: 型不一致・NaN はエラー", () => {
    expect(validateParamValue(num, "0.5").ok).toBe(false);
    expect(validateParamValue(num, NaN).ok).toBe(false);
    expect(validateParamValue(num, undefined).ok).toBe(false);
  });

  test("int: 丸め＋クランプ", () => {
    const int: ParamDef = { id: "n", label: "n", kind: "int", default: 1, min: 1, max: 10 };
    expect(validateParamValue(int, 3.6)).toEqual({ ok: true, value: 4 });
    expect(validateParamValue(int, 99)).toEqual({ ok: true, value: 10 });
  });

  test("boolean / string の型検証", () => {
    const b: ParamDef = { id: "b", label: "b", kind: "boolean", default: false };
    expect(validateParamValue(b, true)).toEqual({ ok: true, value: true });
    expect(validateParamValue(b, 1).ok).toBe(false);
    const s: ParamDef = { id: "s", label: "s", kind: "string", default: "" };
    expect(validateParamValue(s, "hi")).toEqual({ ok: true, value: "hi" });
    expect(validateParamValue(s, 3).ok).toBe(false);
  });

  test("enum: options 内のみ許可", () => {
    const e: ParamDef = { id: "m", label: "m", kind: "enum", default: "a", options: ["a", "b"] };
    expect(validateParamValue(e, "b")).toEqual({ ok: true, value: "b" });
    const bad = validateParamValue(e, "c");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.error).toContain("a, b");
    expect(validateParamValue(e, 1).ok).toBe(false);
  });
});

// ---- createAiApi: 読取系 ----

describe("createAiApi 読取", () => {
  test("getGraphYaml は共有グラフの YAML を返す", () => {
    const hooks = fakeHooks();
    addNode(hooks.graph, { id: "n1", type: "Num", params: { value: 0.5 } });
    const res = createAiApi(hooks).getGraphYaml();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.yaml).toContain("id: n1");
      expect(res.yaml).toContain("type: Num");
    }
  });

  test("getScenes は active / 実効 output フラグを付ける（ピン無しはアクティブが出力）", () => {
    const hooks = fakeHooks({
      scenes: fakeSceneHooks({
        list: () => [{ id: "s1", name: "A" }, { id: "s2", name: "B" }],
      }),
    });
    const res = createAiApi(hooks).getScenes();
    expect(res).toEqual({
      ok: true,
      scenes: [
        { id: "s1", name: "A", active: true, output: true },
        { id: "s2", name: "B", active: false, output: false },
      ],
    });
  });

  test("getScenes: 出力ピン中はピン先が output", () => {
    const hooks = fakeHooks({
      scenes: fakeSceneHooks({
        list: () => [{ id: "s1", name: "A" }, { id: "s2", name: "B" }],
        outputId: () => "s2",
      }),
    });
    const res = createAiApi(hooks).getScenes();
    if (res.ok) {
      expect(res.scenes[0]).toMatchObject({ active: true, output: false });
      expect(res.scenes[1]).toMatchObject({ active: false, output: true });
    } else {
      throw new Error(res.error);
    }
  });

  test("getStatus は直近評価値を要約して返す（未評価ノードは outputs: {}）", () => {
    const outputs = new Map<string, Record<string, unknown>>([
      ["n1", { out: 0.75, flag: true, tex: { isTexture: true }, misc: null }],
    ]);
    const hooks = fakeHooks({ getOutputs: (id) => outputs.get(id) });
    addNode(hooks.graph, { id: "n1", type: "Num", params: {} });
    addNode(hooks.graph, { id: "n2", type: "Num", params: {} });
    const res = createAiApi(hooks).getStatus();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.activeSceneId).toBe("s1");
      expect(res.outputSceneId).toBe("s1"); // ピン無し＝実効出力はアクティブ
      expect(res.nodeCount).toBe(2);
      expect(res.nodes[0]).toEqual({
        id: "n1", type: "Num",
        outputs: { out: 0.75, flag: true, tex: "<Texture>", misc: "<null>" },
      });
      expect(res.nodes[1]).toEqual({ id: "n2", type: "Num", outputs: {} });
      // 返せる形は JSON セーフ
      expect(JSON.parse(JSON.stringify(res))).toEqual(res);
    }
  });

  test("getNodeCatalog は version と全ノード仕様を返す", () => {
    const res = createAiApi(fakeHooks()).getNodeCatalog();
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.version).toBe(1);
      expect(res.nodes.map((n) => n.type)).toEqual(["Num", "Sig"]);
    }
  });
});

// ---- createAiApi: setParam ----

describe("createAiApi setParam", () => {
  function setup() {
    const history = new History();
    const hooks = fakeHooks({ history });
    addNode(hooks.graph, { id: "n1", type: "Num", params: { value: 0.5, count: 3, on: false, mode: "a" } });
    return { api: createAiApi(hooks), hooks, history };
  }

  test("正常系: 値を書き換え・履歴に 1 回積む（Cmd+Z で戻せる）", () => {
    const { api, hooks, history } = setup();
    expect(history.canUndo).toBe(false);
    expect(api.setParam("n1", "value", 0.9)).toEqual({ ok: true });
    expect(hooks.graph.nodes[0]!.params.value).toBe(0.9);
    expect(history.canUndo).toBe(true);
    const snap = history.undo(hooks.graph);
    expect(snap!.nodes[0]!.params.value).toBe(0.5); // 変更前が復元される
  });

  test("クランプ・enum 検証が効く", () => {
    const { api, hooks } = setup();
    expect(api.setParam("n1", "value", 5)).toEqual({ ok: true });
    expect(hooks.graph.nodes[0]!.params.value).toBe(1); // max=1 でクランプ
    expect(api.setParam("n1", "mode", "b")).toEqual({ ok: true });
    const bad = api.setParam("n1", "mode", "zzz");
    expect(bad.ok).toBe(false);
    expect(hooks.graph.nodes[0]!.params.mode).toBe("b"); // 不正値は反映されない
  });

  test("ノード/param 不在・kind 不一致はエラー", () => {
    const { api } = setup();
    expect(api.setParam("ghost", "value", 1).ok).toBe(false);
    expect(api.setParam("n1", "nope", 1).ok).toBe(false);
    expect(api.setParam("n1", "on", "true").ok).toBe(false);
  });

  test("変更なしは履歴に積まない", () => {
    const { api, history } = setup();
    expect(api.setParam("n1", "value", 0.5)).toEqual({ ok: true });
    expect(history.canUndo).toBe(false);
  });
});

// ---- createAiApi: applyGraphYaml / switchScene ----

describe("createAiApi applyGraphYaml", () => {
  /** main.ts の applyYaml フックと同じ手順（deserialize→record→replaceGraph）を再現する。 */
  function mainLikeApplyYaml(graph: GraphDoc, registry: NodeRegistry, history: History) {
    return (text: string): string[] => {
      const { graph: loaded, warnings } = deserializeGraph(text, registry);
      history.record(graph); // AI 適用は Cmd+Z で戻せる（preset 読込の clear と異なる）
      replaceGraph(graph, loaded);
      return warnings;
    };
  }

  test("正常系: グラフが差し替わり undo で元へ戻せる", () => {
    const registry = miniRegistry();
    const history = new History();
    const graph = createGraph();
    addNode(graph, { id: "old", type: "Num", params: { value: 0.1 } });
    const hooks = fakeHooks({ graph, registry, history, applyYaml: mainLikeApplyYaml(graph, registry, history) });
    const api = createAiApi(hooks);

    const next = createGraph();
    addNode(next, { id: "new1", type: "Num", params: { value: 0.9, count: 3, on: false, mode: "a", name: "" } });
    const res = api.applyGraphYaml(serializeGraph(next));
    expect(res).toEqual({ ok: true, warnings: [] });
    expect(graph.nodes.map((n) => n.id)).toEqual(["new1"]);

    // Cmd+Z 相当: undo スナップショットに旧グラフが残っている
    const snap = history.undo(graph);
    expect(snap!.nodes.map((n) => n.id)).toEqual(["old"]);
  });

  test("未知ノードは warnings 付きで安全に除去される", () => {
    const registry = miniRegistry();
    const history = new History();
    const graph = createGraph();
    const hooks = fakeHooks({ graph, registry, history, applyYaml: mainLikeApplyYaml(graph, registry, history) });
    const api = createAiApi(hooks);

    const yaml = [
      "version: 1",
      "nodes:",
      "  - id: ok1",
      "    type: Num",
      "    params: {}",
      "  - id: ghost",
      "    type: NoSuchNode",
      "    params: {}",
      "connections: []",
    ].join("\n");
    const res = api.applyGraphYaml(yaml);
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.warnings.length).toBe(1);
    expect(graph.nodes.map((n) => n.id)).toEqual(["ok1"]);
  });

  test("不正 YAML / version 不一致は ok:false でエラーを返す（グラフは無傷）", () => {
    const registry = miniRegistry();
    const history = new History();
    const graph = createGraph();
    addNode(graph, { id: "keep", type: "Num", params: {} });
    const hooks = fakeHooks({ graph, registry, history, applyYaml: mainLikeApplyYaml(graph, registry, history) });
    const api = createAiApi(hooks);

    expect(api.applyGraphYaml("version: 999\nnodes: []").ok).toBe(false);
    expect(api.applyGraphYaml(": : :").ok).toBe(false);
    expect(api.applyGraphYaml(123 as unknown as string).ok).toBe(false);
    expect(graph.nodes.map((n) => n.id)).toEqual(["keep"]);
    expect(history.canUndo).toBe(false); // 失敗時は履歴も汚さない（record 前に throw）
  });
});

describe("createAiApi switchScene", () => {
  test("既存シーンなら switchTo を呼ぶ・不在ならエラーで呼ばない", () => {
    const calls: string[] = [];
    const hooks = fakeHooks({
      scenes: fakeSceneHooks({
        list: () => [{ id: "s1", name: "A" }, { id: "s2", name: "B" }],
        switchTo: (id) => calls.push(id),
      }),
    });
    const api = createAiApi(hooks);
    expect(api.switchScene("s2")).toEqual({ ok: true });
    expect(calls).toEqual(["s2"]);
    expect(api.switchScene("ghost").ok).toBe(false);
    expect(calls).toEqual(["s2"]);
  });
});

// ---- createAiApi: シーン管理（#245） ----

/**
 * ステートフルなフェイク scenes フック。main.ts の sceneActions（sceneManager）と同じ
 * 表面挙動（add は新シーンをアクティブ化・remove のフォールバック）を最小再現し、呼び出しを記録する。
 */
function statefulScenes(initial: { id: string; name: string }[]) {
  const scenes = initial.map((s) => ({ ...s }));
  let activeId = scenes[0]!.id;
  let outputId: string | null = null;
  let seq = 0;
  const calls: unknown[][] = [];
  const hooks: AiApiHooks["scenes"] = {
    list: () => scenes.map((s) => ({ ...s })),
    activeId: () => activeId,
    outputId: () => outputId,
    switchTo: (id) => { calls.push(["switchTo", id]); activeId = id; },
    add: (name) => {
      calls.push(["add", name]);
      const id = `new-${++seq}`;
      scenes.push({ id, name: name ?? `Scene ${scenes.length + 1}` });
      activeId = id; // UI の「＋」と同じく新シーンをアクティブ化
      return id;
    },
    rename: (id, name) => { calls.push(["rename", id, name]); scenes.find((s) => s.id === id)!.name = name; },
    remove: (id) => {
      calls.push(["remove", id]);
      const idx = scenes.findIndex((s) => s.id === id);
      scenes.splice(idx, 1);
      if (activeId === id) activeId = scenes[Math.min(idx, scenes.length - 1)]!.id;
      if (outputId === id) outputId = null;
    },
    setOutput: (id) => { calls.push(["setOutput", id]); outputId = id; },
  };
  return { hooks, calls, state: { get activeId() { return activeId; }, get outputId() { return outputId; } } };
}

describe("createAiApi addScene", () => {
  test("新シーンを作成してアクティブ化し sceneId を返す（name 省略可）", () => {
    const { hooks, calls, state } = statefulScenes([{ id: "s1", name: "A" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    const res = api.addScene();
    expect(res).toEqual({ ok: true, sceneId: "new-1" });
    expect(calls).toEqual([["add", undefined]]);
    expect(state.activeId).toBe("new-1"); // UI の「＋」と同経路＝新シーンがアクティブ
  });

  test("name 指定は trim して渡す・空白のみはエラー", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    expect(api.addScene("  Intro  ")).toEqual({ ok: true, sceneId: "new-1" });
    expect(calls).toEqual([["add", "Intro"]]);
    const bad = api.addScene("   ");
    expect(bad.ok).toBe(false);
    expect(calls.length).toBe(1); // エラー時はフックを呼ばない
  });
});

describe("createAiApi renameScene", () => {
  test("既存シーンを trim 済み name で改名する", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }, { id: "s2", name: "B" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    expect(api.renameScene("s2", "  Drop  ")).toEqual({ ok: true });
    expect(calls).toEqual([["rename", "s2", "Drop"]]);
  });

  test("不在 id / 空 name はエラーで呼ばない", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    const ghost = api.renameScene("ghost", "X");
    expect(ghost.ok).toBe(false);
    if (!ghost.ok) expect(ghost.error).toContain("ghost");
    expect(api.renameScene("s1", "   ").ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("createAiApi removeScene", () => {
  test("既存シーンを削除できる（アクティブ削除は UI と同じフォールバック）", () => {
    const { hooks, calls, state } = statefulScenes([{ id: "s1", name: "A" }, { id: "s2", name: "B" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    expect(api.removeScene("s1")).toEqual({ ok: true });
    expect(calls).toEqual([["remove", "s1"]]);
    expect(state.activeId).toBe("s2");
  });

  test("最後の 1 枚は削除不可（ok:false・フックを呼ばない）", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    const res = api.removeScene("s1");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("最後");
    expect(calls).toEqual([]);
  });

  test("不在 id はエラー", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }, { id: "s2", name: "B" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    expect(api.removeScene("ghost").ok).toBe(false);
    expect(calls).toEqual([]);
  });
});

describe("createAiApi setOutputScene", () => {
  test("既存シーンをピン留め・null で解除できる", () => {
    const { hooks, calls, state } = statefulScenes([{ id: "s1", name: "A" }, { id: "s2", name: "B" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    expect(api.setOutputScene("s2")).toEqual({ ok: true });
    expect(state.outputId).toBe("s2");
    expect(api.setOutputScene(null)).toEqual({ ok: true });
    expect(state.outputId).toBe(null);
    expect(calls).toEqual([["setOutput", "s2"], ["setOutput", null]]);
  });

  test("不在 id はエラーで呼ばない（sceneManager の静かな null フォールバックに任せない）", () => {
    const { hooks, calls } = statefulScenes([{ id: "s1", name: "A" }]);
    const api = createAiApi(fakeHooks({ scenes: hooks }));
    const res = api.setOutputScene("ghost");
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("ghost");
    expect(calls).toEqual([]);
  });
});
