import { expect, test, describe } from "bun:test";
import { kindFromMime } from "./asset-kind";

describe("kindFromMime", () => {
  test("mime prefix で種別を判定", () => {
    expect(kindFromMime("image/png")).toBe("image");
    expect(kindFromMime("video/mp4")).toBe("video");
    expect(kindFromMime("audio/mpeg")).toBe("audio");
  });
  test("対象外/空は null", () => {
    expect(kindFromMime("application/json")).toBeNull();
    expect(kindFromMime("")).toBeNull();
  });
});
