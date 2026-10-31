import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import type { AccessInfo } from "@shared/clientAccess";
import { trpc } from "@/lib/trpc";

type AccessError = {
  message: string;
};

type AccessContextValue = {
  /** Undefined while the current OAuth session is being verified. */
  access: AccessInfo | undefined;
  loading: boolean;
  error: AccessError | null;
  /** Refetches both the OAuth session and its matching access decision. */
  retry: () => void;
};

const AccessContext = createContext<AccessContextValue | null>(null);

function errorMessage(error: unknown): AccessError | null {
  if (!error) return null;
  if (error instanceof Error && error.message)
    return { message: error.message };
  return { message: "Impossible de vérifier ton accès pour le moment." };
}

/**
 * Supplies the server-authoritative client access decision for the current
 * Manus OAuth session. Access is intentionally never persisted in browser
 * storage: approval and revocation must take effect on the next request.
 *
 * The current auth identity is observed independently. When it changes, the
 * `clients.me` query is invalidated and a response belonging to another
 * identity is never exposed to consumers while the fresh decision is pending.
 */
export function AccessProvider({ children }: { children: ReactNode }) {
  const utils = trpc.useUtils();
  const sessionQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
  });
  const accessQuery = trpc.clients.me.useQuery(undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
  });

  const knownIdentityId = sessionQuery.isLoading
    ? undefined
    : (sessionQuery.data?.id ?? null);
  const previousIdentityId = useRef<number | null | undefined>(undefined);

  useEffect(() => {
    if (knownIdentityId === undefined) return;
    if (previousIdentityId.current === knownIdentityId) return;

    previousIdentityId.current = knownIdentityId;
    // This runs for the first resolved session too. It makes a remounted
    // provider refetch instead of trusting a previous account's cache entry.
    // reset removes old data immediately; its active-query refetch obtains the
    // access decision for the just-resolved OAuth identity.
    void utils.clients.me.reset();
  }, [knownIdentityId, utils]);

  const accessBelongsToCurrentSession = useMemo(() => {
    const result = accessQuery.data;
    if (!result) return true;
    if (sessionQuery.isLoading) return false;

    if (!result.authenticated) return !sessionQuery.data;

    // Authenticated AccessInfo responses include the authenticated user under
    // the access contract. Fail closed until an identity-matched response is
    // available, rather than briefly rendering a prior account's permission.
    return Boolean(
      sessionQuery.data &&
        result.user &&
        result.user.id === sessionQuery.data.id
    );
  }, [accessQuery.data, sessionQuery.data, sessionQuery.isLoading]);

  const retry = useCallback(() => {
    void Promise.all([sessionQuery.refetch(), accessQuery.refetch()]);
  }, [accessQuery]);

  const error = errorMessage(accessQuery.error ?? sessionQuery.error);
  const access = accessBelongsToCurrentSession ? accessQuery.data : undefined;
  const loading =
    sessionQuery.isLoading ||
    accessQuery.isLoading ||
    sessionQuery.isFetching ||
    accessQuery.isFetching ||
    (!error && !accessBelongsToCurrentSession);

  const value = useMemo<AccessContextValue>(
    () => ({ access, loading, error, retry }),
    [access, error, loading, retry]
  );

  return (
    <AccessContext.Provider value={value}>{children}</AccessContext.Provider>
  );
}

export function useAccess(): AccessContextValue {
  const value = useContext(AccessContext);
  if (!value) {
    throw new Error(
      "useAccess doit être utilisé à l’intérieur d’AccessProvider."
    );
  }
  return value;
}
