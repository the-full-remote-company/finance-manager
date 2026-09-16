import { authRouter } from "./routers/auth.js";
import { healthRouter } from "./routers/health.js";
import { router } from "./trpc.js";

/**
 * The application router. Routers are added here as their tasks land; the
 * OpenAPI document is generated from exactly this object, so a procedure that
 * is not mounted here does not exist as far as any client is concerned.
 */
export const appRouter = router({
  health: healthRouter,
  auth: authRouter,
});

export type AppRouter = typeof appRouter;
