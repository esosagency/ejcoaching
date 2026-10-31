export type AccessReason = "signed_out" | "unapproved" | "revoked";

/**
 * Minimal authorization state for the effective application principal. It
 * deliberately excludes client-management records, course assignments, code
 * secrets, sessions, and private-media metadata.
 */
export type AccessInfo = {
  authenticated: boolean;
  allowed: boolean;
  isAdmin: boolean;
  reason?: AccessReason;
  user?: {
    id?: number;
    accountKey: string;
    name: string;
    email: string | null;
  };
  clientId?: string;
};
