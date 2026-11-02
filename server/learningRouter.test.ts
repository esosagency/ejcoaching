import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const learningDbMock = vi.hoisted(() => {
  class MockLearningConflictError extends Error {}
  class MockLearningPermissionError extends Error {}
  class MockLearningValidationError extends Error {}
  class MockLearningDatabaseUnavailableError extends Error {}
  return {
    LearningConflictError: MockLearningConflictError,
    LearningPermissionError: MockLearningPermissionError,
    LearningValidationError: MockLearningValidationError,
    LearningDatabaseUnavailableError: MockLearningDatabaseUnavailableError,
    snapshot: vi.fn(),
    setCompleted: vi.fn(),
    setSaved: vi.fn(),
    saveNote: vi.fn(),
    visit: vi.fn(),
    importLocal: vi.fn(),
    reset: vi.fn(),
  };
});
vi.mock("./learningDb", () => learningDbMock);

import { learningRouter } from "./learningRouter";

const now = new Date("2026-11-01T17:00:00.000Z");
type TestUser = NonNullable<TrpcContext["user"]>;
const codeClient = {
  id: "client-unit",
  name: "Client unité",
  email: null,
  codeVersion: 4,
};
const snapshot = {
  accountKey: "client_client-unit",
  records: [],
  lastLessonId: null,
};
const record = {
  lessonId: "lesson-1",
  completed: true,
  saved: false,
  note: "",
  noteRevision: 0,
  lastViewedAt: null,
  updatedAt: now.toISOString(),
};

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

beforeEach(() => {
  vi.clearAllMocks();
  learningDbMock.snapshot.mockResolvedValue(snapshot);
  learningDbMock.setCompleted.mockResolvedValue(record);
  learningDbMock.setSaved.mockResolvedValue(record);
  learningDbMock.saveNote.mockResolvedValue(record);
  learningDbMock.visit.mockResolvedValue(record);
  learningDbMock.importLocal.mockResolvedValue(snapshot);
  learningDbMock.reset.mockResolvedValue(snapshot);
});

describe("learningRouter principal and stale-account guards", () => {
  it("refuse un visiteur et un administrateur OAuth qui n’a aucun principal client", async () => {
    await expect(
      learningRouter.createCaller(context(null)).snapshot({
        accountKey: "client_client-unit",
      })
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    await expect(
      learningRouter.createCaller(context(user("admin"))).snapshot({
        accountKey: "client_client-unit",
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(learningDbMock.snapshot).not.toHaveBeenCalled();
  });

  it("refuse une clé de compte d’un ancien compte sans sélectionner son propriétaire", async () => {
    const caller = learningRouter.createCaller(
      context(null, { client: codeClient, hasClientCookie: true })
    );
    await expect(
      caller.snapshot({ accountKey: "client_other-client" })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(learningDbMock.snapshot).not.toHaveBeenCalled();
  });

  it("transmet uniquement le principal de session réel à la couche de données", async () => {
    const caller = learningRouter.createCaller(
      context(null, { client: codeClient, hasClientCookie: true })
    );
    await expect(
      caller.setCompleted({
        accountKey: "client_client-unit",
        lessonId: "lesson-1",
        completed: true,
      })
    ).resolves.toEqual(record);

    expect(learningDbMock.setCompleted).toHaveBeenCalledWith(codeClient, {
      lessonId: "lesson-1",
      completed: true,
    });
  });
});

describe("learningRouter validation and errors", () => {
  it("borne les notes et l’import local avant tout appel de base", async () => {
    const caller = learningRouter.createCaller(
      context(null, { client: codeClient, hasClientCookie: true })
    );
    await expect(
      caller.saveNote({
        accountKey: "client_client-unit",
        lessonId: "lesson-1",
        note: "x".repeat(10_001),
        expectedRevision: 0,
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    await expect(
      caller.importLocal({
        accountKey: "client_client-unit",
        completedIds: Array.from(
          { length: 1_001 },
          (_, index) => `lesson-${index}`
        ),
        savedIds: [],
        notes: [],
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
    expect(learningDbMock.saveNote).not.toHaveBeenCalled();
    expect(learningDbMock.importLocal).not.toHaveBeenCalled();
  });

  it("convertit un conflit de note en erreur tRPC française CONFLICT", async () => {
    learningDbMock.saveNote.mockRejectedValue(
      new learningDbMock.LearningConflictError("Note modifiée ailleurs.")
    );
    const caller = learningRouter.createCaller(
      context(null, { client: codeClient, hasClientCookie: true })
    );

    await expect(
      caller.saveNote({
        accountKey: "client_client-unit",
        lessonId: "lesson-1",
        note: "Mon brouillon doit rester visible.",
        expectedRevision: 3,
      })
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Note modifiée ailleurs.",
    });
  });
});
