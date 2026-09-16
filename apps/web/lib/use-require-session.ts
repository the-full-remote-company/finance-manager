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
        if (!cancelled) router.replace("/sign-in");
      });

    return () => {
      cancelled = true;
    };
  }, [router]);

  return ready;
}
