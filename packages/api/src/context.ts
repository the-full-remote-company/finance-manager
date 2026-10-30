import type { Database } from "@finance/db";

/**
 * Request context.
 *
 * Deliberately small: the transport hands over a database handle, the raw
 * session token from the cookie, and the caller's IP. Everything else is
 * derived inside middleware, so a resolver cannot accidentally trust something
 * the transport put here.
 */
export interface Context {
  readonly db: Database;
  /** Raw token from the __Host-session cookie. Hashed before any lookup. */
  readonly sessionToken: string | null;
  /** Hashed before storage; never logged (Article VIII). */
  readonly ip: string | null;
  /** Set by the transport so auth procedures can issue and clear the cookie. */
  readonly setSessionCookie?: ((token: string, expiresAt: Date) => void) | undefined;
  readonly clearSessionCookie?: (() => void) | undefined;
}

/** The identity a protected procedure runs as, resolved by middleware. */
export interface AuthenticatedContext extends Context {
  readonly session: {
    readonly sessionId: string;
    readonly userId: string;
    readonly workspaceId: string;
  };
}
