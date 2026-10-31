import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";
import type { CodeClientIdentity } from "../shared/codeAccess";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => dbMock);

import {
  canAccessCourse,
  getAccessForUser,
  getAssignedCourseIds,
} from "./clientAccess";

const now = new Date("2026-10-31T00:00:00.000Z");
const codeClient: CodeClientIdentity = {
  id: "client-a",
  name: "Client exemple",
  email: null,
  codeVersion: 3,
};

function user(
  role: "user" | "admin",
  email: string | null = `${role}@example.com`
): User {
  return {
    id: role === "admin" ? 11 : 12,
    openId: `oauth-${role}`,
    email,
    name: `Compte ${role}`,
    loginMethod: "manus",
    role,
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
  };
}

function queryReturning<T>(rows: T[]) {
  const query: Record<string, ReturnType<typeof vi.fn>> = {
    from: vi.fn(),
    where: vi.fn(),
    innerJoin: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.orderBy.mockResolvedValue(rows);
  query.limit.mockResolvedValue(rows);
  return query;
}

function readOnlyDb<T>(rows: T[]) {
  const query = queryReturning(rows);
  return { select: vi.fn(() => query) };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("getAccessForUser", () => {
  it("refuse un visiteur ou une identité de tâche sans consulter la base", async () => {
    await expect(getAccessForUser(null)).resolves.toEqual({
      authenticated: false,
      allowed: false,
      isAdmin: false,
      reason: "signed_out",
    });
    await expect(
      getAccessForUser({ ...user("user"), id: 0 })
    ).resolves.toMatchObject({
      reason: "signed_out",
      allowed: false,
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("autorise un administrateur OAuth réel avec sa clé historique", async () => {
    await expect(
      getAccessForUser(user("admin", " Admin@Example.com "))
    ).resolves.toEqual({
      authenticated: true,
      allowed: true,
      isAdmin: true,
      user: {
        id: 11,
        accountKey: "11",
        name: "Compte admin",
        email: "admin@example.com",
      },
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("ne donne jamais les droits client à un OAuth non-admin par son courriel", async () => {
    await expect(
      getAccessForUser(user("user", "client@example.com"))
    ).resolves.toMatchObject({
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "unapproved",
      user: { accountKey: "12" },
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("revalide le statut et la version du principal code à chaque accès", async () => {
    dbMock.getDb.mockResolvedValue(
      readOnlyDb([
        { ...codeClient, name: "Nom actualisé", email: "contact@example.com" },
      ])
    );
    await expect(getAccessForUser(null, codeClient)).resolves.toEqual({
      authenticated: true,
      allowed: true,
      isAdmin: false,
      user: {
        accountKey: "client_client-a",
        name: "Nom actualisé",
        email: "contact@example.com",
      },
      clientId: "client-a",
    });

    dbMock.getDb.mockResolvedValue(readOnlyDb([]));
    await expect(getAccessForUser(null, codeClient)).resolves.toMatchObject({
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "revoked",
      clientId: "client-a",
    });
  });
});

describe("course permission checks", () => {
  it("retourne les cours publiés actifs pour un administrateur", async () => {
    dbMock.getDb.mockResolvedValue(
      readOnlyDb([{ id: "nutrition" }, { id: "training" }])
    );
    await expect(getAssignedCourseIds(user("admin"))).resolves.toEqual([
      "nutrition",
      "training",
    ]);
  });

  it("exige un principal code actuel et une affectation pour les cours clients", async () => {
    dbMock.getDb.mockResolvedValue(readOnlyDb([{ id: "nutrition" }]));
    await expect(getAssignedCourseIds(null, codeClient)).resolves.toEqual([
      "nutrition",
    ]);

    dbMock.getDb.mockResolvedValue(readOnlyDb([{ id: "nutrition" }]));
    await expect(
      canAccessCourse(null, " nutrition ", codeClient)
    ).resolves.toBe(true);

    dbMock.getDb.mockResolvedValue(readOnlyDb([]));
    await expect(canAccessCourse(null, "nutrition", codeClient)).resolves.toBe(
      false
    );
  });

  it("refuse OAuth non-admin, identité absente et entrée de cours invalide sans requête DB", async () => {
    await expect(getAssignedCourseIds(user("user"))).resolves.toEqual([]);
    await expect(canAccessCourse(null, "future-course")).resolves.toBe(false);
    await expect(canAccessCourse(user("user"), "future-course")).resolves.toBe(
      false
    );
    await expect(getAssignedCourseIds(user("user", null))).resolves.toEqual([]);
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });
});
