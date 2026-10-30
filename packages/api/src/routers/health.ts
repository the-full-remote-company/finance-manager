import { z } from "zod";
import { publicProcedure, router } from "../trpc.js";

/**
 * Used by the client to distinguish "offline" from "server unreachable", and
 * by the container health check (Article VII's boot proof polls it).
 *
 * Never cached by the service worker. A cached health.ping would report a live
 * server to an offline client, which is the single worst thing to lie about in
 * a read-only-offline design (ADR 0006).
 */
export const healthRouter = router({
  ping: publicProcedure
    .meta({
      openapi: { method: "GET", path: "/health", tags: ["health"], summary: "Liveness probe" },
    })
    .input(z.void())
    .output(z.object({ ok: z.literal(true), time: z.string() }))
    .query(() => ({ ok: true as const, time: new Date().toISOString() })),
});
