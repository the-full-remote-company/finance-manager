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

export function createContext(request: Request): Context {
  pool ??= createPool();
  return {
    db: createDatabase(pool),
    sessionToken: sessionTokenFrom(request),
    ip: clientIpFrom(request),
  };
}
