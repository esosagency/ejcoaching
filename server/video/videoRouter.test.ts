import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TrpcContext } from "../_core/context";

const videoDbMock = vi.hoisted(() => ({
  VideoJobNotFoundError: class extends Error {},
  VideoJobConflictError: class extends Error {},
  VideoJobValidationError: class extends Error {},
  VideoJobDatabaseUnavailableError: class extends Error {},
  abandonVideoPreparation: vi.fn(),
  cancelVideoJob: vi.fn(),
  createPhoneVideoJob: vi.fn(),
  getOwnedVideoJobInfo: vi.fn(),
  getOwnedVideoJobSource: vi.fn(),
  queueVerifiedVideoJob: vi.fn(),
  retryFailedVideoJob: vi.fn(),
  touchUploadingVideoJob: vi.fn(),
}));
const storageMock = vi.hoisted(() => ({
  preparePrivateMedia: vi.fn(),
  preparePrivatePart: vi.fn(),
  verifyPrivateStoredMedia: vi.fn(),
}));
const workerMock = vi.hoisted(() => ({ kickVideoWorker: vi.fn() }));
vi.mock("./videoDb", () => videoDbMock);
vi.mock("../privateMediaStorage", () => storageMock);
vi.mock("./videoWorker", () => workerMock);
import { videoRouter } from "./videoRouter";
const now = new Date();
function user(role: "user" | "admin"): NonNullable<TrpcContext["user"]> {
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
function context(currentUser: TrpcContext["user"]): TrpcContext {
  return {
    user: currentUser,
    req: { headers: {}, protocol: "https" } as TrpcContext["req"],
    res: {} as TrpcContext["res"],
  };
}
beforeEach(() => vi.clearAllMocks());
describe("encrypted phone router authorization and redaction", () => {
  it("denies non-admin preparation before any storage or job side effect", async () => {
    const caller = videoRouter.createCaller(context(user("user")));
    await expect(
      caller.prepare({
        lessonId: "lesson1",
        revision: 1,
        filename: "clip.mov",
        size: 100,
      })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      caller.preparePart({ id: "job1", index: 0 })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect(videoDbMock.createPhoneVideoJob).not.toHaveBeenCalled();
    expect(storageMock.preparePrivateMedia).not.toHaveBeenCalled();
  });
  it("infers iOS MIME and returns a source-only encryption descriptor to the owner", async () => {
    videoDbMock.createPhoneVideoJob.mockResolvedValue({
      jobId: "job1",
      sourceObjectKey: "test/source.mov",
      lessonRevision: 8,
    });
    const descriptor = {
      id: "fixture-source",
      keyBase64: "fixture-only-key",
      nonceBase64: "fixture-only-nonce",
      plainSize: 100,
      chunkSize: 8388608,
      contentType: "video/quicktime",
    };
    storageMock.preparePrivateMedia.mockResolvedValue(descriptor);
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
    expect(storageMock.preparePrivateMedia).toHaveBeenCalledWith(
      "test/source.mov",
      100,
      "video/quicktime",
      "parts"
    );
    expect(result.jobId).toBe("job1");
    expect(result.encryption).toBe(descriptor);
    expect(result).not.toHaveProperty("sourceObjectKey");
  });
  it("presigns only parts of an owned uploading job", async () => {
    videoDbMock.getOwnedVideoJobSource.mockResolvedValue({
      status: "uploading",
      sourceObjectKey: "test/source.mov",
    });
    videoDbMock.touchUploadingVideoJob.mockResolvedValue(true);
    storageMock.preparePrivatePart.mockResolvedValue(
      "https://fixture.example/put"
    );
    await videoRouter
      .createCaller(context(user("admin")))
      .preparePart({ id: "job1", index: 0 });
    expect(videoDbMock.getOwnedVideoJobSource).toHaveBeenCalledWith("job1", 71);
    expect(storageMock.preparePrivatePart).toHaveBeenCalledWith(
      "test/source.mov",
      0
    );
    videoDbMock.getOwnedVideoJobSource.mockResolvedValue({
      status: "cancelled",
      sourceObjectKey: "test/source.mov",
    });
    await expect(
      videoRouter
        .createCaller(context(user("admin")))
        .preparePart({ id: "job1", index: 0 })
    ).rejects.toMatchObject({ code: "CONFLICT" });
  });
  it("verifies encrypted parts before queueing and returns no keys or source metadata", async () => {
    videoDbMock.getOwnedVideoJobSource.mockResolvedValue({
      status: "uploading",
      sourceObjectKey: "test/source.mov",
      sourceSize: 100,
      sourceContentType: "video/quicktime",
    });
    storageMock.verifyPrivateStoredMedia.mockResolvedValue(undefined);
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
    expect(storageMock.verifyPrivateStoredMedia).toHaveBeenCalledWith(
      "test/source.mov",
      100,
      "video/quicktime"
    );
    expect(result).not.toHaveProperty("sourceObjectKey");
    expect(result).not.toHaveProperty("encryption");
    expect(workerMock.kickVideoWorker).toHaveBeenCalledOnce();
  });
});
