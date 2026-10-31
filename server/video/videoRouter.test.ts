import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const videoDbMock = vi.hoisted(() => {
  class MockVideoJobNotFoundError extends Error {}
  class MockVideoJobConflictError extends Error {}
  class MockVideoJobValidationError extends Error {}
  class MockVideoJobDatabaseUnavailableError extends Error {}
  return {
    VideoJobNotFoundError: MockVideoJobNotFoundError,
    VideoJobConflictError: MockVideoJobConflictError,
    VideoJobValidationError: MockVideoJobValidationError,
    VideoJobDatabaseUnavailableError: MockVideoJobDatabaseUnavailableError,
    abandonVideoPreparation: vi.fn(),
    cancelVideoJob: vi.fn(),
    createPhoneVideoJob: vi.fn(),
    getOwnedVideoJobInfo: vi.fn(),
    getOwnedVideoJobSource: vi.fn(),
    queueVerifiedVideoJob: vi.fn(),
    retryFailedVideoJob: vi.fn(),
  };
});
const storageMock = vi.hoisted(() => ({
  prepareStoredPut: vi.fn(),
  verifyStoredSource: vi.fn(),
}));
const workerMock = vi.hoisted(() => ({ kickVideoWorker: vi.fn() }));

vi.mock("./videoDb", () => videoDbMock);
vi.mock("./mediaStorage", () => storageMock);
vi.mock("./videoWorker", () => workerMock);

import { videoRouter } from "./videoRouter";

const now = new Date();
type TestUser = NonNullable<TrpcContext["user"]>;

function user(role: "user" | "admin"): TestUser {
  return {
    id: role === "admin" ? 71 : 72,
    openId: `video-${role}`,
    email: `${role}@example.com`,
    name: role,
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

beforeEach(() => {
  vi.clearAllMocks();
});

describe("videoRouter authorization and redaction", () => {
  it("uses the real adminProcedure rather than trusting a caller-provided role", async () => {
    const caller = videoRouter.createCaller(context(user("user")));
    await expect(
      caller.prepare({
        lessonId: "lesson1",
        revision: 1,
        filename: "clip.mov",
        contentType: "video/quicktime",
        size: 100,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(videoDbMock.createPhoneVideoJob).not.toHaveBeenCalled();
  });

  it("infers blank iOS MIME, creates an owned job, and returns only the required PUT data", async () => {
    videoDbMock.createPhoneVideoJob.mockResolvedValue({
      jobId: "job1",
      sourceObjectKey: "phone-video/source/random.mov",
      lessonRevision: 8,
    });
    storageMock.prepareStoredPut.mockResolvedValue(
      "https://signed.example/put"
    );

    const result = await videoRouter
      .createCaller(context(user("admin")))
      .prepare({
        lessonId: "lesson1",
        revision: 7,
        filename: "IMG_1234.MOV",
        size: 100,
      });

    expect(videoDbMock.createPhoneVideoJob).toHaveBeenCalledWith(
      71,
      expect.objectContaining({ contentType: "video/quicktime" })
    );
    expect(result).toEqual({
      jobId: "job1",
      uploadUrl: "https://signed.example/put",
      contentType: "video/quicktime",
      lessonRevision: 8,
    });
  });

  it("never returns source metadata from finish even though verification receives it", async () => {
    videoDbMock.getOwnedVideoJobSource.mockResolvedValue({
      status: "uploading",
      sourceObjectKey: "phone-video/source/private.mov",
      sourceSize: 100,
      sourceContentType: "video/quicktime",
    });
    storageMock.verifyStoredSource.mockResolvedValue(undefined);
    videoDbMock.queueVerifiedVideoJob.mockResolvedValue(undefined);
    videoDbMock.getOwnedVideoJobInfo.mockResolvedValue({
      id: "job1",
      lessonId: "lesson1",
      status: "queued",
      progress: 0,
      filename: "private.mov",
    });

    const result = await videoRouter
      .createCaller(context(user("admin")))
      .finish({ id: "job1" });

    expect(storageMock.verifyStoredSource).toHaveBeenCalledWith({
      objectKey: "phone-video/source/private.mov",
      size: 100,
      contentType: "video/quicktime",
    });
    expect(result).not.toHaveProperty("sourceObjectKey");
    expect(JSON.stringify(result)).not.toContain("phone-video/source");
    expect(workerMock.kickVideoWorker).toHaveBeenCalledOnce();
  });
});
