import { expect, test, describe } from "bun:test";
import { randomInRange } from "./random-value";

describe("randomInRange (#150)", () => {
  test("rand=0 で min、rand=1 で max、rand=0.5 で中点", () => {
    expect(randomInRange(0, 1, 0)).toBe(0);
    expect(randomInRange(0, 1, 1)).toBe(1);
    expect(randomInRange(0, 1, 0.5)).toBe(0.5);
    expect(randomInRange(2, 5, 0.5)).toBeCloseTo(3.5);
  });

  test("min>max は入れ替えて扱う", () => {
    expect(randomInRange(5, 2, 0)).toBe(2);
    expect(randomInRange(5, 2, 1)).toBe(5);
  });

  test("min==max は常に同値", () => {
    expect(randomInRange(3, 3, 0.7)).toBe(3);
  });
});
