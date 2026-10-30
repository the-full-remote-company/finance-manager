import { describe, expect, it } from "vitest";
import { amountInForce } from "../../src/commitment/schedule.js";

describe("amountInForce", () => {
  it("picks the greatest effective month at or before the target", () => {
    const amounts = [{ effectiveMonth: 24312 }, { effectiveMonth: 24318 }];
    expect(amountInForce(amounts, 24315)).toEqual({ effectiveMonth: 24312 });
    expect(amountInForce(amounts, 24320)).toEqual({ effectiveMonth: 24318 });
  });

  it("returns null when every amount is in the future", () => {
    const amounts = [{ effectiveMonth: 24318 }];
    expect(amountInForce(amounts, 24312)).toBeNull();
  });
});
