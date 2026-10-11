import { describe, expect, it } from "vitest";
import { niceLinearValues, niceLogValues, niceStep } from "./nice";

describe("nice values", () => {
  it("linear steps are 1/2/2.5/5 x 10^n", () => {
    expect(niceStep(100, 10)).toBe(10);
    expect(niceStep(37, 10)).toBe(5);
    expect(niceLinearValues(-12, 47, 6)).toEqual([-10, 0, 10, 20, 30, 40]);
  });

  it("log values adapt density to the number of decades", () => {
    expect(niceLogValues(0.1, 100)).toEqual([0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100]);
    expect(niceLogValues(1e-3, 1e3)).toEqual([0.001, 0.01, 0.1, 1, 10, 100, 1000]);
    expect(niceLogValues(1, 3)).toEqual([1, 1.2, 1.5, 2, 2.5, 3]);
    expect(niceLogValues(1e-6, 1e6).length).toBeLessThanOrEqual(13);
  });

  it("handles degenerate ranges", () => {
    expect(niceLogValues(-1, 10)).toEqual([]);
    expect(niceLinearValues(5, 5)).toEqual([]);
  });
});
