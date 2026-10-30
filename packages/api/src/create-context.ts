import { createDatabase, createPool, type Pool } from "@finance/db";
import type { Context } from "./context.js";

/**
 * Builds the request context from an incoming Fetch Request.
 *
 * One pool per process, created lazily. The pool connects as the non-owner
 * `app` role; every authenticated request additionally runs inside
 * `withWorkspace`, which pins `app.workspace_id` for the transaction.
 */
let pool: Pool | undefined;

function sessionTokenFrom(request: Request): string | null {
  const cookieName = process.env.SESSION_COOKIE_NAME ?? "__Host-session";
  const header = request.headers.get("cookie");
  if (!header) return null;

  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === cookieName) return decodeURIComponent(rest.join("="));
  }
  return null;
}

/**
 * The client address, for throttling only. Hashed before storage and never
 * logged (Article VIII).
 *
 * Read from the proxy header the deployment sets. Trusting `x-forwarded-for`
 * blindly lets a caller spoof it and evade throttling, so only the first hop
 * is used and the deployment is responsible for stripping inbound copies.
 */
function clientIpFrom(request: Request): string | null {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]?.trim() ?? null;
  return request.headers.get("x-real-ip");
}

/**
 * `__Host-` prefixed, per ADR 0003: no `Domain` attribute, `Path=/`, and
 * `Secure` — the prefix itself refuses to be set otherwise. `SameSite=Lax`
 * rather than `Strict`: a cross-site top-level navigation into the app (a
 * bookmark, a link from elsewhere) must still carry the session, or every
 * such entry silently looks signed out.
 */
function serializeSessionCookie(token: string, expiresAt: Date): string {
  const name = process.env.SESSION_COOKIE_NAME ?? "__Host-session";
  const maxAgeSeconds = Math.max(0, Math.floor((expiresAt.getTime() - Date.now()) / 1000));
  return `${name}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${String(maxAgeSeconds)}`;
}

function serializeClearedSessionCookie(): string {
  const name = process.env.SESSION_COOKIE_NAME ?? "__Host-session";
  return `${name}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

export interface CreateContextResult {
  readonly context: Context;
  /**
   * `Set-Cookie` values accumulated while the resolver ran, via
   * `context.setSessionCookie` / `context.clearSessionCookie`. tRPC's fetch
   * adapter has no hook for a resolver to reach into the outgoing `Response`
   * directly, so the transport (`apps/web/app/api/trpc/[trpc]/route.ts`)
   * reads this array after the resolver returns and appends each value as
   * its own `Set-Cookie` header — appended, never merged into one header,
   * because `Set-Cookie` is the one header multiple values must not be
   * comma-joined into.
   */
  readonly cookies: string[];
}

export function createContext(request: Request): CreateContextResult {
  pool ??= createPool();
  const cookies: string[] = [];

  const context: Context = {
    db: createDatabase(pool),
    sessionToken: sessionTokenFrom(request),
    ip: clientIpFrom(request),
    setSessionCookie: (token, expiresAt) => {
      cookies.push(serializeSessionCookie(token, expiresAt));
    },
    clearSessionCookie: () => {
      cookies.push(serializeClearedSessionCookie());
    },
  };

  return { context, cookies };
}
