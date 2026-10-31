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
const codeMock = vi.hoisted(() => {
  class MockClientCodeNotFoundError extends Error {}
  class MockClientCodeConflictError extends Error {}
  class MockClientCodeValidationError extends Error {}
  class MockClientCodeDatabaseUnavailableError extends Error {}
  return {
    ClientCodeNotFoundError: MockClientCodeNotFoundError,
    ClientCodeConflictError: MockClientCodeConflictError,
    ClientCodeValidationError: MockClientCodeValidationError,
    ClientCodeDatabaseUnavailableError: MockClientCodeDatabaseUnavailableError,
    clearClientSessionCookie: vi.fn(),
    disableClientCode: vi.fn(),
    getClientAttemptFingerprint: vi.fn(() => "scope"),
    issueClientCode: vi.fn(),
    loginWithClientCode: vi.fn(),
    logoutClientRequest: vi.fn(),
    setClientSessionCookie: vi.fn(),
  };
});
vi.mock("./clientAccess", () => clientAccessMock);
vi.mock("./clientCodes", () => codeMock);

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

function context(
  currentUser: TestUser | null,
  extras: Pick<TrpcContext, "client" | "hasClientCookie"> = {}
): TrpcContext {
  return {
    user: currentUser,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
    ...extras,
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
  codeMock.issueClientCode.mockResolvedValue({
    id: "client-1",
    revision: 2,
    code: "EJ-ABCD-EFGH-JKLM",
  });
  codeMock.disableClientCode.mockResolvedValue({ id: "client-1", revision: 2 });
  codeMock.loginWithClientCode.mockResolvedValue(null);
  codeMock.logoutClientRequest.mockResolvedValue(undefined);
});

describe("clientRouter permissions", () => {
  it("expose seulement l’état du principal courant sur me", async () => {
    const caller = clientRouter.createCaller(context(null));
    await expect(caller.me()).resolves.toEqual({
      authenticated: false,
      allowed: false,
      isAdmin: false,
      reason: "signed_out",
    });
    expect(clientAccessMock.getAccessForUser).toHaveBeenCalledWith(
      null,
      undefined
    );
  });

  it("refuse les opérations admin à un visiteur, OAuth ordinaire ou mode client", async () => {
    await expect(
      clientRouter.createCaller(context(null)).adminList()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      clientRouter.createCaller(context(user("user"))).approve(validApproval)
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      clientRouter
        .createCaller(context(user("admin"), { hasClientCookie: true }))
        .issueCode({ id: "client-1", revision: 1 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(clientAccessMock.listClients).not.toHaveBeenCalled();
    expect(codeMock.issueClientCode).not.toHaveBeenCalled();
  });
});

describe("clientRouter administration", () => {
  it("accepte explicitement un client personnel sans courriel de contact", async () => {
    await expect(
      clientRouter.createCaller(context(user("admin"))).approve({
        name: "Client sans courriel",
        email: null,
        courseIds: [],
      })
    ).resolves.toEqual({ id: "client-1" });
    expect(clientAccessMock.approveClient).toHaveBeenCalledWith(11, {
      name: "Client sans courriel",
      email: null,
      courseIds: [],
    });
  });

  it("accepte un contact vide comme null et retourne l’identifiant créé", async () => {
    const result = await clientRouter
      .createCaller(context(user("admin")))
      .approve({
        ...validApproval,
        email: "  ",
      });
    expect(result).toEqual({ id: "client-1" });
    expect(clientAccessMock.approveClient).toHaveBeenCalledWith(11, {
      ...validApproval,
      email: null,
    });
  });

  it("valide les sélections et transmet révisions, contact facultatif et mutation de code", async () => {
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
        revision: 3,
        name: "Nouveau nom",
        email: "contact@example.com",
        courseIds: ["nutrition"],
      })
    ).resolves.toEqual({ id: "client-1" });
    await expect(
      caller.setStatus({ id: "client-1", revision: 4, status: "revoked" })
    ).resolves.toEqual({ id: "client-1" });
    await expect(
      caller.issueCode({ id: "client-1", revision: 5 })
    ).resolves.toEqual({
      id: "client-1",
      revision: 2,
      code: "EJ-ABCD-EFGH-JKLM",
    });
    await expect(
      caller.disableCode({ id: "client-1", revision: 6 })
    ).resolves.toEqual({ id: "client-1", revision: 2 });
    expect(clientAccessMock.updateClient).toHaveBeenCalledWith({
      id: "client-1",
      revision: 3,
      name: "Nouveau nom",
      email: "contact@example.com",
      courseIds: ["nutrition"],
    });
    expect(codeMock.issueClientCode).toHaveBeenCalledWith({
      id: "client-1",
      revision: 5,
    });
  });
});

describe("clientRouter code login", () => {
  it("refuse les codes invalides par une erreur générique et pose le cookie uniquement après validation", async () => {
    const ctx = context(null);
    const caller = clientRouter.createCaller(ctx);
    await expect(caller.login({ code: "pas-un-code" })).rejects.toMatchObject({
      code: "UNAUTHORIZED",
      message:
        "Code invalide ou accès indisponible. Vérifie ton code ou réessaie dans quelques minutes.",
    });
    expect(codeMock.setClientSessionCookie).not.toHaveBeenCalled();

    codeMock.loginWithClientCode.mockResolvedValue("opaque-token");
    await expect(caller.login({ code: "EJ-ABCD-EFGH-JKLM" })).resolves.toEqual({
      success: true,
    });
    expect(codeMock.setClientSessionCookie).toHaveBeenCalledWith(
      ctx.req,
      ctx.res,
      "opaque-token"
    );
  });

  it("révoque/efface le mode client avec clients.logout", async () => {
    const ctx = context(null);
    await expect(clientRouter.createCaller(ctx).logout()).resolves.toEqual({
      success: true,
    });
    expect(codeMock.logoutClientRequest).toHaveBeenCalledWith(ctx.req);
    expect(codeMock.clearClientSessionCookie).toHaveBeenCalledWith(
      ctx.req,
      ctx.res
    );
  });
});
