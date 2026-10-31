export type CodeClientIdentity = {
  id: string;
  name: string;
  email: string | null;
  codeVersion: number;
};

/**
 * Identity returned to the application. A code client deliberately has no
 * numeric User id: accountKey is the stable storage/cache namespace.
 */
export type ViewerProfile = {
  id?: number;
  accountKey: string;
  name: string;
  email: string | null;
  role: "admin" | "user";
  clientId?: string;
};
