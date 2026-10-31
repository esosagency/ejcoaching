import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "./_core/context";

const contentDbMock = vi.hoisted(() => {
  class MockContentNotFoundError extends Error {}
  class MockContentConflictError extends Error {}
  class MockContentValidationError extends Error {}
  class MockContentDatabaseUnavailableError extends Error {}

  return {
    ContentNotFoundError: MockContentNotFoundError,
    ContentConflictError: MockContentConflictError,
    ContentValidationError: MockContentValidationError,
    ContentDatabaseUnavailableError: MockContentDatabaseUnavailableError,
    listAccessibleCourses: vi.fn(),
    listAdminCourses: vi.fn(),
    getAdminCourse: vi.fn(),
    createCourse: vi.fn(),
    updateCourse: vi.fn(),
    archiveCourse: vi.fn(),
    createLesson: vi.fn(),
    updateLesson: vi.fn(),
    archiveLesson: vi.fn(),
    reorderLessons: vi.fn(),
    createPendingUpload: vi.fn(),
    getOwnedUpload: vi.fn(),
    markUploadReady: vi.fn(),
  };
});

vi.mock("./contentDb", () => contentDbMock);
const accessMock = vi.hoisted(() => ({
  getAccessForUser: vi.fn(),
  getAssignedCourseIds: vi.fn(),
}));
vi.mock("./clientAccess", () => accessMock);
vi.mock("./privateMediaStorage", () => ({
  preparePrivateMedia: vi.fn(),
  verifyPrivateStoredMedia: vi.fn(),
}));

import { contentRouter } from "./contentRouter";
import {
  assertExactLessonPermutation,
  courseInputSchema,
  isRecognizedVideoEmbed,
  isSafeContentUrl,
  lessonInputSchema,
  uploadInputSchema,
} from "./contentValidation";

const now = new Date();
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

const validCourse = {
  title: "Cours de test",
  category: "Nutrition",
  eyebrow: "APPRENDRE",
  description: "Une description de cours suffisante.",
  color: "#a997ff",
  icon: "nutrition" as const,
  status: "draft" as const,
  isSample: false,
};

const validLesson = {
  title: "Leçon de test",
  duration: "06:24",
  description: "Une description de leçon suffisante.",
  takeaways: ["Un point clé."],
  videoType: "demo" as const,
  resources: [],
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("contentRouter access control", () => {
  it("refuse les lectures administrateur à un visiteur non connecté", async () => {
    const caller = contentRouter.createCaller(context(null));
    await expect(caller.adminList()).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(contentDbMock.listAdminCourses).not.toHaveBeenCalled();
  });

  it("refuse les mutations à un utilisateur régulier", async () => {
    const caller = contentRouter.createCaller(context(user("user")));
    await expect(caller.createCourse(validCourse)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    expect(contentDbMock.createCourse).not.toHaveBeenCalled();
  });
});

describe("contentRouter catalogue et révisions", () => {
  it("retourne seulement le catalogue attribué au compte approuvé", async () => {
    const publishedCourse = {
      ...validCourse,
      id: "nutrition",
      status: "published" as const,
      isSample: true,
      lessons: [],
      position: 0,
      revision: 1,
      updatedAt: now.toISOString(),
    };
    contentDbMock.listAccessibleCourses.mockResolvedValue([publishedCourse]);
    accessMock.getAccessForUser.mockResolvedValue({ allowed: true });
    accessMock.getAssignedCourseIds.mockResolvedValue(["nutrition"]);

    const result = await contentRouter
      .createCaller(context(user("user")))
      .catalog({ accountId: 12 });

    expect(result).toEqual([publishedCourse]);
    expect(contentDbMock.listAccessibleCourses).toHaveBeenCalledWith([
      "nutrition",
    ]);
    expect(contentDbMock.listAdminCourses).not.toHaveBeenCalled();
  });

  it("refuse le catalogue anonyme, révoqué et associé à une autre identité", async () => {
    await expect(
      contentRouter.createCaller(context(null)).catalog()
    ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    accessMock.getAccessForUser.mockResolvedValue({
      allowed: false,
      reason: "revoked",
    });
    await expect(
      contentRouter.createCaller(context(user("user"))).catalog()
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      contentRouter
        .createCaller(context(user("user")))
        .catalog({ accountId: 11 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(contentDbMock.listAccessibleCourses).not.toHaveBeenCalled();
  });

  it("retourne CONFLICT lorsqu’une mise à jour utilise une révision dépassée", async () => {
    contentDbMock.updateCourse.mockRejectedValue(
      new contentDbMock.ContentConflictError("conflit")
    );
    const caller = contentRouter.createCaller(context(user("admin")));

    await expect(
      caller.updateCourse({ id: "nutrition", revision: 1, data: validCourse })
    ).rejects.toMatchObject({
      code: "CONFLICT",
    });
  });
});

describe("validation du contenu", () => {
  it("n’accepte que les URL sûres et les formes d’intégration reconnues", () => {
    expect(isSafeContentUrl("/manus-storage/content/abc123.mp4")).toBe(true);
    expect(isSafeContentUrl("https://cdn.example.org/media/video.mp4")).toBe(
      true
    );
    expect(isSafeContentUrl("javascript:alert(1)")).toBe(false);
    expect(isSafeContentUrl("https://user:secret@example.org/file.mp4")).toBe(
      false
    );
    expect(isSafeContentUrl("https://127.0.0.1/file.mp4")).toBe(false);
    expect(
      isRecognizedVideoEmbed("https://www.youtube.com/embed/dQw4w9WgXcQ")
    ).toBe(true);
    expect(
      isRecognizedVideoEmbed("https://example.org/embed/dQw4w9WgXcQ")
    ).toBe(false);
  });

  it("rejette une image de cours dangereuse, une intégration inconnue et un fichier trop volumineux", () => {
    expect(
      courseInputSchema.safeParse({
        ...validCourse,
        image: "javascript:alert(1)",
      }).success
    ).toBe(false);
    expect(
      lessonInputSchema.safeParse({
        ...validLesson,
        videoType: "embed",
        videoUrl: "https://example.org/not-a-video",
      }).success
    ).toBe(false);
    expect(
      uploadInputSchema.safeParse({
        filename: "video.mp4",
        contentType: "video/mp4",
        kind: "video",
        size: 250 * 1024 * 1024 + 1,
      }).success
    ).toBe(false);
  });

  it("rejette les permutations de leçons avec doublons, manquants ou étrangers", () => {
    expect(() =>
      assertExactLessonPermutation(["a", "b", "c"], ["a", "b", "b"])
    ).toThrow(/exactement une fois/);
    expect(() =>
      assertExactLessonPermutation(["a", "b"], ["a", "outside"])
    ).toThrow(/n’appartient pas/);
    expect(() =>
      assertExactLessonPermutation(["a", "b"], ["b", "a"])
    ).not.toThrow();
  });
});
