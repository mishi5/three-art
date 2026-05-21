import { describe, it, expect } from "bun:test";
import { PresetStore } from "./PresetStore";
import type { PresetStorageAdapter, PresetBundle } from "./types";
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
