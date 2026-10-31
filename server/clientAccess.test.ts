import { beforeEach, describe, expect, it, vi } from "vitest";
import type { User } from "../drizzle/schema";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => dbMock);

import {
  canAccessCourse,
  getAccessForUser,
  getAssignedCourseIds,
} from "./clientAccess";

const now = new Date("2026-10-31T00:00:00.000Z");

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
    ).resolves.toMatchObject({ reason: "signed_out", allowed: false });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("autorise un administrateur immédiatement, sans approbation cliente", async () => {
    await expect(
      getAccessForUser(user("admin", " Admin@Example.com "))
    ).resolves.toEqual({
      authenticated: true,
      allowed: true,
      isAdmin: true,
      user: { id: 11, name: "Compte admin", email: "admin@example.com" },
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();
  });

  it("lit le statut courant d’une approbation normalisée et distingue active et révoquée", async () => {
    dbMock.getDb.mockResolvedValue(
      readOnlyDb([{ id: "client-a", status: "active" }])
    );
    await expect(
      getAccessForUser(user("user", " Client@Example.com "))
    ).resolves.toEqual({
      authenticated: true,
      allowed: true,
      isAdmin: false,
      user: { id: 12, name: "Compte user", email: "client@example.com" },
      clientId: "client-a",
    });

    dbMock.getDb.mockResolvedValue(
      readOnlyDb([{ id: "client-a", status: "revoked" }])
    );
    await expect(getAccessForUser(user("user"))).resolves.toMatchObject({
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "revoked",
      clientId: "client-a",
    });
  });

  it("renvoie non approuvé pour une adresse OAuth absente ou sans approbation", async () => {
    await expect(getAccessForUser(user("user", null))).resolves.toMatchObject({
      authenticated: true,
      allowed: false,
      reason: "unapproved",
    });
    expect(dbMock.getDb).not.toHaveBeenCalled();

    dbMock.getDb.mockResolvedValue(readOnlyDb([]));
    await expect(getAccessForUser(user("user"))).resolves.toMatchObject({
      authenticated: true,
      allowed: false,
      reason: "unapproved",
    });
  });
});

describe("course permission checks", () => {
  it("retourne seulement les cours publiés actifs pour un administrateur", async () => {
    dbMock.getDb.mockResolvedValue(
      readOnlyDb([{ id: "nutrition" }, { id: "training" }])
    );

    await expect(getAssignedCourseIds(user("admin"))).resolves.toEqual([
      "nutrition",
      "training",
    ]);
  });

  it("exige une approbation active et une affectation pour les cours clients", async () => {
    dbMock.getDb.mockResolvedValue(readOnlyDb([{ id: "nutrition" }]));
    await expect(getAssignedCourseIds(user("user"))).resolves.toEqual([
      "nutrition",
    ]);

    dbMock.getDb.mockResolvedValue(readOnlyDb([{ id: "nutrition" }]));
    await expect(canAccessCourse(user("user"), " nutrition ")).resolves.toBe(
      true
    );

    dbMock.getDb.mockResolvedValue(readOnlyDb([]));
    await expect(canAccessCourse(user("user"), "nutrition")).resolves.toBe(
      false
    );
  });

  it("permet à l’administrateur un brouillon actif, mais refuse les entrées sans identité ou email", async () => {
    dbMock.getDb.mockResolvedValue(readOnlyDb([{ id: "future-course" }]));
    await expect(canAccessCourse(user("admin"), "future-course")).resolves.toBe(
      true
    );

    await expect(canAccessCourse(null, "future-course")).resolves.toBe(false);
    await expect(
      canAccessCourse(user("user", null), "future-course")
    ).resolves.toBe(false);
    await expect(getAssignedCourseIds(user("user", null))).resolves.toEqual([]);
  });
});
