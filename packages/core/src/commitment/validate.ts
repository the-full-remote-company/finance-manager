/**
 * A commitment's direction and its category's direction must agree — an
 * income commitment inside an expense category would make the dashboard's
 * income total and every category total inconsistent with each other.
 *
 * The database cannot express this as a `CHECK` constraint across two tables
 * without a trigger, and Article VI forbids business rules in triggers, so it
 * is validated here, at the trust boundary, per data-model.md.
 */
export type Direction = "income" | "expense";

export function directionsAgree(
  commitmentDirection: Direction,
  categoryDirection: Direction,
): boolean {
  return commitmentDirection === categoryDirection;
}
