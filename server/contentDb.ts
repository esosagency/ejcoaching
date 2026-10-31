import { and, asc, eq, inArray, isNull, max, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  contentCourses,
  contentLessons,
  contentSetup,
  contentUploads,
  contentVideoJobs,
  type ContentCourseRow,
  type ContentLessonRow,
  type ContentUploadRow,
} from "../drizzle/schema";
import type { Course, Lesson, LessonResource } from "../shared/content";
import { isPhoneVideoStatusActive } from "../shared/phoneVideo";
import { getDb } from "./db";
import type {
  ValidCourseInput,
  ValidLessonInput,
  ValidUploadInput,
} from "./contentValidation";
import {
  assertExactLessonPermutation,
  getUploadRule,
  isManagedStorageUrl,
} from "./contentValidation";

export class ContentNotFoundError extends Error {
  constructor() {
    super("Contenu introuvable.");
    this.name = "ContentNotFoundError";
  }
}

export class ContentConflictError extends Error {
  constructor() {
    super(
      "Ce contenu a été modifié par une autre personne. Rechargez la page et réessayez."
    );
    this.name = "ContentConflictError";
  }
}

export class ContentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ContentValidationError";
  }
}

export class ContentDatabaseUnavailableError extends Error {
  constructor() {
    super("La base de données de contenu est indisponible.");
    this.name = "ContentDatabaseUnavailableError";
  }
}

export const CONTENT_SEED_MARKER = "ejcoaching-content-fr-v1";

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ContentQueryExecutor = Pick<Database, "select">;
type UploadRecord = Pick<
  ContentUploadRow,
  "id" | "objectKey" | "filename" | "contentType" | "size" | "kind" | "status"
>;

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new ContentDatabaseUnavailableError();
  return db;
}

function parseJsonArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (typeof value !== "string") return [];
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function normalizeTakeaways(value: unknown): string[] {
  return parseJsonArray(value).filter(
    (item): item is string => typeof item === "string"
  );
}

function normalizeResources(value: unknown): LessonResource[] {
  return parseJsonArray(value).flatMap(item => {
    if (!item || typeof item !== "object") return [];
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      typeof record.title !== "string" ||
      typeof record.url !== "string"
    ) {
      return [];
    }
    return [
      {
        id: record.id,
        title: record.title,
        url: record.url,
        ...(typeof record.filename === "string"
          ? { filename: record.filename }
          : {}),
      },
    ];
  });
}

type LessonSerializationOptions = {
  includeVideoJobId: boolean;
  videoPending: boolean;
};

function toLesson(
  row: ContentLessonRow,
  options: LessonSerializationOptions
): Lesson {
  return {
    id: row.id,
    title: row.title,
    duration: row.duration,
    description: row.description,
    takeaways: normalizeTakeaways(row.takeaways),
    ...(row.videoUrl ? { videoUrl: row.videoUrl } : {}),
    videoType: row.videoType,
    ...(options.includeVideoJobId && row.videoJobId
      ? { videoJobId: row.videoJobId }
      : {}),
    ...(row.videoPosterUrl ? { videoPosterUrl: row.videoPosterUrl } : {}),
    ...(options.videoPending ? { videoPending: true } : {}),
    resources: normalizeResources(row.resources),
    position: row.position,
    revision: row.revision,
  };
}

function toCourse(
  row: ContentCourseRow,
  lessons: ContentLessonRow[],
  options: { includeVideoJobId: boolean; pendingJobIds: Set<string> }
): Course {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    eyebrow: row.eyebrow,
    description: row.description,
    color: row.color,
    ...(row.image ? { image: row.image } : {}),
    icon: row.icon,
    lessons: lessons.map(lesson =>
      toLesson(lesson, {
        includeVideoJobId: options.includeVideoJobId,
        videoPending:
          Boolean(lesson.videoJobId) &&
          options.pendingJobIds.has(lesson.videoJobId!),
      })
    ),
    status: row.status,
    isSample: row.isSample,
    position: row.position,
    revision: row.revision,
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getCoursesWithLessons(options: {
  publishedOnly: boolean;
  courseIds?: string[];
}): Promise<Course[]> {
  const db = await requireDb();
  const courseConditions = [isNull(contentCourses.archivedAt)];
  if (options.courseIds) {
    if (!options.courseIds.length) return [];
    courseConditions.push(inArray(contentCourses.id, options.courseIds));
  }
  if (options.publishedOnly)
    courseConditions.push(eq(contentCourses.status, "published"));

  const courses = await db
    .select()
    .from(contentCourses)
    .where(and(...courseConditions))
    .orderBy(asc(contentCourses.position), asc(contentCourses.id));

  if (courses.length === 0) return [];

  const courseIds = courses.map(course => course.id);
  const lessons = await db
    .select()
    .from(contentLessons)
    .where(
      and(
        inArray(contentLessons.courseId, courseIds),
        isNull(contentLessons.archivedAt)
      )
    )
    .orderBy(
      asc(contentLessons.courseId),
      asc(contentLessons.position),
      asc(contentLessons.id)
    );

  const lessonsByCourse = new Map<string, ContentLessonRow[]>();
  for (const lesson of lessons) {
    const current = lessonsByCourse.get(lesson.courseId) ?? [];
    current.push(lesson);
    lessonsByCourse.set(lesson.courseId, current);
  }

  const videoJobIds = lessons
    .map(lesson => lesson.videoJobId)
    .filter((id): id is string => Boolean(id));
  const jobs =
    videoJobIds.length === 0
      ? []
      : await db
          .select({ id: contentVideoJobs.id, status: contentVideoJobs.status })
          .from(contentVideoJobs)
          .where(inArray(contentVideoJobs.id, videoJobIds));
  const pendingJobIds = new Set(
    jobs.filter(job => isPhoneVideoStatusActive(job.status)).map(job => job.id)
  );

  return courses.map(course =>
    toCourse(course, lessonsByCourse.get(course.id) ?? [], {
      includeVideoJobId: !options.publishedOnly,
      pendingJobIds,
    })
  );
}

/** Public catalogue: only non-archived published courses and non-archived lessons. */
export function listPublicCourses(): Promise<Course[]> {
  return getCoursesWithLessons({ publishedOnly: true });
}

/** Member catalog IDs have already been checked against live approval/assignments. */
export function listAccessibleCourses(courseIds: string[]): Promise<Course[]> {
  return getCoursesWithLessons({ publishedOnly: true, courseIds });
}

/** Admin list: non-archived drafts and published courses with non-archived lessons. */
export function listAdminCourses(): Promise<Course[]> {
  return getCoursesWithLessons({ publishedOnly: false });
}

/**
 * Read-only readiness signal for a parent-owned health endpoint. It deliberately
 * does not seed, migrate, or mutate the database.
 */
export async function contentReadiness(): Promise<{
  database: boolean;
  seeded: boolean;
}> {
  try {
    const db = await getDb();
    if (!db) return { database: false, seeded: false };
    const [marker] = await db
      .select({ marker: contentSetup.marker })
      .from(contentSetup)
      .where(eq(contentSetup.marker, CONTENT_SEED_MARKER))
      .limit(1);
    return { database: true, seeded: Boolean(marker) };
  } catch {
    return { database: false, seeded: false };
  }
}

export async function getAdminCourse(id: string): Promise<Course> {
  const db = await requireDb();
  const [course] = await db
    .select()
    .from(contentCourses)
    .where(and(eq(contentCourses.id, id), isNull(contentCourses.archivedAt)))
    .limit(1);
  if (!course) throw new ContentNotFoundError();

  const lessons = await db
    .select()
    .from(contentLessons)
    .where(
      and(eq(contentLessons.courseId, id), isNull(contentLessons.archivedAt))
    )
    .orderBy(asc(contentLessons.position), asc(contentLessons.id));

  const videoJobIds = lessons
    .map(lesson => lesson.videoJobId)
    .filter((jobId): jobId is string => Boolean(jobId));
  const jobs =
    videoJobIds.length === 0
      ? []
      : await db
          .select({ id: contentVideoJobs.id, status: contentVideoJobs.status })
          .from(contentVideoJobs)
          .where(inArray(contentVideoJobs.id, videoJobIds));
  return toCourse(course, lessons, {
    includeVideoJobId: true,
    pendingJobIds: new Set(
      jobs
        .filter(job => isPhoneVideoStatusActive(job.status))
        .map(job => job.id)
    ),
  });
}

function nextPosition(value: unknown): number {
  const maxPosition = Number(value ?? -1);
  return Number.isSafeInteger(maxPosition) && maxPosition >= 0
    ? maxPosition + 1
    : 0;
}

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object")
    return 0;
  const value = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" ? value : 0;
}

async function assertManagedLessonVideoIsPlayable(
  db: ContentQueryExecutor,
  data: ValidLessonInput
): Promise<void> {
  if (
    data.videoType !== "file" ||
    !data.videoUrl ||
    !isManagedStorageUrl(data.videoUrl)
  ) {
    return;
  }

  const objectKey = data.videoUrl.slice("/manus-storage/".length);
  const [output] = await db
    .select({ id: contentUploads.id })
    .from(contentUploads)
    .innerJoin(
      contentVideoJobs,
      eq(contentVideoJobs.outputVideoUploadId, contentUploads.id)
    )
    .where(
      and(
        eq(contentUploads.objectKey, objectKey),
        eq(contentUploads.kind, "video"),
        eq(contentUploads.status, "ready"),
        eq(contentVideoJobs.status, "ready")
      )
    )
    .limit(1);
  if (!output) {
    throw new ContentValidationError(
      "Cette vidéo interne n’est pas une vidéo convertie prête à la lecture."
    );
  }
}

async function assertActiveCourse(
  db: ContentQueryExecutor,
  id: string
): Promise<void> {
  const [course] = await db
    .select({ id: contentCourses.id })
    .from(contentCourses)
    .where(and(eq(contentCourses.id, id), isNull(contentCourses.archivedAt)))
    .limit(1);
  if (!course) throw new ContentNotFoundError();
}

async function assertCourseRevisionState(
  db: ContentQueryExecutor,
  id: string
): Promise<void> {
  await assertActiveCourse(db, id);
  throw new ContentConflictError();
}

async function assertLessonRevisionState(
  db: ContentQueryExecutor,
  courseId: string,
  id: string
): Promise<void> {
  const [lesson] = await db
    .select({ id: contentLessons.id })
    .from(contentLessons)
    .where(
      and(
        eq(contentLessons.courseId, courseId),
        eq(contentLessons.id, id),
        isNull(contentLessons.archivedAt)
      )
    )
    .limit(1);
  if (!lesson) throw new ContentNotFoundError();
  throw new ContentConflictError();
}

export async function createCourse(data: ValidCourseInput): Promise<string> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [positionRow] = await tx
      .select({ maxPosition: max(contentCourses.position) })
      .from(contentCourses);
    const id = nanoid(21);
    const now = new Date();
    await tx.insert(contentCourses).values({
      id,
      title: data.title,
      category: data.category,
      eyebrow: data.eyebrow,
      description: data.description,
      color: data.color,
      image: data.image ?? null,
      icon: data.icon,
      status: data.status,
      isSample: data.isSample,
      position: nextPosition(positionRow?.maxPosition),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

export async function updateCourse(
  id: string,
  revision: number,
  data: ValidCourseInput
): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  await db.transaction(async tx => {
    const result = await tx
      .update(contentCourses)
      .set({
        title: data.title,
        category: data.category,
        eyebrow: data.eyebrow,
        description: data.description,
        color: data.color,
        image: data.image ?? null,
        icon: data.icon,
        status: data.status,
        isSample: data.isSample,
        revision: sql`${contentCourses.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentCourses.id, id),
          eq(contentCourses.revision, revision),
          isNull(contentCourses.archivedAt)
        )
      );

    if (affectedRows(result) === 0) await assertCourseRevisionState(tx, id);
  });
}

export async function archiveCourse(
  id: string,
  revision: number
): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  await db.transaction(async tx => {
    const result = await tx
      .update(contentCourses)
      .set({
        archivedAt: now,
        revision: sql`${contentCourses.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentCourses.id, id),
          eq(contentCourses.revision, revision),
          isNull(contentCourses.archivedAt)
        )
      );

    if (affectedRows(result) === 0) {
      await assertCourseRevisionState(tx, id);
      return;
    }
    await tx
      .update(contentVideoJobs)
      .set({
        status: "cancelled",
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          inArray(contentVideoJobs.status, [
            "uploading",
            "queued",
            "processing",
            "failed",
          ]),
          sql`exists (
        select 1 from ${contentLessons}
        where ${contentLessons.id} = ${contentVideoJobs.lessonId}
          and ${contentLessons.courseId} = ${id}
      )`
        )
      );
    await tx
      .update(contentLessons)
      .set({
        videoJobId: null,
        revision: sql`${contentLessons.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentLessons.courseId, id),
          sql`${contentLessons.videoJobId} is not null`
        )
      );
  });
}

export async function createLesson(
  courseId: string,
  data: ValidLessonInput
): Promise<string> {
  const db = await requireDb();
  return db.transaction(async tx => {
    await assertActiveCourse(tx, courseId);
    await assertManagedLessonVideoIsPlayable(tx, data);
    const [positionRow] = await tx
      .select({ maxPosition: max(contentLessons.position) })
      .from(contentLessons)
      .where(
        and(
          eq(contentLessons.courseId, courseId),
          isNull(contentLessons.archivedAt)
        )
      );
    const id = nanoid(21);
    const now = new Date();
    await tx.insert(contentLessons).values({
      id,
      courseId,
      title: data.title,
      duration: data.duration,
      description: data.description,
      takeaways: data.takeaways,
      videoUrl: data.videoUrl ?? null,
      videoType: data.videoType,
      resources: data.resources,
      position: nextPosition(positionRow?.maxPosition),
      revision: 1,
      createdAt: now,
      updatedAt: now,
    });
    return id;
  });
}

export async function updateLesson(
  courseId: string,
  id: string,
  revision: number,
  data: ValidLessonInput
): Promise<void> {
  const db = await requireDb();
  await db.transaction(async tx => {
    const [existing] = await tx
      .select({
        videoUrl: contentLessons.videoUrl,
        videoType: contentLessons.videoType,
        videoJobId: contentLessons.videoJobId,
        videoPosterUrl: contentLessons.videoPosterUrl,
      })
      .from(contentLessons)
      .where(
        and(
          eq(contentLessons.courseId, courseId),
          eq(contentLessons.id, id),
          eq(contentLessons.revision, revision),
          isNull(contentLessons.archivedAt)
        )
      )
      .limit(1);
    if (!existing) {
      await assertLessonRevisionState(tx, courseId, id);
      return;
    }

    await assertManagedLessonVideoIsPlayable(tx, data);
    const requestedVideoUrl = data.videoUrl ?? null;
    const mediaChanged =
      existing.videoType !== data.videoType ||
      existing.videoUrl !== requestedVideoUrl;
    const detachedJobId = mediaChanged ? existing.videoJobId : null;
    const now = new Date();
    const result = await tx
      .update(contentLessons)
      .set({
        title: data.title,
        duration: data.duration,
        description: data.description,
        takeaways: data.takeaways,
        videoUrl: requestedVideoUrl,
        videoType: data.videoType,
        // An explicit media replacement must fence the prior asynchronous job.
        videoJobId: detachedJobId ? null : existing.videoJobId,
        videoPosterUrl: mediaChanged ? null : existing.videoPosterUrl,
        resources: data.resources,
        revision: sql`${contentLessons.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentLessons.courseId, courseId),
          eq(contentLessons.id, id),
          eq(contentLessons.revision, revision),
          isNull(contentLessons.archivedAt)
        )
      );

    if (affectedRows(result) === 0) {
      await assertLessonRevisionState(tx, courseId, id);
      return;
    }

    if (detachedJobId) {
      await tx
        .update(contentVideoJobs)
        .set({
          status: "cancelled",
          leaseToken: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: null,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentVideoJobs.id, detachedJobId),
            inArray(contentVideoJobs.status, [
              "uploading",
              "queued",
              "processing",
            ])
          )
        );
    }
  });
}

export async function archiveLesson(
  courseId: string,
  id: string,
  revision: number
): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  await db.transaction(async tx => {
    const result = await tx
      .update(contentLessons)
      .set({
        archivedAt: now,
        videoJobId: null,
        revision: sql`${contentLessons.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentLessons.courseId, courseId),
          eq(contentLessons.id, id),
          eq(contentLessons.revision, revision),
          isNull(contentLessons.archivedAt)
        )
      );

    if (affectedRows(result) === 0) {
      await assertLessonRevisionState(tx, courseId, id);
      return;
    }
    await tx
      .update(contentVideoJobs)
      .set({
        status: "cancelled",
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentVideoJobs.lessonId, id),
          inArray(contentVideoJobs.status, [
            "uploading",
            "queued",
            "processing",
            "failed",
          ])
        )
      );
  });
}

export async function reorderLessons(
  courseId: string,
  ids: string[]
): Promise<void> {
  const db = await requireDb();
  await db.transaction(async tx => {
    await assertActiveCourse(tx, courseId);
    const lessons = await tx
      .select({ id: contentLessons.id })
      .from(contentLessons)
      .where(
        and(
          eq(contentLessons.courseId, courseId),
          isNull(contentLessons.archivedAt)
        )
      )
      .orderBy(asc(contentLessons.position), asc(contentLessons.id));

    try {
      assertExactLessonPermutation(
        lessons.map(lesson => lesson.id),
        ids
      );
    } catch (error) {
      throw new ContentValidationError(
        error instanceof Error
          ? error.message
          : "L’ordre des leçons est invalide."
      );
    }

    const now = new Date();
    for (const [position, id] of ids.entries()) {
      await tx
        .update(contentLessons)
        .set({
          position,
          revision: sql`${contentLessons.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentLessons.id, id),
            eq(contentLessons.courseId, courseId),
            isNull(contentLessons.archivedAt)
          )
        );
    }
  });
}

function randomObjectKey(contentType: string): string {
  const rule = getUploadRule(contentType);
  if (!rule)
    throw new ContentValidationError("Ce type de fichier n’est pas autorisé.");
  return `content/${nanoid(32)}.${rule.extension}`;
}

export async function createPendingUpload(
  ownerUserId: number,
  input: ValidUploadInput
): Promise<UploadRecord> {
  if (input.kind === "video") {
    throw new ContentValidationError(
      "Les vidéos doivent passer par le traitement vidéo sécurisé."
    );
  }
  const db = await requireDb();
  const id = nanoid(21);
  const objectKey = randomObjectKey(input.contentType);
  await db.insert(contentUploads).values({
    id,
    ownerUserId,
    objectKey,
    filename: input.filename,
    contentType: input.contentType,
    size: input.size,
    kind: input.kind,
    status: "pending",
  });
  return { ...input, id, objectKey, status: "pending" };
}

export async function getOwnedUpload(
  id: string,
  ownerUserId: number
): Promise<UploadRecord> {
  const db = await requireDb();
  const [upload] = await db
    .select({
      id: contentUploads.id,
      objectKey: contentUploads.objectKey,
      filename: contentUploads.filename,
      contentType: contentUploads.contentType,
      size: contentUploads.size,
      kind: contentUploads.kind,
      status: contentUploads.status,
    })
    .from(contentUploads)
    .where(
      and(
        eq(contentUploads.id, id),
        eq(contentUploads.ownerUserId, ownerUserId)
      )
    )
    .limit(1);
  if (!upload) throw new ContentNotFoundError();
  return upload;
}

export async function markUploadReady(
  id: string,
  ownerUserId: number
): Promise<boolean> {
  const db = await requireDb();
  const result = await db
    .update(contentUploads)
    .set({ status: "ready", readyAt: new Date() })
    .where(
      and(
        eq(contentUploads.id, id),
        eq(contentUploads.ownerUserId, ownerUserId),
        eq(contentUploads.status, "pending"),
        inArray(contentUploads.kind, ["image", "document"])
      )
    );
  return affectedRows(result) === 1;
}
