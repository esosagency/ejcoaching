import type { CreateExpressContextOptions } from "@trpc/server/adapters/express";
import type { User } from "../../drizzle/schema";
import type { CodeClientIdentity } from "../../shared/codeAccess";
import { authenticateApplicationRequest } from "../applicationAuth";

export type TrpcContext = {
  req: CreateExpressContextOptions["req"];
  res: CreateExpressContextOptions["res"];
  user: User | null;
  /** Optional so existing isolated caller fixtures remain source-compatible. */
  client?: CodeClientIdentity | null;
  hasClientCookie?: boolean;
};

export async function createContext(
  opts: CreateExpressContextOptions
): Promise<TrpcContext> {
  const authentication = await authenticateApplicationRequest(opts.req);
  return {
    req: opts.req,
    res: opts.res,
    user: authentication.user,
    client: authentication.client,
    hasClientCookie: authentication.hasClientCookie,
  };
}
