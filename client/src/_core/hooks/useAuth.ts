import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { TRPCClientError } from "@trpc/client";
import { useCallback, useEffect, useMemo } from "react";

type UseAuthOptions = {
  redirectOnUnauthenticated?: boolean;
  redirectPath?: string;
};

export function useAuth(options?: UseAuthOptions) {
  const { redirectOnUnauthenticated = false, redirectPath } = options ?? {};
  const utils = trpc.useUtils();

  const meQuery = trpc.auth.me.useQuery(undefined, {
    retry: false,
    refetchOnMount: false,
    refetchOnWindowFocus: true,
  });
  const oauthLogoutMutation = trpc.auth.logout.useMutation({
    onSuccess: () => {
      utils.auth.me.setData(undefined, null);
    },
  });
  const clientLogoutMutation = trpc.clients.logout.useMutation();
  const user = meQuery.data;
  const isClientSession =
    user?.role === "user" && user.accountKey.startsWith("client_");

  const clearProtectedCaches = useCallback(async () => {
    utils.auth.me.setData(undefined, null);
    await Promise.all([
      utils.clients.me.reset(),
      utils.clients.adminList.reset(),
      utils.content.catalog.reset(),
      utils.content.adminList.reset(),
      utils.content.adminGet.reset(),
      utils.video.get.reset(),
    ]);
    await utils.auth.me.invalidate();
  }, [utils]);

  const logout = useCallback(async () => {
    try {
      if (isClientSession) {
        await clientLogoutMutation.mutateAsync(undefined);
      } else {
        await oauthLogoutMutation.mutateAsync();
      }
    } catch (error: unknown) {
      if (
        error instanceof TRPCClientError &&
        error.data?.code === "UNAUTHORIZED"
      ) {
        return;
      }
      throw error;
    } finally {
      // OAuth preview credentials belong to the administrator session only. A
      // code client signs out through clients.logout and never stores a code.
      if (!isClientSession) {
        try {
          sessionStorage.removeItem("manus-cookie");
          localStorage.removeItem("manus-runtime-user-info");
        } catch {}
      }
      await clearProtectedCaches();
    }
  }, [
    clearProtectedCaches,
    clientLogoutMutation,
    isClientSession,
    oauthLogoutMutation,
  ]);

  useEffect(() => {
    try {
      if (user?.role === "admin") {
        localStorage.setItem("manus-runtime-user-info", JSON.stringify(user));
      } else {
        localStorage.removeItem("manus-runtime-user-info");
      }
    } catch {
      // Storage is optional; the validated server session remains authoritative.
    }
  }, [user]);

  const state = useMemo(
    () => ({
      user,
      loading:
        meQuery.isLoading ||
        oauthLogoutMutation.isPending ||
        clientLogoutMutation.isPending,
      error:
        meQuery.error ??
        oauthLogoutMutation.error ??
        clientLogoutMutation.error ??
        null,
      isAuthenticated: Boolean(user),
    }),
    [
      clientLogoutMutation.error,
      clientLogoutMutation.isPending,
      meQuery.error,
      meQuery.isLoading,
      oauthLogoutMutation.error,
      oauthLogoutMutation.isPending,
      user,
    ]
  );

  useEffect(() => {
    if (!redirectOnUnauthenticated) return;
    if (
      meQuery.isLoading ||
      oauthLogoutMutation.isPending ||
      clientLogoutMutation.isPending
    ) {
      return;
    }
    if (state.user) return;
    if (typeof window === "undefined") return;
    if (redirectPath && window.location.pathname === redirectPath) return;

    if (redirectPath) {
      window.location.href = redirectPath;
    } else {
      startLogin();
    }
  }, [
    clientLogoutMutation.isPending,
    meQuery.isLoading,
    oauthLogoutMutation.isPending,
    redirectOnUnauthenticated,
    redirectPath,
    state.user,
  ]);

  return {
    ...state,
    refresh: () => meQuery.refetch(),
    logout,
  };
}
