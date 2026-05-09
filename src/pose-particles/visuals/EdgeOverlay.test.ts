import { describe, expect, test } from "bun:test";
import { EdgeOverlay } from "./EdgeOverlay";
import { makeDefaultSettings } from "../settings";
import { applyTwist } from "./twist";
import { makeEmptyJoints, type AudioFeatures } from "../types";

function makeAudio(): AudioFeatures {
  return { volume: 0, bass: 0, mid: 0, treble: 0, fft: new Float32Array(0) };
}

describe("EdgeOverlay twist", () => {
  test("twist OFF with non-zero phaseSpeed: anchor positions stay constant over time", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0; // outlier wave を消す
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 1.0; // OFFなら無視されるべき
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 1.0);
    const [x1, y1, z1] = overlay.getAnchorPosition(1);
    overlay.update(joints, center, audio, settings, 5.0);
    const [x2, y2, z2] = overlay.getAnchorPosition(1);

    expect(x2).toBeCloseTo(x1, 6);
    expect(y2).toBeCloseTo(y1, 6);
    expect(z2).toBeCloseTo(z1, 6);
  });

  test("twist ON: anchor positions rotate by applyTwist with same params as PointCloud", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    // 1) twist OFF で「素」の位置を取る
    settings.twist.enabled = false;
    settings.twist.phaseSpeed = 0;
    overlay.update(joints, center, audio, settings, 0.5);
    const [bx, by, bz] = overlay.getAnchorPosition(1);

    // 2) twist ON で同じ時刻に update → applyTwist の結果と一致するはず
    settings.twist.enabled = true;
    settings.twist.axis = "y";
    settings.twist.strength = 2.0;
    settings.twist.bassDrive = 0;
    settings.twist.phaseSpeed = 0;
    overlay.update(joints, center, audio, settings, 0.5);
    const [tx, ty, tz] = overlay.getAnchorPosition(1);
    const [ex, ey, ez] = applyTwist(bx, by, bz, "y", 2.0, 0);

    expect(tx).toBeCloseTo(ex, 5);
    expect(ty).toBeCloseTo(ey, 5);
    expect(tz).toBeCloseTo(ez, 5);
    // OFF状態と異なることも確認（テストが空回りしていない保証）
    const moved = Math.abs(tx - bx) + Math.abs(tz - bz);
    expect(moved).toBeGreaterThan(1e-4);
  });

  test("twist ON with phaseSpeed: position evolves over time", () => {
    const overlay = new EdgeOverlay();
    const settings = makeDefaultSettings();
    settings.edges.enabled = true;
    settings.edges.anchorCount = 16;
    settings.edges.kNeighbors = 1;
    settings.mode = "sphere";
    settings.outlier.boost = 1.0;
    settings.twist.enabled = true;
    settings.twist.axis = "y";
    settings.twist.strength = 0; // strength=0 でも phase で回るべき
    settings.twist.bassDrive = 0;
    settings.twist.phaseSpeed = 1.0;
    const joints = makeEmptyJoints();
    const center = new Float32Array([0, 0, 0]);
    const audio = makeAudio();

    overlay.update(joints, center, audio, settings, 0.0);
    const [x0, , z0] = overlay.getAnchorPosition(1);
    overlay.update(joints, center, audio, settings, Math.PI / 2);
    const [x1, , z1] = overlay.getAnchorPosition(1);

    // (x, z) が axis=y で 90deg 回るので、x→-z, z→x になる
    expect(x1).toBeCloseTo(-z0, 5);
    expect(z1).toBeCloseTo(x0, 5);
  });
});
