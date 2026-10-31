import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const clientAccessMock = vi.hoisted(() => {
  class MockClientAccessNotFoundError extends Error {}
  class MockClientAccessConflictError extends Error {}
  class MockClientAccessValidationError extends Error {}
  class MockClientAccessDatabaseUnavailableError extends Error {}

  return {
    ClientAccessNotFoundError: MockClientAccessNotFoundError,
    ClientAccessConflictError: MockClientAccessConflictError,
    ClientAccessValidationError: MockClientAccessValidationError,
    ClientAccessDatabaseUnavailableError:
      MockClientAccessDatabaseUnavailableError,
    getAccessForUser: vi.fn(),
    listClients: vi.fn(),
    approveClient: vi.fn(),
    updateClient: vi.fn(),
    setClientStatus: vi.fn(),
    isValidClientEmail: (value: string) =>
      /^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value),
  };
});
vi.mock("./clientAccess", () => clientAccessMock);

import { clientRouter } from "./clientRouter";

const now = new Date("2026-10-31T00:00:00.000Z");
type TestUser = NonNullable<TrpcContext["user"]>;

function user(role: "user" | "admin"): TestUser {
  return {
    id: role === "admin" ? 11 : 12,
    openId: `oauth-${role}`,
    email: `${role}@example.com`,
    name: `Compte ${role}`,
    loginMethod: "manus",
    role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

function context(currentUser: TestUser | null): TrpcContext {
  return {
    user: currentUser,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}

const validApproval = {
  email: "client@example.com",
  name: "Client exemple",
  courseIds: ["nutrition"],
};

beforeEach(() => {
  vi.clearAllMocks();
  clientAccessMock.getAccessForUser.mockResolvedValue({
    authenticated: false,
    allowed: false,
    isAdmin: false,
    reason: "signed_out",
  });
  clientAccessMock.listClients.mockResolvedValue([]);
  clientAccessMock.approveClient.mockResolvedValue("client-1");
  clientAccessMock.updateClient.mockResolvedValue(undefined);
  clientAccessMock.setClientStatus.mockResolvedValue(undefined);
});

describe("clientRouter permissions", () => {
  it("expose seulement l’état d’accès courant sur la procédure publique me", async () => {
    const caller = clientRouter.createCaller(context(null));
    await expect(caller.me()).resolves.toEqual({
      authenticated: false,
      allowed: false,
      isAdmin: false,
      reason: "signed_out",
    });
    expect(clientAccessMock.getAccessForUser).toHaveBeenCalledWith(null);
  });

  it("refuse les opérations de gestion à un visiteur ou un utilisateur régulier", async () => {
    await expect(
      clientRouter.createCaller(context(null)).adminList()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      clientRouter.createCaller(context(user("user"))).approve(validApproval)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(clientAccessMock.listClients).not.toHaveBeenCalled();
    expect(clientAccessMock.approveClient).not.toHaveBeenCalled();
  });
});

describe("clientRouter administration", () => {
  it("normalise le courriel d’approbation et retourne l’identifiant créé", async () => {
    const result = await clientRouter
      .createCaller(context(user("admin")))
      .approve({
        ...validApproval,
        email: " Client@Example.COM ",
      });

    expect(result).toEqual({ id: "client-1" });
    expect(clientAccessMock.approveClient).toHaveBeenCalledWith(11, {
      ...validApproval,
      email: "client@example.com",
    });
  });

  it("impose les schémas stricts, les sélections explicites non dupliquées et l’email immuable", async () => {
    const caller = clientRouter.createCaller(context(user("admin")));
    await expect(
      caller.approve({
        ...validApproval,
        courseIds: ["nutrition", "nutrition"],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.update({
        id: "client-1",
        revision: 1,
        name: "Nouveau nom",
        courseIds: [],
        email: "forbidden@example.com",
      } as never)
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(clientAccessMock.approveClient).not.toHaveBeenCalled();
    expect(clientAccessMock.updateClient).not.toHaveBeenCalled();
  });

  it("transmet les révisions et traduit un conflit métier", async () => {
    clientAccessMock.updateClient.mockRejectedValue(
      new clientAccessMock.ClientAccessConflictError("conflit")
    );
    const caller = clientRouter.createCaller(context(user("admin")));

    await expect(
      caller.update({
        id: "client-1",
        revision: 3,
        name: "Nouveau nom",
        courseIds: ["nutrition"],
      })
    ).rejects.toMatchObject({ code: "CONFLICT", message: "conflit" });
    await expect(
      caller.setStatus({ id: "client-1", revision: 4, status: "revoked" })
    ).resolves.toEqual({ id: "client-1" });
    expect(clientAccessMock.setClientStatus).toHaveBeenCalledWith({
      id: "client-1",
      revision: 4,
      status: "revoked",
    });
  });
});
