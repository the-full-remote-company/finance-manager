import { accountsRouter } from "./routers/accounts.js";
import { authRouter } from "./routers/auth.js";
import { categoriesRouter } from "./routers/categories.js";
import { commitmentsRouter } from "./routers/commitments.js";
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
  accounts: accountsRouter,
  categories: categoriesRouter,
  commitments: commitmentsRouter,
});

export type AppRouter = typeof appRouter;
