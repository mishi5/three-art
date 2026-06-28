import { expect, test, describe } from "bun:test";
import { outputAudioSourceId, audioOutputOptions } from "./output-audio";

describe("outputAudioSourceId (#198 出力中は出力デバイスへ発音)", () => {
  test("出力非アクティブなら null（分離しない）", () => {
    expect(
      outputAudioSourceId({ outputActive: false, effectiveOutputId: "s2", activeSceneId: "s1" }),
    ).toBeNull();
  });

  test("ピン中（出力 id != アクティブ id）は出力シーン id を返す", () => {
    expect(
      outputAudioSourceId({ outputActive: true, effectiveOutputId: "s2", activeSceneId: "s1" }),
    ).toBe("s2");
  });

  test("出力シーンを編集中（出力 id == アクティブ id）でも出力 id を返す（出力デバイスから発音）", () => {
    expect(
      outputAudioSourceId({ outputActive: true, effectiveOutputId: "s1", activeSceneId: "s1" }),
    ).toBe("s1");
  });

  test("outputActive=false なら分離しない", () => {
    expect(
      outputAudioSourceId({ outputActive: false, effectiveOutputId: "s2", activeSceneId: "s1" }),
    ).toBeNull();
  });
});

describe("audioOutputOptions (#198 デバイス一覧)", () => {
  const dev = (kind: string, deviceId: string, label: string): MediaDeviceInfo =>
    ({ kind, deviceId, label, groupId: "g", toJSON: () => ({}) }) as MediaDeviceInfo;

  test("audiooutput だけを抽出する", () => {
    const opts = audioOutputOptions([
      dev("audioinput", "mic1", "Mic"),
      dev("audiooutput", "spk1", "Speakers"),
      dev("videoinput", "cam1", "Cam"),
    ]);
    expect(opts).toHaveLength(1);
    expect(opts[0]).toEqual({ deviceId: "spk1", label: "Speakers" });
  });

  test("ラベルがあればそのまま使う", () => {
    const opts = audioOutputOptions([dev("audiooutput", "spk1", "外部 I/F")]);
    expect(opts[0]!.label).toBe("外部 I/F");
  });

  test("deviceId=default でラベル空なら『システム既定』", () => {
    const opts = audioOutputOptions([dev("audiooutput", "default", "")]);
    expect(opts[0]).toEqual({ deviceId: "default", label: "システム既定" });
  });

  test("ラベル空（権限なし）は連番フォールバック名を振る", () => {
    const opts = audioOutputOptions([
      dev("audiooutput", "default", ""),
      dev("audiooutput", "id-a", ""),
      dev("audiooutput", "id-b", ""),
    ]);
    expect(opts.map((o) => o.label)).toEqual(["システム既定", "音声出力 1", "音声出力 2"]);
  });

  test("空配列なら空配列", () => {
    expect(audioOutputOptions([])).toEqual([]);
  });
});
