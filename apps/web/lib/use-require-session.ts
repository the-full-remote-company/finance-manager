"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { trpc } from "./trpc/browser.js";

/**
 * Every screen under `(app)` requires a session. There is no server-side
 * guard yet (no middleware reads the cookie for these routes), so this is a
 * client-side redirect: render nothing meaningful until `auth.session`
 * answers, then either continue or replace the screen with sign-in.
 *
 * `auth.session` returns `null` rather than throwing for "no session"
 * (contracts/procedures.md), which is exactly the answer this hook needs.
 */
export function useRequireSession(): boolean {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;

    trpc.auth.session
      .query({})
      .then((session) => {
        if (cancelled) return;
        if (session === null) {
          router.replace("/sign-in");
          return;
        }
        setReady(true);
      })
      .catch(() => {
        if (cancelled) return;
        if (typeof navigator !== "undefined" && !navigator.onLine) {
          // Offline support is read-only (ADR 0006): a network failure here
          // means the device cannot reach the server right now, not that the
          // session is gone. Redirecting to sign-in would make every cached
          // dashboard answer (FR-035a) unreachable the moment the device
          // goes offline. The next successful check still catches a session
          // that is genuinely dead.
          setReady(true);
          return;
        }
        router.replace("/sign-in");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return ready;
}
