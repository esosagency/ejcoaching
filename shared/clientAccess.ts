export type AccessReason = "signed_out" | "unapproved" | "revoked";

/**
 * Minimal authorization state for the signed-in identity. This deliberately
 * excludes client-management records, course assignments, and private media
 * metadata.
 */
export type AccessInfo = {
  authenticated: boolean;
  allowed: boolean;
  isAdmin: boolean;
  reason?: AccessReason;
  user?: {
    id: number;
    name: string;
    email: string;
  };
  clientId?: string;
};
