import { and, asc, eq, inArray, isNull, lt, or, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  contentCourses,
  contentLessons,
  contentUploads,
  contentVideoJobs,
  type ContentVideoJobRow,
} from "../../drizzle/schema";
import {
  MAX_PHONE_VIDEO_BYTES,
  type VideoJobInfo,
  type VideoJobStatus,
  isPhoneVideoStatusActive,
} from "../../shared/phoneVideo";
import { getDb } from "../db";

export const VIDEO_PIPELINE_VERSION = 1;
export const MAX_VIDEO_JOB_ATTEMPTS = 3;
export const VIDEO_LEASE_MS = 45_000;

const ACTIVE_JOB_STATUSES = ["uploading", "queued", "processing"] as const;
const SOURCE_KEY_PREFIX = "phone-video/source";
const OUTPUT_KEY_PREFIX = "phone-video/output";

export class VideoJobNotFoundError extends Error {
  constructor() {
    super("Traitement vidéo introuvable.");
    this.name = "VideoJobNotFoundError";
  }
}

export class VideoJobConflictError extends Error {
  constructor(
    message = "Cette vidéo ou cette leçon a été modifiée. Rechargez la page et réessayez."
  ) {
    super(message);
    this.name = "VideoJobConflictError";
  }
}

export class VideoJobValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "VideoJobValidationError";
  }
}

export class VideoJobDatabaseUnavailableError extends Error {
  constructor() {
    super("La base de données vidéo est indisponible.");
    this.name = "VideoJobDatabaseUnavailableError";
  }
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type Transaction = Parameters<Parameters<Database["transaction"]>[0]>[0];
type QueryExecutor = Pick<Database, "select">;

export type VideoJobSource = {
  jobId: string;
  ownerUserId: number;
  lessonId: string;
  status: VideoJobStatus;
  filename: string;
  sourceUploadId: string;
  sourceObjectKey: string;
  sourceContentType: string;
  sourceSize: number;
};

export type ClaimedVideoJob = VideoJobSource & {
  leaseToken: string;
  attempts: number;
};

export type PreparedVideoUpload = {
  jobId: string;
  sourceObjectKey: string;
  lessonRevision: number;
};

export type VideoOutputArtifacts = {
  video: { key: string; size: number };
  poster: { key: string; size: number };
  durationSeconds: number;
};

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") {
    return 0;
  }
  const value = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" ? value : 0;
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new VideoJobDatabaseUnavailableError();
  return db;
}

function stableStorageUrl(objectKey: string): string {
  return `/manus-storage/${objectKey}`;
}

function sourceExtension(contentType: string): string {
  switch (contentType) {
    case "video/quicktime":
      return "mov";
    case "video/webm":
      return "webm";
    case "video/3gpp":
      return "3gp";
    case "video/3gpp2":
      return "3g2";
    case "video/mp4":
    default:
      return "mp4";
  }
}

function randomSourceObjectKey(contentType: string): string {
  return `${SOURCE_KEY_PREFIX}/${nanoid(32)}.${sourceExtension(contentType)}`;
}

export function newVideoOutputObjectKeys(jobId: string): {
  videoKey: string;
  posterKey: string;
} {
  // Job ids originate on the server, but avoid reflecting even those into paths.
  const random = nanoid(32);
  return {
    videoKey: `${OUTPUT_KEY_PREFIX}/${jobId}/${random}.mp4`,
    posterKey: `${OUTPUT_KEY_PREFIX}/${jobId}/${random}.jpg`,
  };
}

export function formatVideoDuration(durationSeconds: number): string {
  const rounded = Math.max(1, Math.round(durationSeconds));
  const minutes = Math.floor(rounded / 60);
  const seconds = rounded % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function clampProgress(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(99, Math.floor(value)));
}

function isSafeGeneratedObjectKey(
  key: string,
  extension: "mp4" | "jpg"
): boolean {
  return new RegExp(
    `^${OUTPUT_KEY_PREFIX.replace(/[/-]/g, "\\$&")}/[A-Za-z0-9_-]{1,64}/[A-Za-z0-9_-]{16,64}\\.${extension}$`
  ).test(key);
}

function activeLessonForJobSql() {
  return sql`exists (
    select 1
    from ${contentLessons}
    inner join ${contentCourses}
      on ${contentCourses.id} = ${contentLessons.courseId}
    where ${contentLessons.id} = ${contentVideoJobs.lessonId}
      and ${contentLessons.videoJobId} = ${contentVideoJobs.id}
      and ${contentLessons.archivedAt} is null
      and ${contentCourses.archivedAt} is null
  )`;
}

function courseStillActiveForLessonSql() {
  return sql`exists (
    select 1 from ${contentCourses}
    where ${contentCourses.id} = ${contentLessons.courseId}
      and ${contentCourses.archivedAt} is null
  )`;
}

function jobInfoFromRow(
  row: Pick<
    ContentVideoJobRow,
    | "id"
    | "lessonId"
    | "status"
    | "progress"
    | "filename"
    | "error"
    | "durationSeconds"
  >,
  output?: { videoUrl?: string; posterUrl?: string }
): VideoJobInfo {
  const info: VideoJobInfo = {
    id: row.id,
    lessonId: row.lessonId,
    status: row.status,
    progress: Math.max(0, Math.min(100, row.progress)),
    filename: row.filename,
  };

  if (row.status === "failed" && row.error) info.error = row.error;
  if (row.status === "ready") {
    if (output?.videoUrl) info.videoUrl = output.videoUrl;
    if (output?.posterUrl) info.posterUrl = output.posterUrl;
    if (typeof row.durationSeconds === "number") {
      info.durationSeconds = row.durationSeconds;
    }
  }
  return info;
}

/** Exported pure DTO mapper; it never receives source upload metadata. */
export function toVideoJobInfo(
  row: Pick<
    ContentVideoJobRow,
    | "id"
    | "lessonId"
    | "status"
    | "progress"
    | "filename"
    | "error"
    | "durationSeconds"
  >,
  output?: { videoUrl?: string; posterUrl?: string }
): VideoJobInfo {
  return jobInfoFromRow(row, output);
}

async function getOutputUrls(
  db: QueryExecutor,
  row: Pick<
    ContentVideoJobRow,
    "status" | "ownerUserId" | "outputVideoUploadId" | "posterUploadId"
  >
): Promise<{ videoUrl?: string; posterUrl?: string }> {
  if (row.status !== "ready") return {};
  const ids = [row.outputVideoUploadId, row.posterUploadId].filter(
    (value): value is string => Boolean(value)
  );
  if (ids.length === 0) return {};

  const uploads = await db
    .select({
      id: contentUploads.id,
      objectKey: contentUploads.objectKey,
      status: contentUploads.status,
      kind: contentUploads.kind,
      ownerUserId: contentUploads.ownerUserId,
    })
    .from(contentUploads)
    .where(inArray(contentUploads.id, ids));

  const byId = new Map(uploads.map(upload => [upload.id, upload]));
  const video = row.outputVideoUploadId
    ? byId.get(row.outputVideoUploadId)
    : undefined;
  const poster = row.posterUploadId ? byId.get(row.posterUploadId) : undefined;

  return {
    ...(video &&
    video.ownerUserId === row.ownerUserId &&
    video.status === "ready" &&
    video.kind === "video"
      ? { videoUrl: stableStorageUrl(video.objectKey) }
      : {}),
    ...(poster &&
    poster.ownerUserId === row.ownerUserId &&
    poster.status === "ready" &&
    poster.kind === "image"
      ? { posterUrl: stableStorageUrl(poster.objectKey) }
      : {}),
  };
}

async function selectOwnedJob(
  db: QueryExecutor,
  id: string,
  ownerUserId: number
): Promise<ContentVideoJobRow> {
  const [job] = await db
    .select()
    .from(contentVideoJobs)
    .where(
      and(
        eq(contentVideoJobs.id, id),
        eq(contentVideoJobs.ownerUserId, ownerUserId)
      )
    )
    .limit(1);
  if (!job) throw new VideoJobNotFoundError();
  return job;
}

async function videoJobInfo(
  db: QueryExecutor,
  row: ContentVideoJobRow
): Promise<VideoJobInfo> {
  return toVideoJobInfo(row, await getOutputUrls(db, row));
}

export async function getOwnedVideoJobInfo(
  id: string,
  ownerUserId: number
): Promise<VideoJobInfo> {
  const db = await requireDb();
  return videoJobInfo(db, await selectOwnedJob(db, id, ownerUserId));
}

/** Internal-only source lookup. Do not serialize this value through tRPC. */
export async function getOwnedVideoJobSource(
  id: string,
  ownerUserId: number
): Promise<VideoJobSource> {
  const db = await requireDb();
  const [job] = await db
    .select({
      jobId: contentVideoJobs.id,
      ownerUserId: contentVideoJobs.ownerUserId,
      lessonId: contentVideoJobs.lessonId,
      status: contentVideoJobs.status,
      filename: contentVideoJobs.filename,
      sourceUploadId: contentVideoJobs.sourceUploadId,
      sourceObjectKey: contentUploads.objectKey,
      sourceContentType: contentUploads.contentType,
      sourceSize: contentUploads.size,
    })
    .from(contentVideoJobs)
    .innerJoin(
      contentUploads,
      eq(contentUploads.id, contentVideoJobs.sourceUploadId)
    )
    .where(
      and(
        eq(contentVideoJobs.id, id),
        eq(contentVideoJobs.ownerUserId, ownerUserId)
      )
    )
    .limit(1);
  if (!job) throw new VideoJobNotFoundError();
  return job;
}

export async function createPhoneVideoJob(
  ownerUserId: number,
  input: {
    lessonId: string;
    revision: number;
    filename: string;
    contentType: string;
    size: number;
  }
): Promise<PreparedVideoUpload> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [lesson] = await tx
      .select({
        id: contentLessons.id,
        revision: contentLessons.revision,
        videoJobId: contentLessons.videoJobId,
      })
      .from(contentLessons)
      .innerJoin(contentCourses, eq(contentCourses.id, contentLessons.courseId))
      .where(
        and(
          eq(contentLessons.id, input.lessonId),
          isNull(contentLessons.archivedAt),
          isNull(contentCourses.archivedAt)
        )
      )
      .limit(1);

    if (!lesson) throw new VideoJobNotFoundError();
    if (lesson.revision !== input.revision) throw new VideoJobConflictError();

    if (lesson.videoJobId) {
      const [current] = await tx
        .select({ status: contentVideoJobs.status })
        .from(contentVideoJobs)
        .where(eq(contentVideoJobs.id, lesson.videoJobId))
        .limit(1);
      if (current && isPhoneVideoStatusActive(current.status)) {
        throw new VideoJobConflictError(
          "Une autre vidéo est déjà en cours de téléversement ou de conversion pour cette leçon."
        );
      }
    }

    const jobId = nanoid(21);
    const sourceUploadId = nanoid(21);
    const sourceObjectKey = randomSourceObjectKey(input.contentType);
    const now = new Date();

    await tx.insert(contentUploads).values({
      id: sourceUploadId,
      ownerUserId,
      objectKey: sourceObjectKey,
      filename: input.filename,
      contentType: input.contentType,
      size: input.size,
      kind: "video",
      status: "pending",
      createdAt: now,
    });
    await tx.insert(contentVideoJobs).values({
      id: jobId,
      lessonId: input.lessonId,
      ownerUserId,
      sourceUploadId,
      status: "uploading",
      progress: 0,
      filename: input.filename,
      pipelineVersion: VIDEO_PIPELINE_VERSION,
      attempts: 0,
      createdAt: now,
      updatedAt: now,
    });

    const result = await tx
      .update(contentLessons)
      .set({
        videoJobId: jobId,
        revision: sql`${contentLessons.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentLessons.id, input.lessonId),
          eq(contentLessons.revision, input.revision),
          isNull(contentLessons.archivedAt),
          courseStillActiveForLessonSql()
        )
      );
    if (affectedRows(result) !== 1) throw new VideoJobConflictError();

    return {
      jobId,
      sourceObjectKey,
      lessonRevision: input.revision + 1,
    };
  });
}

/** Used only if generating a presigned PUT failed before the client received a job id. */
export async function abandonVideoPreparation(
  id: string,
  ownerUserId: number
): Promise<void> {
  const db = await requireDb();
  await db.transaction(async tx => {
    const [job] = await tx
      .select({ lessonId: contentVideoJobs.lessonId })
      .from(contentVideoJobs)
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.ownerUserId, ownerUserId),
          eq(contentVideoJobs.status, "uploading")
        )
      )
      .limit(1);
    if (!job) return;

    const now = new Date();
    await tx
      .update(contentVideoJobs)
      .set({
        status: "failed",
        error: "La préparation du téléversement a échoué.",
        finishedAt: now,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.ownerUserId, ownerUserId),
          eq(contentVideoJobs.status, "uploading")
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
          eq(contentLessons.id, job.lessonId),
          eq(contentLessons.videoJobId, id),
          isNull(contentLessons.archivedAt)
        )
      );
  });
}

/** Atomically marks the HEAD-verified original as source media and queues conversion. */
export async function queueVerifiedVideoJob(
  id: string,
  ownerUserId: number
): Promise<VideoJobInfo> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const job = await selectOwnedJob(tx, id, ownerUserId);
    if (job.status !== "uploading") return videoJobInfo(tx, job);

    const [source] = await tx
      .select({ status: contentUploads.status })
      .from(contentUploads)
      .where(
        and(
          eq(contentUploads.id, job.sourceUploadId),
          eq(contentUploads.ownerUserId, ownerUserId),
          eq(contentUploads.kind, "video")
        )
      )
      .limit(1);
    if (
      !source ||
      (source.status !== "pending" && source.status !== "source")
    ) {
      throw new VideoJobConflictError(
        "Le fichier source n’est plus disponible pour la conversion."
      );
    }

    const now = new Date();
    const queued = await tx
      .update(contentVideoJobs)
      .set({ status: "queued", progress: 0, error: null, updatedAt: now })
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.ownerUserId, ownerUserId),
          eq(contentVideoJobs.status, "uploading")
        )
      );
    if (affectedRows(queued) !== 1) {
      return videoJobInfo(tx, await selectOwnedJob(tx, id, ownerUserId));
    }

    await tx
      .update(contentUploads)
      .set({ status: "source", readyAt: now })
      .where(
        and(
          eq(contentUploads.id, job.sourceUploadId),
          eq(contentUploads.ownerUserId, ownerUserId),
          eq(contentUploads.status, "pending")
        )
      );

    return videoJobInfo(tx, await selectOwnedJob(tx, id, ownerUserId));
  });
}

export async function retryFailedVideoJob(
  id: string,
  ownerUserId: number
): Promise<VideoJobInfo> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const job = await selectOwnedJob(tx, id, ownerUserId);
    if (job.status !== "failed") {
      throw new VideoJobConflictError(
        "Seule une conversion échouée peut être relancée."
      );
    }
    const [source] = await tx
      .select({ status: contentUploads.status })
      .from(contentUploads)
      .where(
        and(
          eq(contentUploads.id, job.sourceUploadId),
          eq(contentUploads.ownerUserId, ownerUserId)
        )
      )
      .limit(1);
    if (!source || source.status !== "source") {
      throw new VideoJobConflictError(
        "Le fichier source vérifié n’est plus disponible."
      );
    }

    const result = await tx
      .update(contentVideoJobs)
      .set({
        status: "queued",
        progress: 0,
        // A deliberate administrator action starts a new, still-bounded window.
        attempts: 0,
        error: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        finishedAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.ownerUserId, ownerUserId),
          eq(contentVideoJobs.status, "failed"),
          activeLessonForJobSql()
        )
      );
    if (affectedRows(result) !== 1) {
      throw new VideoJobConflictError(
        "Cette vidéo n’est plus la vidéo active de la leçon."
      );
    }
    return videoJobInfo(tx, await selectOwnedJob(tx, id, ownerUserId));
  });
}

export async function cancelVideoJob(
  id: string,
  ownerUserId: number
): Promise<VideoJobInfo> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const job = await selectOwnedJob(tx, id, ownerUserId);
    if (!isPhoneVideoStatusActive(job.status) && job.status !== "failed") {
      throw new VideoJobConflictError(
        "Seule une vidéo non terminée ou échouée peut être annulée."
      );
    }

    const now = new Date();
    const result = await tx
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
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.ownerUserId, ownerUserId),
          eq(contentVideoJobs.status, job.status)
        )
      );
    if (affectedRows(result) !== 1) {
      throw new VideoJobConflictError();
    }

    // Only clear a pointer still owned by this job; a replacement job is untouched.
    await tx
      .update(contentLessons)
      .set({
        videoJobId: null,
        revision: sql`${contentLessons.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentLessons.id, job.lessonId),
          eq(contentLessons.videoJobId, id),
          isNull(contentLessons.archivedAt)
        )
      );

    return videoJobInfo(tx, await selectOwnedJob(tx, id, ownerUserId));
  });
}

/** Moves exhausted leases to failure; jobs below the bound are reclaimable. */
export async function recoverExpiredVideoJobs(): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  await db
    .update(contentVideoJobs)
    .set({
      status: "cancelled",
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(and(
      inArray(contentVideoJobs.status, ACTIVE_JOB_STATUSES),
      sql`not (${activeLessonForJobSql()})`
    ));
  await db
    .update(contentVideoJobs)
    .set({
      status: "failed",
      error:
        "Le traitement a été interrompu trop souvent. Vous pouvez choisir un nouveau fichier.",
      leaseToken: null,
      leaseExpiresAt: null,
      lastHeartbeatAt: null,
      finishedAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(contentVideoJobs.status, "processing"),
        lt(contentVideoJobs.leaseExpiresAt, now),
        sql`${contentVideoJobs.attempts} >= ${MAX_VIDEO_JOB_ATTEMPTS}`
      )
    );
}

export async function claimNextVideoJob(
  workerId: string
): Promise<ClaimedVideoJob | null> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + VIDEO_LEASE_MS);
    const claimable = or(
      eq(contentVideoJobs.status, "queued"),
      and(
        eq(contentVideoJobs.status, "processing"),
        lt(contentVideoJobs.leaseExpiresAt, now)
      )
    );
    const [candidate] = await tx
      .select({ id: contentVideoJobs.id })
      .from(contentVideoJobs)
      .innerJoin(
        contentUploads,
        eq(contentUploads.id, contentVideoJobs.sourceUploadId)
      )
      .where(
        and(
          claimable,
          eq(contentUploads.status, "source"),
          eq(contentVideoJobs.pipelineVersion, VIDEO_PIPELINE_VERSION),
          activeLessonForJobSql(),
          lt(contentVideoJobs.attempts, MAX_VIDEO_JOB_ATTEMPTS)
        )
      )
      .orderBy(asc(contentVideoJobs.createdAt), asc(contentVideoJobs.id))
      .limit(1);
    if (!candidate) return null;

    const leaseToken = nanoid(32);
    const claimed = await tx
      .update(contentVideoJobs)
      .set({
        status: "processing",
        attempts: sql`${contentVideoJobs.attempts} + 1`,
        leaseToken,
        leaseExpiresAt: leaseUntil,
        lastHeartbeatAt: now,
        error: null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentVideoJobs.id, candidate.id),
          claimable,
          eq(contentVideoJobs.pipelineVersion, VIDEO_PIPELINE_VERSION),
          activeLessonForJobSql(),
          lt(contentVideoJobs.attempts, MAX_VIDEO_JOB_ATTEMPTS)
        )
      );
    if (affectedRows(claimed) !== 1) return null;

    const [job] = await tx
      .select({
        jobId: contentVideoJobs.id,
        ownerUserId: contentVideoJobs.ownerUserId,
        lessonId: contentVideoJobs.lessonId,
        status: contentVideoJobs.status,
        filename: contentVideoJobs.filename,
        sourceUploadId: contentVideoJobs.sourceUploadId,
        sourceObjectKey: contentUploads.objectKey,
        sourceContentType: contentUploads.contentType,
        sourceSize: contentUploads.size,
        leaseToken: contentVideoJobs.leaseToken,
        attempts: contentVideoJobs.attempts,
      })
      .from(contentVideoJobs)
      .innerJoin(
        contentUploads,
        eq(contentUploads.id, contentVideoJobs.sourceUploadId)
      )
      .where(
        and(
          eq(contentVideoJobs.id, candidate.id),
          eq(contentVideoJobs.leaseToken, leaseToken),
          eq(contentVideoJobs.status, "processing"),
          eq(contentUploads.status, "source")
        )
      )
      .limit(1);
    if (!job || !job.leaseToken) return null;
    return { ...job, leaseToken: job.leaseToken };
  });
}

/** Extends a lease and records 0..99 conversion progress. False means fenced/cancelled. */
export async function heartbeatVideoJob(
  id: string,
  leaseToken: string,
  progress: number
): Promise<boolean> {
  const db = await requireDb();
  const now = new Date();
  const result = await db
    .update(contentVideoJobs)
    .set({
      progress: clampProgress(progress),
      leaseExpiresAt: new Date(now.getTime() + VIDEO_LEASE_MS),
      lastHeartbeatAt: now,
      updatedAt: now,
    })
    .where(
      and(
        eq(contentVideoJobs.id, id),
        eq(contentVideoJobs.status, "processing"),
        eq(contentVideoJobs.leaseToken, leaseToken),
        activeLessonForJobSql()
      )
    );
  return affectedRows(result) === 1;
}

/** Ends an obsolete claim only if this worker still owns its lease. */
export async function cancelObsoleteClaimedVideoJob(
  id: string,
  leaseToken: string
): Promise<void> {
  const db = await requireDb();
  const now = new Date();
  await db.update(contentVideoJobs).set({
    status: "cancelled",
    leaseToken: null,
    leaseExpiresAt: null,
    lastHeartbeatAt: null,
    finishedAt: now,
    updatedAt: now,
  }).where(and(
    eq(contentVideoJobs.id, id),
    eq(contentVideoJobs.status, "processing"),
    eq(contentVideoJobs.leaseToken, leaseToken),
    sql`not (${activeLessonForJobSql()})`
  ));
}

/** Requeues a fenced claim up to the bounded attempt count, then leaves a safe French error. */
export async function failClaimedVideoJob(
  id: string,
  leaseToken: string,
  message = "La conversion de la vidéo a échoué. Vous pouvez réessayer."
): Promise<boolean> {
  const db = await requireDb();
  return db.transaction(async tx => {
    const [job] = await tx
      .select({ attempts: contentVideoJobs.attempts })
      .from(contentVideoJobs)
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.status, "processing"),
          eq(contentVideoJobs.leaseToken, leaseToken)
        )
      )
      .limit(1);
    if (!job) return false;

    const now = new Date();
    const exhausted = job.attempts >= MAX_VIDEO_JOB_ATTEMPTS;
    const result = await tx
      .update(contentVideoJobs)
      .set({
        status: exhausted ? "failed" : "queued",
        progress: exhausted ? 0 : 0,
        error: exhausted ? message.slice(0, 1000) : null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastHeartbeatAt: null,
        finishedAt: exhausted ? now : null,
        updatedAt: now,
      })
      .where(
        and(
          eq(contentVideoJobs.id, id),
          eq(contentVideoJobs.status, "processing"),
          eq(contentVideoJobs.leaseToken, leaseToken)
        )
      );
    return affectedRows(result) === 1;
  });
}

class AttachmentFencedError extends Error {}

/**
 * Stores generated artifacts as ready owned uploads and attaches them atomically.
 * Every write is fenced by the active job pointer and lease token, so a stale
 * worker can only leave harmless unreferenced storage objects.
 */
export async function completeClaimedVideoJob(
  id: string,
  leaseToken: string,
  artifacts: VideoOutputArtifacts
): Promise<boolean> {
  if (
    !Number.isInteger(artifacts.video.size) ||
    !Number.isInteger(artifacts.poster.size) ||
    artifacts.video.size <= 0 ||
    artifacts.poster.size <= 0 ||
    artifacts.video.size > MAX_PHONE_VIDEO_BYTES ||
    artifacts.poster.size > MAX_PHONE_VIDEO_BYTES ||
    !Number.isFinite(artifacts.durationSeconds) ||
    artifacts.durationSeconds <= 0 ||
    !isSafeGeneratedObjectKey(artifacts.video.key, "mp4") ||
    !isSafeGeneratedObjectKey(artifacts.poster.key, "jpg")
  ) {
    throw new VideoJobValidationError(
      "Les fichiers convertis ne respectent pas les limites attendues."
    );
  }

  const db = await requireDb();
  try {
    return await db.transaction(async tx => {
      const [job] = await tx
        .select({
          id: contentVideoJobs.id,
          lessonId: contentVideoJobs.lessonId,
          ownerUserId: contentVideoJobs.ownerUserId,
        })
        .from(contentVideoJobs)
        .where(
          and(
            eq(contentVideoJobs.id, id),
            eq(contentVideoJobs.status, "processing"),
            eq(contentVideoJobs.leaseToken, leaseToken),
            activeLessonForJobSql()
          )
        )
        .limit(1);
      if (!job) return false;

      const [lesson] = await tx
        .select({ id: contentLessons.id })
        .from(contentLessons)
        .innerJoin(
          contentCourses,
          eq(contentCourses.id, contentLessons.courseId)
        )
        .where(
          and(
            eq(contentLessons.id, job.lessonId),
            eq(contentLessons.videoJobId, id),
            isNull(contentLessons.archivedAt),
            isNull(contentCourses.archivedAt)
          )
        )
        .limit(1);
      if (!lesson) return false;

      const now = new Date();
      const outputUploadId = nanoid(21);
      const posterUploadId = nanoid(21);
      await tx.insert(contentUploads).values([
        {
          id: outputUploadId,
          ownerUserId: job.ownerUserId,
          objectKey: artifacts.video.key,
          filename: "video-convertie.mp4",
          contentType: "video/mp4",
          size: artifacts.video.size,
          kind: "video",
          status: "ready",
          createdAt: now,
          readyAt: now,
        },
        {
          id: posterUploadId,
          ownerUserId: job.ownerUserId,
          objectKey: artifacts.poster.key,
          filename: "affiche-video.jpg",
          contentType: "image/jpeg",
          size: artifacts.poster.size,
          kind: "image",
          status: "ready",
          createdAt: now,
          readyAt: now,
        },
      ]);

      const completed = await tx
        .update(contentVideoJobs)
        .set({
          status: "ready",
          progress: 100,
          outputVideoUploadId: outputUploadId,
          posterUploadId,
          durationSeconds: Math.max(1, Math.round(artifacts.durationSeconds)),
          error: null,
          leaseToken: null,
          leaseExpiresAt: null,
          lastHeartbeatAt: now,
          finishedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentVideoJobs.id, id),
            eq(contentVideoJobs.status, "processing"),
            eq(contentVideoJobs.leaseToken, leaseToken),
            activeLessonForJobSql()
          )
        );
      if (affectedRows(completed) !== 1) throw new AttachmentFencedError();

      const attached = await tx
        .update(contentLessons)
        .set({
          videoUrl: stableStorageUrl(artifacts.video.key),
          videoPosterUrl: stableStorageUrl(artifacts.poster.key),
          videoType: "file",
          duration: formatVideoDuration(artifacts.durationSeconds),
          revision: sql`${contentLessons.revision} + 1`,
          updatedAt: now,
        })
        .where(
          and(
            eq(contentLessons.id, job.lessonId),
            eq(contentLessons.videoJobId, id),
            isNull(contentLessons.archivedAt),
            courseStillActiveForLessonSql()
          )
        );
      if (affectedRows(attached) !== 1) throw new AttachmentFencedError();

      return true;
    });
  } catch (error) {
    if (error instanceof AttachmentFencedError) return false;
    throw error;
  }
}

/** Lightweight check used by the worker after an AbortSignal is raised. */
export async function isVideoJobLeaseCurrent(
  id: string,
  leaseToken: string
): Promise<boolean> {
  const db = await requireDb();
  const [job] = await db
    .select({ id: contentVideoJobs.id })
    .from(contentVideoJobs)
    .where(
      and(
        eq(contentVideoJobs.id, id),
        eq(contentVideoJobs.status, "processing"),
        eq(contentVideoJobs.leaseToken, leaseToken)
      )
    )
    .limit(1);
  return Boolean(job);
}

/** Allows content validation to accept only generated managed video URLs. */
export async function isReadyGeneratedVideoObjectKey(
  objectKey: string
): Promise<boolean> {
  const db = await requireDb();
  const [match] = await db
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
  return Boolean(match);
}
