import { describe, it, expect } from "bun:test";
import { PresetStore } from "./PresetStore";
import type { PresetStorageAdapter, PresetBundle } from "./types";
import { PRESET_LIMIT } from "./types";
import { makeDefaultSettings } from "../settings";

function memoryAdapter(initial?: PresetBundle): PresetStorageAdapter {
  let state: PresetBundle = initial ?? { version: 1, presets: [] };
  return {
    read: () => structuredClone(state),
    write: (b) => { state = structuredClone(b); },
  };
}

function sampleInput(name = "x") {
  return {
    name,
    description: "",
    thumbnail: "data:image/webp;base64,AA==",
    settings: makeDefaultSettings(),
  };
}

describe("PresetStore CRUD", () => {
  it("starts empty when adapter is empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.list()).toEqual([]);
  });

  it("add() returns the created preset with id/createdAt/updatedAt set", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("first"));
    expect(p.id).toBeTruthy();
    expect(p.name).toBe("first");
    expect(typeof p.createdAt).toBe("number");
    expect(p.updatedAt).toBe(p.createdAt);
    expect(store.list()).toHaveLength(1);
    expect(store.get(p.id)).toEqual(p);
  });

  it("add() coerces empty name to 'untitled'", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add({ ...sampleInput(""), name: "" });
    expect(p.name).toBe("untitled");
  });

  it("list() is sorted by createdAt ascending", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    // ensure monotonically increasing createdAt across calls
    await new Promise((r) => setTimeout(r, 2));
    const b = store.add(sampleInput("b"));
    const ids = store.list().map((p) => p.id);
    expect(ids).toEqual([a.id, b.id]);
  });

  it("update() mutates the named fields and bumps updatedAt", async () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    const u = store.update(p.id, { name: "renamed", description: "d" });
    expect(u.name).toBe("renamed");
    expect(u.description).toBe("d");
    expect(u.updatedAt).toBeGreaterThan(p.updatedAt);
    expect(u.createdAt).toBe(p.createdAt);
  });

  it("update() throws for unknown id", () => {
    const store = new PresetStore(memoryAdapter());
    expect(() => store.update("nope", { name: "x" })).toThrow();
  });

  it("remove() drops the preset", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    store.remove(p.id);
    expect(store.list()).toEqual([]);
    expect(store.get(p.id)).toBeNull();
  });

  it("remove() is a no-op for unknown id", () => {
    const store = new PresetStore(memoryAdapter());
    expect(() => store.remove("nope")).not.toThrow();
  });

  it("settings are deep-cloned on add (mutating the input later does not affect the store)", () => {
    const store = new PresetStore(memoryAdapter());
    const input = sampleInput("a");
    const p = store.add(input);
    input.settings.color.hueBase = 0.999;
    expect(store.get(p.id)!.settings.color.hueBase).not.toBe(0.999);
  });

  it("persists via the adapter (write is called on add/update/remove)", () => {
    let written = 0;
    const adapter: PresetStorageAdapter = {
      read: () => ({ version: 1, presets: [] }),
      write: () => { written++; },
    };
    const store = new PresetStore(adapter);
    const p = store.add(sampleInput("a"));
    store.update(p.id, { name: "b" });
    store.remove(p.id);
    expect(written).toBe(3);
  });

  it("hydrates from adapter on construction", () => {
    const adapter = memoryAdapter({
      version: 1,
      presets: [{
        id: "fixed",
        name: "seed",
        description: "",
        thumbnail: "",
        settings: makeDefaultSettings(),
        createdAt: 1,
        updatedAt: 1,
      }],
    });
    const store = new PresetStore(adapter);
    expect(store.list()[0].id).toBe("fixed");
  });
});

describe("PresetStore bundle & limit", () => {
  it("toBundle() returns a bundle snapshot ({ version: 1, presets })", () => {
    const store = new PresetStore(memoryAdapter());
    const p = store.add(sampleInput("a"));
    const b = store.toBundle();
    expect(b.version).toBe(1);
    expect(b.presets).toHaveLength(1);
    expect(b.presets[0].id).toBe(p.id);
  });

  it("toBundle() returns a deep copy (mutating result does not affect the store)", () => {
    const store = new PresetStore(memoryAdapter());
    store.add(sampleInput("a"));
    const b = store.toBundle();
    b.presets[0].name = "mutated";
    expect(store.list()[0].name).toBe("a");
  });

  it("fromBundle() replaces all presets and persists", () => {
    const adapter = memoryAdapter();
    const store = new PresetStore(adapter);
    store.add(sampleInput("a"));
    store.fromBundle({
      version: 1,
      presets: [
        { id: "x", name: "X", description: "", thumbnail: "", settings: makeDefaultSettings(), createdAt: 1, updatedAt: 1 },
      ],
    });
    expect(store.list().map((p) => p.id)).toEqual(["x"]);
    expect(adapter.read().presets.map((p) => p.id)).toEqual(["x"]);
  });

  it("replaceAll() works the same and accepts a plain array", () => {
    const store = new PresetStore(memoryAdapter());
    store.replaceAll([
      { id: "y", name: "Y", description: "", thumbnail: "", settings: makeDefaultSettings(), createdAt: 2, updatedAt: 2 },
    ]);
    expect(store.list().map((p) => p.id)).toEqual(["y"]);
  });

  it("add() throws RangeError when PRESET_LIMIT is reached", () => {
    const store = new PresetStore(memoryAdapter());
    for (let i = 0; i < PRESET_LIMIT; i++) store.add(sampleInput(`p${i}`));
    expect(() => store.add(sampleInput("over"))).toThrow(RangeError);
  });
});

describe("PresetStore navigation", () => {
  it("nextOf(null) returns the first preset in list order", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    store.add(sampleInput("b"));
    expect(store.nextOf(null)?.id).toBe(a.id);
  });

  it("nextOf(currentId) returns the next preset and wraps to head at the end", async () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    await new Promise((r) => setTimeout(r, 2));
    const b = store.add(sampleInput("b"));
    expect(store.nextOf(a.id)?.id).toBe(b.id);
    expect(store.nextOf(b.id)?.id).toBe(a.id); // wrap
  });

  it("nextOf() returns null when the store is empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.nextOf(null)).toBeNull();
    expect(store.nextOf("any")).toBeNull();
  });

  it("nextOf(unknownId) returns the first preset (treated as null)", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    expect(store.nextOf("nope")?.id).toBe(a.id);
  });

  it("randomOf() never returns the excludeId when there are ≥2 presets", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    const b = store.add(sampleInput("b"));
    // rng が 0 (= 先頭) を返してきても、a を除外したいなら b に進むはず。
    const rng = () => 0;
    const r = store.randomOf(a.id, rng);
    expect(r?.id).toBe(b.id);
  });

  it("randomOf(null) returns any preset", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    const r = store.randomOf(null, () => 0);
    expect(r?.id).toBe(a.id);
  });

  it("randomOf() returns the only preset even if it matches excludeId", () => {
    const store = new PresetStore(memoryAdapter());
    const a = store.add(sampleInput("a"));
    expect(store.randomOf(a.id, () => 0)?.id).toBe(a.id);
  });

  it("randomOf() returns null when empty", () => {
    const store = new PresetStore(memoryAdapter());
    expect(store.randomOf(null, () => 0)).toBeNull();
  });
});
