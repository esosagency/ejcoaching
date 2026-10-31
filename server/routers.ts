import { COOKIE_NAME } from "@shared/const";
import type { ViewerProfile } from "../shared/codeAccess";
import { clearClientSessionCookie, logoutClientRequest } from "./clientCodes";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { publicProcedure, router } from "./_core/trpc";
import { clientRouter } from "./clientRouter";
import { contentRouter } from "./contentRouter";
import { videoRouter } from "./video/videoRouter";

function viewerProfile(ctx: {
  user: {
    id: number;
    name: string | null;
    email: string | null;
    role: "user" | "admin";
  } | null;
  client?: { id: string; name: string; email: string | null } | null;
}): ViewerProfile | null {
  if (ctx.client) {
    return {
      accountKey: `client_${ctx.client.id}`,
      name: ctx.client.name,
      email: ctx.client.email,
      role: "user",
      clientId: ctx.client.id,
    };
  }
  if (!ctx.user) return null;
  return {
    id: ctx.user.id,
    accountKey: String(ctx.user.id),
    name: ctx.user.name ?? "",
    email: ctx.user.email,
    role: ctx.user.role,
  };
}

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(({ ctx }) => viewerProfile(ctx)),
    logout: publicProcedure.mutation(async ({ ctx }) => {
      // Clear the browser cookie even if a transient database failure prevents
      // recording revocation; a client cookie never becomes an OAuth fallback.
      try {
        await logoutClientRequest(ctx.req);
      } catch {
        // No sensitive response distinction for a client session token.
      }
      clearClientSessionCookie(ctx.req, ctx.res);
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  content: contentRouter,
  video: videoRouter,
  clients: clientRouter,
});
export type AppRouter = typeof appRouter;
