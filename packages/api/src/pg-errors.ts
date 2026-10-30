/**
 * Postgres's unique-violation SQLSTATE. node-postgres surfaces it as `.code`
 * on the driver error, which Drizzle wraps in its own error carrying the
 * original as `.cause` — so this walks the chain rather than trusting either
 * layer to be the one holding it.
 */
export function isUniqueViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23505") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

/** Postgres's foreign-key-violation SQLSTATE, walked the same way. */
export function isForeignKeyViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth += 1) {
    if ("code" in current && (current as { code?: unknown }).code === "23503") return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
