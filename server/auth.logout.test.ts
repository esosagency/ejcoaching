import { describe, expect, it } from "vitest";
import { appRouter } from "./routers";
import { COOKIE_NAME } from "../shared/const";
import { CLIENT_SESSION_COOKIE } from "./clientCodes";
import type { TrpcContext } from "./_core/context";

type CookieCall = { name: string; options: Record<string, unknown> };
type AuthenticatedUser = NonNullable<TrpcContext["user"]>;

function createAuthContext(): {
  ctx: TrpcContext;
  clearedCookies: CookieCall[];
} {
  const clearedCookies: CookieCall[] = [];
  const user: AuthenticatedUser = {
    id: 1,
    openId: "sample-user",
    email: "sample@example.com",
    name: "Sample User",
    loginMethod: "manus",
    role: "user",
    createdAt: new Date(),
    updatedAt: new Date(),
    lastSignedIn: new Date(),
  };
  const ctx: TrpcContext = {
    user,
    req: { protocol: "https", headers: {} } as TrpcContext["req"],
    res: {
      clearCookie: (name: string, options: Record<string, unknown>) =>
        clearedCookies.push({ name, options }),
    } as unknown as TrpcContext["res"],
  };
  return { ctx, clearedCookies };
}

describe("auth.logout", () => {
  it("efface les cookies client et OAuth puis rapporte le succès", async () => {
    const { ctx, clearedCookies } = createAuthContext();
    await expect(appRouter.createCaller(ctx).auth.logout()).resolves.toEqual({
      success: true,
    });
    expect(clearedCookies).toHaveLength(2);
    expect(clearedCookies.map(call => call.name)).toEqual([
      CLIENT_SESSION_COOKIE,
      COOKIE_NAME,
    ]);
    for (const call of clearedCookies) {
      expect(call.options).toMatchObject({
        maxAge: -1,
        secure: true,
        sameSite: "none",
        httpOnly: true,
        path: "/",
      });
    }
  });
});
