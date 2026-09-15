/**
 * A month as a single integer, per research B1:
 *
 *     index = year * 12 + (month - 1)
 *
 * Every projection comparison is an integer comparison on this index. Calendar
 * dates are stored day-precise because FR-012's notice deadline is only
 * meaningful as a date, but every projection decision reduces them to a month,
 * which removes every timezone and month-length question from the domain.
 *
 * These indices match the PostgreSQL generated column verified in VQ-1, so the
 * database and the domain agree by construction rather than by convention.
 *
 * `Date` is deliberately unused: `new Date("2026-02-30")` silently becomes
 * 2 March, and `new Date("2026-03-15")` is parsed as UTC while
 * `new Date("2026-03-15T00:00")` is local. Neither belongs in a planner whose
 * unit is the whole month.
 */

export interface YearMonthParts {
  readonly year: number;
  readonly month: number;
}

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;
const DATE_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function yearMonth(year: number, month: number): number {
  if (!Number.isInteger(year)) {
    throw new RangeError(`year must be an integer, received ${String(year)}`);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    throw new RangeError(`month must be an integer between 1 and 12, received ${String(month)}`);
  }
  return year * 12 + (month - 1);
}

export function toYearMonth(index: number): YearMonthParts {
  if (!Number.isInteger(index)) {
    throw new RangeError(`a month index must be an integer, received ${String(index)}`);
  }
  return { year: Math.floor(index / 12), month: (index % 12) + 1 };
}

/** Parses the `YYYY-MM` wire format from contracts/README.md. */
export function parseMonth(value: string): number {
  const match = MONTH_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`a month must be formatted YYYY-MM, received ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new RangeError(
      `a month must be formatted YYYY-MM with a month of 01..12, received ${JSON.stringify(value)}`,
    );
  }
  return yearMonth(year, month);
}

/** Formats a month index back to the `YYYY-MM` wire format. */
export function formatMonth(index: number): string {
  const { year, month } = toYearMonth(index);
  return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31] as const;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2 && isLeapYear(year)) return 29;
  return DAYS_IN_MONTH[month - 1] ?? 0;
}

/**
 * Reduces a day-precise `YYYY-MM-DD` date to its month index.
 *
 * FR-026 / FR-026a: a date anywhere within a month makes that entire month
 * count, at both ends, and no amount is ever prorated by day.
 */
export function monthOfIsoDate(value: string): number {
  const match = DATE_PATTERN.exec(value);
  if (!match) {
    throw new RangeError(`a date must be formatted YYYY-MM-DD, received ${JSON.stringify(value)}`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);

  if (month < 1 || month > 12) {
    throw new RangeError(
      `a date must be formatted YYYY-MM-DD with a month of 01..12, received ${JSON.stringify(value)}`,
    );
  }
  if (day < 1 || day > daysInMonth(year, month)) {
    // Rejected rather than rolled over: 2026-02-30 is not 2 March here.
    throw new RangeError(`${JSON.stringify(value)} is not a real date`);
  }

  return yearMonth(year, month);
}

export function addMonths(index: number, months: number): number {
  if (!Number.isInteger(months)) {
    throw new RangeError(`months must be an integer, received ${String(months)}`);
  }
  return index + months;
}

/** Negative when `left` precedes `right`, positive when it follows, zero when equal. */
export function compareMonths(left: number, right: number): number {
  return left - right;
}
