import type { Express, Request, Response } from "express";
import { and, eq, isNull } from "drizzle-orm";
import { contentLessons, contentUploads } from "../drizzle/schema";
import { authenticateApplicationRequest } from "./applicationAuth";
import { getDb } from "./db";
import { canAccessCourse } from "./clientAccess";
import { getPrivateMedia, readPrivateMediaRange } from "./privateMediaStorage";
import { parsePrivateRange } from "./privateMediaCrypto";
import { courseMediaUrl } from "../shared/privateMedia";
import type { Course } from "../shared/content";

export function protectCourseMedia(course: Course): Course {
  return {
    ...course,
    lessons: course.lessons.map(lesson => ({
      ...lesson,
      ...(lesson.videoUrl?.startsWith("/manus-storage/")
        ? { videoUrl: courseMediaUrl(course.id, lesson.id, "video") }
        : {}),
      ...(lesson.videoPosterUrl?.startsWith("/manus-storage/")
        ? { videoPosterUrl: courseMediaUrl(course.id, lesson.id, "poster") }
        : {}),
      resources: lesson.resources?.map(resource => ({
        ...resource,
        ...(resource.url.startsWith("/manus-storage/")
          ? {
              url: courseMediaUrl(
                course.id,
                lesson.id,
                "resource",
                resource.id
              ),
            }
          : {}),
      })),
    })),
  };
}
async function sendProtected(
  req: Request,
  res: Response,
  key: string,
  expectedType: "video" | "poster" | "document"
) {
  const db = await getDb();
  if (!db) throw new Error("unavailable");
  const [upload] = await db
    .select()
    .from(contentUploads)
    .where(
      and(eq(contentUploads.objectKey, key), eq(contentUploads.status, "ready"))
    )
    .limit(1);
  if (
    !upload ||
    (expectedType === "video" && upload.kind !== "video") ||
    (expectedType === "poster" && upload.kind !== "image") ||
    (expectedType === "document" && upload.kind !== "document")
  )
    throw new Error("unavailable");
  const media = await getPrivateMedia(key);
  if (
    media.status !== "ready" ||
    media.layout !== "single" ||
    media.contentType !== upload.contentType ||
    media.plainSize !== upload.size
  )
    throw new Error("unavailable");
  const range = parsePrivateRange(
    typeof req.headers.range === "string" ? req.headers.range : undefined,
    media.plainSize
  );
  res.set({
    "Cache-Control": "private, no-store",
    Vary: "Cookie, Authorization",
    "X-Content-Type-Options": "nosniff",
    "Cross-Origin-Resource-Policy": "same-origin",
    "Accept-Ranges": "bytes",
  });
  if (!range) {
    res.status(416).set("Content-Range", `bytes */${media.plainSize}`).end();
    return;
  }
  const controller = new AbortController();
  res.once("close", () => controller.abort());
  const headers = () => {
    res
      .status(range.partial ? 206 : 200)
      .set("Content-Type", media.contentType)
      .set("Content-Length", String(range.end - range.start + 1));
    if (range.partial)
      res.set(
        "Content-Range",
        `bytes ${range.start}-${range.end}/${media.plainSize}`
      );
    if (expectedType === "document")
      res.set(
        "Content-Disposition",
        `attachment; filename="document.pdf"; filename*=UTF-8''${encodeURIComponent(upload.filename)}`
      );
  };
  if (req.method === "HEAD") {
    headers();
    res.end();
    return;
  }
  let begun = false;
  for await (const bytes of readPrivateMediaRange(
    media,
    range,
    controller.signal
  )) {
    if (controller.signal.aborted) return;
    if (!begun) {
      headers();
      begun = true;
    }
    if (!res.write(bytes))
      await new Promise<void>(resolve => {
        const done = () => {
          res.off("drain", done);
          res.off("close", done);
          resolve();
        };
        res.once("drain", done);
        res.once("close", done);
      });
  }
  res.end();
}
export function registerCourseMediaRoutes(app: Express) {
  app.get(
    "/api/course-media/:courseId/:lessonId/:kind/:resourceId",
    handleCourseMedia
  );
  app.get("/api/course-media/:courseId/:lessonId/:kind", handleCourseMedia);
  // Owner-only preview of an encrypted upload, including a PDF not yet saved to a lesson.
  app.get("/api/admin/private-file", async (req, res) => {
    try {
      const { user, client, hasClientCookie } =
        await authenticateApplicationRequest(req);
      if (!user || user.role !== "admin" || client || hasClientCookie) {
        res.status(403).json({ error: "Accès administrateur requis." });
        return;
      }
      const key = typeof req.query.key === "string" ? req.query.key : "";
      const db = await getDb();
      if (!db) throw new Error("unavailable");
      const [upload] = await db
        .select()
        .from(contentUploads)
        .where(
          and(
            eq(contentUploads.objectKey, key),
            eq(contentUploads.ownerUserId, user.id),
            eq(contentUploads.status, "ready")
          )
        )
        .limit(1);
      if (!upload) {
        res.status(404).json({ error: "Fichier introuvable." });
        return;
      }
      await sendProtected(
        req,
        res,
        key,
        upload.kind === "document"
          ? "document"
          : upload.kind === "video"
            ? "video"
            : "poster"
      );
    } catch {
      if (!res.headersSent)
        res
          .status(403)
          .json({ error: "Le fichier protégé n’est pas accessible." });
      else res.destroy();
    }
  });
}
async function handleCourseMedia(req: Request, res: Response) {
  res.set("Cache-Control", "private, no-store");
  try {
    const { user, client } = await authenticateApplicationRequest(req);
    const courseId = String(req.params.courseId);
    const lessonId = String(req.params.lessonId);
    const kind = String(req.params.kind);
    if (!(await canAccessCourse(user, courseId, client))) {
      res
        .status(403)
        .json({ error: "Ton accès à ce cours n’est pas autorisé." });
      return;
    }
    const db = await getDb();
    if (!db) throw new Error("unavailable");
    const [lesson] = await db
      .select()
      .from(contentLessons)
      .where(
        and(
          eq(contentLessons.id, lessonId),
          eq(contentLessons.courseId, courseId),
          isNull(contentLessons.archivedAt)
        )
      )
      .limit(1);
    if (!lesson) {
      res.status(404).json({ error: "Leçon introuvable." });
      return;
    }
    let url: string | undefined;
    let type: "video" | "poster" | "document";
    if (kind === "video" && lesson.videoType === "file") {
      url = lesson.videoUrl ?? undefined;
      type = "video";
    } else if (kind === "poster") {
      url = lesson.videoPosterUrl ?? undefined;
      type = "poster";
    } else if (kind === "resource") {
      let resources: unknown = lesson.resources;
      if (typeof resources === "string") resources = JSON.parse(resources);
      const resource = Array.isArray(resources)
        ? resources.find(
            item =>
              item &&
              typeof item === "object" &&
              item.id === req.params.resourceId
          )
        : undefined;
      url = resource?.url;
      type = "document";
    } else {
      res.status(404).json({ error: "Fichier introuvable." });
      return;
    }
    if (!url?.startsWith("/manus-storage/")) {
      res.status(404).json({ error: "Fichier protégé introuvable." });
      return;
    }
    await sendProtected(req, res, url.slice("/manus-storage/".length), type);
  } catch {
    if (!res.headersSent)
      res.status(403).json({
        error: "Entre ton code personnel pour accéder à ce fichier protégé.",
      });
    else res.destroy();
  }
}
