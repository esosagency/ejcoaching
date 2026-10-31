import { beforeEach, describe, expect, it, vi } from "vitest";

const sdkMock = vi.hoisted(() => ({ authenticateRequest: vi.fn() }));
const codeMock = vi.hoisted(() => ({
  CLIENT_SESSION_COOKIE: "ej_client_session",
  authenticateClientSession: vi.fn(),
}));
vi.mock("./_core/sdk", () => ({ sdk: sdkMock }));
vi.mock("./clientCodes", () => codeMock);

import { authenticateApplicationRequest } from "./applicationAuth";

const oauthUser = {
  id: 7,
  openId: "owner",
  name: "Owner",
  email: "owner@example.com",
  loginMethod: "manus",
  role: "admin" as const,
  createdAt: new Date(),
  updatedAt: new Date(),
  lastSignedIn: new Date(),
};

function request(cookie?: string) {
  return { headers: cookie ? { cookie } : {} } as never;
}

beforeEach(() => vi.clearAllMocks());

describe("authenticateApplicationRequest", () => {
  it("ne consulte jamais le SDK si un cookie client invalide est présent", async () => {
    codeMock.authenticateClientSession.mockResolvedValue(null);
    sdkMock.authenticateRequest.mockResolvedValue(oauthUser);
    await expect(
      authenticateApplicationRequest(
        request("ej_client_session=invalid; webdev_app_session=oauth")
      )
    ).resolves.toEqual({ user: null, client: null, hasClientCookie: true });
    expect(codeMock.authenticateClientSession).toHaveBeenCalledWith("invalid");
    expect(sdkMock.authenticateRequest).not.toHaveBeenCalled();
  });

  it("résout le principal code valide sans fallback OAuth", async () => {
    const client = {
      id: "client-a",
      name: "Client",
      email: null,
      codeVersion: 4,
    };
    codeMock.authenticateClientSession.mockResolvedValue(client);
    await expect(
      authenticateApplicationRequest(request("ej_client_session=opaque"))
    ).resolves.toEqual({
      user: null,
      client,
      hasClientCookie: true,
    });
    expect(sdkMock.authenticateRequest).not.toHaveBeenCalled();
  });

  it("utilise le SDK OAuth existant seulement sans cookie client", async () => {
    sdkMock.authenticateRequest.mockResolvedValue(oauthUser);
    await expect(authenticateApplicationRequest(request())).resolves.toEqual({
      user: oauthUser,
      client: null,
      hasClientCookie: false,
    });
    expect(sdkMock.authenticateRequest).toHaveBeenCalledTimes(1);
  });
});
