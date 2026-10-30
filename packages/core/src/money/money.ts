/**
 * Money, per Article II: integer minor units in `bigint`, paired with an
 * explicit ISO 4217 currency code. No floating-point value appears in any
 * signature or intermediate here.
 *
 * `Money` is SIGNED. FR-020 rejects negative *amounts a user enters*, which is
 * `assertChargeAmount` below, applied at the trust boundary. The type itself
 * stays signed because `dashboard.month` returns
 * `remaining = income - combined`, which the contract states may be negative.
 * A non-negative type would make that payload unrepresentable.
 */

export interface Money {
  readonly minor: bigint;
  readonly currency: string;
}

/** ISO 4217 alphabetic codes are exactly three uppercase letters. */
const ISO_4217 = /^[A-Z]{3}$/;

export function money(minor: bigint, currency: string): Money {
  if (typeof minor !== "bigint") {
    // The type forbids it, but the trust boundary receives unvalidated JSON,
    // and a JS number cannot carry minor units safely beyond 2^53.
    throw new TypeError(`money() requires a bigint minor amount, received ${typeof minor}`);
  }
  if (!ISO_4217.test(currency)) {
    throw new TypeError(
      `currency must be an ISO 4217 alphabetic code, received ${JSON.stringify(currency)}`,
    );
  }
  return { minor, currency };
}

function assertSameCurrency(left: Money, right: Money): void {
  if (left.currency !== right.currency) {
    // No implicit conversion. An FX rate table with effective dates exists for
    // that, and using it is a deliberate call, never a side effect of addition.
    throw new TypeError(
      `cannot combine ${left.currency} with ${right.currency}: currency mismatch`,
    );
  }
}

export function addMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { minor: left.minor + right.minor, currency: left.currency };
}

export function subtractMoney(left: Money, right: Money): Money {
  assertSameCurrency(left, right);
  return { minor: left.minor - right.minor, currency: left.currency };
}

/**
 * Sums a list. `currency` is required for the empty case, because a bare zero
 * is not an amount (Article II) and there is nothing to infer it from.
 */
export function sumMoney(amounts: readonly Money[], currency?: string): Money {
  const first = amounts[0];
  if (first === undefined) {
    if (currency === undefined) {
      throw new TypeError(
        "sumMoney([]) requires an explicit currency: a bare zero is not an amount",
      );
    }
    return money(0n, currency);
  }

  let total = first;
  for (let index = 1; index < amounts.length; index += 1) {
    const next = amounts[index];
    if (next !== undefined) total = addMoney(total, next);
  }

  if (currency !== undefined && currency !== total.currency) {
    throw new TypeError(`cannot combine ${total.currency} with ${currency}: currency mismatch`);
  }
  return total;
}

/**
 * FR-020: "System MUST reject negative amounts." Direction is determined by
 * whether the entry is an income or an expense, never by sign.
 *
 * Throws with the wire error code so the boundary can map it without a lookup.
 */
export function assertChargeAmount(amount: Money): void {
  if (amount.minor < 0n) {
    throw new RangeError(
      `NEGATIVE_AMOUNT: a charge cannot be negative, received ${amount.minor.toString()}`,
    );
  }
}
