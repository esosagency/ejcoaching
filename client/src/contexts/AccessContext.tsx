import type { ReactNode } from "react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
} from "react";
import { trpc } from "@/lib/trpc";
import type { AccessInfo } from "@shared/clientAccess";

type AccessError = {
  message: string;
};

type AccessContextValue = {
  /** Undefined while the current effective principal is being verified. */
  access: AccessInfo | undefined;
  loading: boolean;
  error: AccessError | null;
  /** Refetches both the effective principal and its matching access decision. */
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
 * Supplies the server-authoritative access decision for the current effective
 * principal. Client-code sessions and OAuth administrators are deliberately
 * compared by accountKey, never by a fabricated client user id.
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

  const sessionProfile = sessionQuery.data;
  const accessResult = accessQuery.data;
  const knownAccountKey = sessionQuery.isLoading
    ? undefined
    : (sessionProfile?.accountKey ?? null);
  const previousAccountKey = useRef<string | null | undefined>(undefined);

  useEffect(() => {
    if (knownAccountKey === undefined) return;
    if (previousAccountKey.current === knownAccountKey) return;

    previousAccountKey.current = knownAccountKey;
    // Changing principals must never expose a prior account's course decision.
    // A same-account window-focus recheck does not reset this query, preserving
    // active editors and native camera/file pickers behind the refresh mask.
    void utils.clients.me.reset();
  }, [knownAccountKey, utils]);

  const accessBelongsToCurrentSession = useMemo(() => {
    if (!accessResult) return true;
    if (sessionQuery.isLoading) return false;

    if (!accessResult.authenticated) return !sessionProfile;

    return Boolean(
      sessionProfile &&
        accessResult.user &&
        accessResult.user.accountKey === sessionProfile.accountKey
    );
  }, [accessResult, sessionProfile, sessionQuery.isLoading]);

  const retry = useCallback(() => {
    void Promise.all([sessionQuery.refetch(), accessQuery.refetch()]);
  }, [accessQuery, sessionQuery]);

  const error = errorMessage(accessQuery.error ?? sessionQuery.error);
  const access = accessBelongsToCurrentSession ? accessResult : undefined;
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
