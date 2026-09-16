// Public entry point for @finance/api.
export { appRouter, type AppRouter } from "./router.js";
export { createContext } from "./create-context.js";
export type { AuthenticatedContext, Context } from "./context.js";
export {
  APP_ERROR_TRANSPORT,
  appError,
  notFound,
  toTrpcError,
  type AppError,
  type AppErrorCode,
  type AppErrorDetails,
} from "./errors.js";
export {
  protectedProcedure,
  publicProcedure,
  resolveSession,
  router,
  type ResolvedSession,
} from "./trpc.js";
