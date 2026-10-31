import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Express, Request, Response } from "express";

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn(),
  authorize: vi.fn(),
  getDb: vi.fn(),
  getPrivateMedia: vi.fn(),
  readPrivateMediaRange: vi.fn(),
}));
vi.mock("./applicationAuth", () => ({
  authenticateApplicationRequest: mocks.authenticate,
}));
vi.mock("./clientAccess", () => ({ canAccessCourse: mocks.authorize }));
vi.mock("./db", () => ({ getDb: mocks.getDb }));
vi.mock("./privateMediaStorage", () => ({
  getPrivateMedia: mocks.getPrivateMedia,
  readPrivateMediaRange: mocks.readPrivateMediaRange,
}));
import { registerCourseMediaRoutes } from "./courseMedia";

type Handler = (req: Request, res: Response) => Promise<void>;
function routes() {
  const handlers = new Map<string, Handler>();
  registerCourseMediaRoutes({
    get: (path: string, handler: Handler) => handlers.set(path, handler),
  } as unknown as Express);
  return handlers;
}
function response() {
  const res: Record<string, any> = { headersSent: false };
  for (const method of ["status", "set", "json", "end", "once", "destroy"])
    res[method] = vi.fn(() => res);
  return res as unknown as Response;
}
function request() {
  return {
    method: "HEAD",
    headers: {},
    params: { courseId: "nutrition", lessonId: "lesson-unit", kind: "video" },
    query: {},
  } as unknown as Request;
}
beforeEach(() => vi.resetAllMocks());

describe("médias privés et code personnel", () => {
  it("refuse le téléchargement admin si un cookie client actif ou invalide sélectionne ce mode", async () => {
    const handler = routes().get("/api/admin/private-file")!;
    for (const client of [null, { id: "client-unit", codeVersion: 1 }]) {
      mocks.authenticate.mockResolvedValue({
        user: { id: 1, role: "admin" },
        client,
        hasClientCookie: true,
      });
      const res = response();
      await handler(request(), res);
      expect(res.status).toHaveBeenCalledWith(403);
    }
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("applique le client courant à la permission du cours avant toute lecture de média", async () => {
    const client = {
      id: "client-unit",
      name: "Unité",
      email: null,
      codeVersion: 1,
    };
    mocks.authenticate.mockResolvedValue({
      user: null,
      client,
      hasClientCookie: true,
    });
    mocks.authorize.mockResolvedValue(false);
    const handler = routes().get(
      "/api/course-media/:courseId/:lessonId/:kind"
    )!;
    const res = response();
    await handler(request(), res);
    expect(mocks.authorize).toHaveBeenCalledWith(null, "nutrition", client);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(mocks.getDb).not.toHaveBeenCalled();
  });

  it("sert un HEAD autorisé sans clés dans les en-têtes et empêche l’intégration tierce", async () => {
    const client = {
      id: "client-unit",
      name: "Unité",
      email: null,
      codeVersion: 1,
    };
    mocks.authenticate.mockResolvedValue({
      user: null,
      client,
      hasClientCookie: true,
    });
    mocks.authorize.mockResolvedValue(true);
    const limit = vi
      .fn()
      .mockResolvedValueOnce([
        {
          id: "lesson-unit",
          courseId: "nutrition",
          videoType: "file",
          videoUrl: "/manus-storage/unit/video.mp4",
        },
      ])
      .mockResolvedValueOnce([
        {
          objectKey: "unit/video.mp4",
          status: "ready",
          kind: "video",
          size: 100,
          contentType: "video/mp4",
        },
      ]);
    const db = {
      select: vi.fn(() => ({ from: () => ({ where: () => ({ limit }) }) })),
    };
    mocks.getDb.mockResolvedValue(db);
    mocks.getPrivateMedia.mockResolvedValue({
      status: "ready",
      layout: "single",
      contentType: "video/mp4",
      plainSize: 100,
    });
    const res = response();
    await routes().get("/api/course-media/:courseId/:lessonId/:kind")!(
      request(),
      res
    );
    expect(res.status).toHaveBeenCalledWith(200);
    expect(res.set).toHaveBeenCalledWith(
      expect.objectContaining({
        "Cross-Origin-Resource-Policy": "same-origin",
        "Cache-Control": "private, no-store",
      })
    );
    expect(mocks.readPrivateMediaRange).not.toHaveBeenCalled();
    expect(res.json).not.toHaveBeenCalled();
  });
});
