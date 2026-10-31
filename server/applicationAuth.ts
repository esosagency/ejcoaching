import { parse as parseCookieHeader } from "cookie";
import type { Request } from "express";
import type { User } from "../drizzle/schema";
import type { CodeClientIdentity } from "../shared/codeAccess";
import {
  CLIENT_SESSION_COOKIE,
  authenticateClientSession,
} from "./clientCodes";
import { sdk } from "./_core/sdk";

export type ApplicationAuthentication = {
  user: User | null;
  client: CodeClientIdentity | null;
  hasClientCookie: boolean;
};

/**
 * Resolves exactly one application principal. A present client cookie always
 * selects client mode, including an invalid/revoked cookie, so Preview OAuth
 * injection can never fall back to administrator permissions.
 */
export async function authenticateApplicationRequest(
  req: Request
): Promise<ApplicationAuthentication> {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const hasClientCookie = Object.prototype.hasOwnProperty.call(
    cookies,
    CLIENT_SESSION_COOKIE
  );

  if (hasClientCookie) {
    const token = cookies[CLIENT_SESSION_COOKIE];
    const client = token ? await authenticateClientSession(token) : null;
    return { user: null, client, hasClientCookie: true };
  }

  try {
    const user = await sdk.authenticateRequest(req);
    return { user, client: null, hasClientCookie: false };
  } catch {
    // Public procedures may be reached without an OAuth session.
    return { user: null, client: null, hasClientCookie: false };
  }
}
