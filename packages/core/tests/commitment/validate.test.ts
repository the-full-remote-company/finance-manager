import { describe, expect, it } from "vitest";
import { directionsAgree } from "../../src/commitment/validate.js";

/**
 * data-model.md: "A commitment's direction and its category's direction must
 * agree ... The database cannot express this as a CHECK across tables without
 * a trigger, and Article VI forbids business rules in triggers. Consequence:
 * it is validated in packages/core at the trust boundary." (T081)
 */
describe("directionsAgree", () => {
  it("agrees when a commitment's direction matches its category's", () => {
    expect(directionsAgree("income", "income")).toBe(true);
    expect(directionsAgree("expense", "expense")).toBe(true);
  });

  it("disagrees when a commitment's direction is the opposite of its category's", () => {
    expect(directionsAgree("income", "expense")).toBe(false);
    expect(directionsAgree("expense", "income")).toBe(false);
  });
});
