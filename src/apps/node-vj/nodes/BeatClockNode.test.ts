// #270: BeatClock ノード（BPM ビートクロック）のテスト。
import { describe, expect, test } from "bun:test";
import { BeatClockNode, BeatClockRuntime } from "./BeatClockNode";
import type { EvalContext } from "../graph/node-type";
import type { NodeInstance } from "../graph/graph-doc";

/** evaluate 用の最小 EvalContext（TapSequencerNode.test.ts と同型）。 */
function ctxAt(
  timeSec: number,
  state: BeatClockRuntime | undefined,
  inputs: Record<string, unknown> = {},
  node?: NodeInstance,
): EvalContext {
  const n = node ?? { id: "n1", type: "BeatClock", params: {} };
  return {
    timeSec,
    input: (id: string) => inputs[id],
    param: (id: string) =>
      id in n.params ? n.params[id] : BeatClockNode.params.find((p) => p.id === id)?.default,
    node: n,
    state,
  };
}

/** step の onCommitBpm に何も繋がないヘルパ（commit 不要のテスト用）。 */
const noCommit = (): void => { /* no-op */ };

describe("#270 BeatClockNode 定義", () => {
  test("control カテゴリ・beatClock フラグ・tap/onset trigger 入力", () => {
    expect(BeatClockNode.type).toBe("BeatClock");
    expect(BeatClockNode.category).toBe("control");
    expect(BeatClockNode.beatClock).toBe(true);
    expect(BeatClockNode.inputs.map((p) => p.id)).toEqual(["tap", "onset"]);
    for (const p of BeatClockNode.inputs) expect(p.type).toBe("trigger");
  });

  test("bpm/beats/phase の number 出力・beat/div の trigger 出力", () => {
    expect(BeatClockNode.outputs.map((o) => o.id)).toEqual(["bpm", "beats", "phase", "beat", "div"]);
    const type = (id: string) => BeatClockNode.outputs.find((o) => o.id === id)!.type;
    expect(type("bpm")).toBe("number");
    expect(type("beats")).toBe("number");
    expect(type("phase")).toBe("number");
    expect(type("beat")).toBe("trigger");
    expect(type("div")).toBe("trigger");
  });

  test("bpm param（number・default 120・接続可能）と division param（enum・default 1）", () => {
    const bpm = BeatClockNode.params.find((p) => p.id === "bpm")!;
    expect(bpm.kind).toBe("number");
    expect(bpm.default).toBe(120);
    expect(bpm.min).toBe(30);
    expect(bpm.max).toBe(300);
    expect(bpm.noInput).toBeUndefined(); // 接続も手動ドラッグも可能な通常 param
    const division = BeatClockNode.params.find((p) => p.id === "division")!;
    expect(division.kind).toBe("enum");
    expect(division.default).toBe("1");
    expect(division.options).toEqual(["1/4", "1/2", "1", "2", "4", "8"]);
  });

  test("createState は BeatClockRuntime を返す", () => {
    expect(BeatClockNode.createState!(undefined as never)).toBeInstanceOf(BeatClockRuntime);
  });
});

describe("#270 BeatClockRuntime: beats/phase の進行", () => {
  test("120BPM で 1 秒進めると beats が 2 増える", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, false, false, 0, "1", noCommit); // prime（dt=0）
    const out = rt.step(120, false, false, 1, "1", noCommit);
    expect(out.beats).toBeCloseTo(2, 9);
    expect(out.phase).toBeCloseTo(0, 9);
    expect(out.bpm).toBe(120);
  });

  test("phase は拍内位相 0..1", () => {
    const rt = new BeatClockRuntime();
    rt.step(60, false, false, 0, "1", noCommit);
    const out = rt.step(60, false, false, 0.25, "1", noCommit); // 60BPM で 0.25s → 0.25 拍
    expect(out.beats).toBeCloseTo(0.25, 9);
    expect(out.phase).toBeCloseTo(0.25, 9);
  });

  test("初回フレーム（prime）は dt=0 扱いで beat/div を誤発火しない", () => {
    const rt = new BeatClockRuntime();
    const out = rt.step(120, false, false, 100, "1", noCommit);
    expect(out.beats).toBe(0);
    expect(out.beat).toBe(false);
    expect(out.div).toBe(false);
  });

  test("bpm param の手動変更は即反映される（次フレームから新レートで進む）", () => {
    const rt = new BeatClockRuntime();
    rt.step(60, false, false, 0, "1", noCommit);
    rt.step(60, false, false, 1, "1", noCommit);   // 60BPM: +1 拍
    const out = rt.step(120, false, false, 2, "1", noCommit); // 120BPM: +2 拍
    expect(out.beats).toBeCloseTo(3, 9);
  });
});

describe("#270 BeatClockRuntime: beat/div トリガ", () => {
  test("120BPM で 1 秒間に beat が 2 回発火する", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, false, false, 0, "1", noCommit);
    let fires = 0;
    for (let i = 1; i <= 20; i++) {
      if (rt.step(120, false, false, i * 0.05, "1", noCommit).beat) fires++;
    }
    expect(fires).toBe(2); // 拍境界 1.0 / 2.0 の 2 回
  });

  test("division \"4\" は 4 拍ごとに div が発火する（beat は毎拍）", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, false, false, 0, "4", noCommit);
    let beatFires = 0, divFires = 0;
    // 120BPM で 4 秒 = 8 拍。
    for (let i = 1; i <= 80; i++) {
      const out = rt.step(120, false, false, i * 0.05, "4", noCommit);
      if (out.beat) beatFires++;
      if (out.div) divFires++;
    }
    expect(beatFires).toBe(8);
    expect(divFires).toBe(2); // 4 拍・8 拍の 2 回
  });

  test("division \"1/2\" は半拍ごとに div が発火する", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, false, false, 0, "1/2", noCommit);
    let divFires = 0;
    for (let i = 1; i <= 20; i++) {
      if (rt.step(120, false, false, i * 0.05, "1/2", noCommit).div) divFires++;
    }
    expect(divFires).toBe(4); // 1 秒 = 2 拍 = 半拍境界 4 回
  });

  test("dt が大きいフレーム（コマ落ち）でも破綻しない（beat は 1 回にまとまる）", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, false, false, 0, "1", noCommit);
    const out = rt.step(120, false, false, 10, "1", noCommit); // 一気に 20 拍
    expect(out.beats).toBeCloseTo(20, 9);
    expect(out.beat).toBe(true);
    // 次フレームは通常進行に戻る。
    const next = rt.step(120, false, false, 10.1, "1", noCommit);
    expect(next.beats).toBeCloseTo(20.2, 9);
  });
});

describe("#270 BeatClockRuntime: タップテンポ", () => {
  test("0.5s 間隔のタップ 4 回で bpm≈120 が commit される", () => {
    const rt = new BeatClockRuntime();
    const commits: number[] = [];
    const commit = (v: number) => commits.push(v);
    // タップは入力エッジ（true/false 交互）で与える。
    for (let i = 0; i < 4; i++) {
      rt.step(100, true, false, i * 0.5, "1", commit);
      rt.step(100, false, false, i * 0.5 + 0.25, "1", commit);
    }
    expect(commits.length).toBe(1); // 4 打目（間隔 3 つ）で初めて推定が立つ
    expect(commits[0]!).toBeCloseTo(120, 6);
  });

  test("タップで phase が拍頭（0）にスナップされる", () => {
    const rt = new BeatClockRuntime();
    rt.step(100, false, false, 0, "1", noCommit);
    rt.step(100, false, false, 0.9, "1", noCommit); // beats=1.5（phase 0.5）
    const out = rt.step(100, true, false, 1.2, "1", noCommit); // tap
    expect(out.phase).toBeCloseTo(0, 9);
    expect(Number.isInteger(out.beats)).toBe(true);
  });

  test("スナップで div が誤発火しない（跨いでいない分周境界を跨いだ扱いにしない）", () => {
    const rt = new BeatClockRuntime();
    // 120BPM: beats(t)=2t。t=0.95 で beats=1.9 → t=1.3 のタップで beats=2.6 → snap 3。
    // スナップで prevBeats も +0.4 され (2.3, 3] となり、div "2" の境界 2.0 は区間外＝誤発火しない
    //（シフトしないと (1.9, 3] が境界 2.0 を含んで誤発火する）。
    rt.step(120, false, false, 0, "2", noCommit);
    rt.step(120, false, false, 0.95, "2", noCommit);
    const out = rt.step(120, true, false, 1.3, "2", noCommit);
    expect(out.beats).toBe(3);
    expect(out.div).toBe(false);
    expect(out.beat).toBe(true); // タップ＝拍頭なので毎拍トリガは発火する
  });

  test("tapNow()（TAP ボタン）は次の step で tap 入力と同経路で処理される", () => {
    const rt = new BeatClockRuntime();
    const commits: number[] = [];
    for (let i = 0; i < 4; i++) {
      rt.tapNow();
      rt.step(100, false, false, i * 0.5, "1", (v) => commits.push(v));
    }
    expect(commits.length).toBe(1);
    expect(commits[0]!).toBeCloseTo(120, 6);
  });

  test("tap 入力が true のまま連続しても 1 回のタップとして扱う（エッジ検出）", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, true, false, 0, "1", noCommit);
    rt.step(120, true, false, 0.1, "1", noCommit); // 押しっぱなし → タップ扱いしない
    const s = rt.status();
    expect(s.tapActive).toBe(true);
    // 2 フレーム目がタップ扱いなら beats がスナップされ phase=0 になるはず。
    // 120BPM で 0.1s → 0.2 拍のまま（スナップされていない）ことを確認する。
    expect(rt.step(120, true, false, 0.2, "1", noCommit).beats).toBeCloseTo(0.4, 9);
  });

  test("タップのやり直し（ギャップ超え）は古い間隔を捨てて推定し直す", () => {
    const rt = new BeatClockRuntime();
    const commits: number[] = [];
    const commit = (v: number) => commits.push(v);
    const tapAt = (t: number) => {
      rt.tapNow();
      rt.step(100, false, false, t, "1", commit);
    };
    tapAt(0); tapAt(0.5); tapAt(1.0); // 間隔 2 つ（推定はまだ）
    // 10 秒空けてやり直し（0.6s 間隔 = 100BPM）。
    tapAt(10); tapAt(10.6); tapAt(11.2); tapAt(11.8);
    expect(commits.length).toBe(1);
    expect(commits[0]!).toBeCloseTo(100, 6);
  });
});

describe("#270 BeatClockRuntime: onset 追従", () => {
  test("onset 連打で bpm が追従するが phase は動かない", () => {
    const rt = new BeatClockRuntime();
    const commits: number[] = [];
    const commit = (v: number) => commits.push(v);
    // 0.5s 間隔の onset エッジを 4 回（間は false フレーム）。bpm param は 100 のまま。
    for (let i = 0; i < 4; i++) {
      rt.step(100, false, true, i * 0.5, "1", commit);
      rt.step(100, false, false, i * 0.5 + 0.25, "1", commit);
    }
    expect(commits.length).toBe(1);
    expect(commits[0]!).toBeCloseTo(120, 6); // 推定 120 が commit される
    // phase はスナップされない: beats は 100BPM で 1.75s 進んだ純粋な累積のまま。
    const out = rt.step(100, false, false, 2.0, "1", noCommit);
    expect(out.beats).toBeCloseTo(2.0 * 100 / 60, 6);
  });

  test("onset 推定は指数平滑（係数 0.2）される", () => {
    const rt = new BeatClockRuntime();
    const commits: number[] = [];
    const commit = (v: number) => commits.push(v);
    const onsetAt = (t: number) => {
      rt.step(120, false, true, t, "1", commit);
      rt.step(120, false, false, t + 0.01, "1", commit);
    };
    // 0.5s 間隔 ×4 → 1 回目の commit は 120（初回は推定値そのまま）。
    onsetAt(0); onsetAt(0.5); onsetAt(1.0); onsetAt(1.5);
    expect(commits.length).toBe(1);
    expect(commits[0]!).toBeCloseTo(120, 6);
    // 以後 0.6s 間隔（100BPM）へ変化。中央値が動き出したら（推定 109.1）、
    // すぐには飛ばず smoothed + 0.2*(est - smoothed) で近づく。
    onsetAt(2.1); onsetAt(2.7); onsetAt(3.3);
    expect(commits.length).toBe(4);
    const last = commits[commits.length - 1]!;
    expect(last).toBeLessThan(120);
    expect(last).toBeGreaterThan(109.1);
  });
});

describe("#270 BeatClockRuntime: status", () => {
  test("bpm/phase/tapActive を返す（タップから gap 秒超で tapActive が落ちる）", () => {
    const rt = new BeatClockRuntime();
    rt.step(120, true, false, 0, "1", noCommit);
    rt.step(120, false, false, 1.0, "1", noCommit);
    let s = rt.status();
    expect(s.bpm).toBe(120);
    expect(s.tapActive).toBe(true);
    expect(s.phase).toBeGreaterThanOrEqual(0);
    expect(s.phase).toBeLessThan(1);
    rt.step(120, false, false, 4.0, "1", noCommit); // 直近タップから 4 秒
    s = rt.status();
    expect(s.tapActive).toBe(false);
  });
});

describe("#270 evaluate 統合", () => {
  test("state 未生成でも安全な既定値を返す", () => {
    const out = BeatClockNode.evaluate(ctxAt(0, undefined));
    expect(out.beat).toBe(false);
    expect(out.div).toBe(false);
    expect(out.beats).toBe(0);
  });

  test("bpm param を読み、beats/beat が出力される", () => {
    const rt = new BeatClockRuntime();
    const node: NodeInstance = { id: "n1", type: "BeatClock", params: { bpm: 60 } };
    BeatClockNode.evaluate(ctxAt(0, rt, {}, node));
    const out = BeatClockNode.evaluate(ctxAt(1, rt, {}, node));
    expect(out.beats as number).toBeCloseTo(1, 9);
    expect(out.beat).toBe(true);
  });

  test("タップ由来の BPM が params.bpm へ 0.1 刻みで書き戻される", () => {
    const rt = new BeatClockRuntime();
    const node: NodeInstance = { id: "n1", type: "BeatClock", params: { bpm: 100 } };
    // 0.512s 間隔（≈117.1875BPM）のタップ 4 回。
    for (let i = 0; i < 4; i++) {
      rt.tapNow();
      BeatClockNode.evaluate(ctxAt(i * 0.512, rt, {}, node));
    }
    expect(node.params.bpm).toBeCloseTo(117.2, 9); // Math.round(117.1875*10)/10
  });

  test("division param が div 出力に効く（evaluate 経由）", () => {
    const rt = new BeatClockRuntime();
    const node: NodeInstance = { id: "n1", type: "BeatClock", params: { bpm: 120, division: "2" } };
    BeatClockNode.evaluate(ctxAt(0, rt, {}, node));
    let divFires = 0;
    for (let i = 1; i <= 40; i++) {
      if (BeatClockNode.evaluate(ctxAt(i * 0.05, rt, {}, node)).div) divFires++;
    }
    expect(divFires).toBe(2); // 2 秒 = 4 拍 → 2 拍境界は 2 回
  });
});
