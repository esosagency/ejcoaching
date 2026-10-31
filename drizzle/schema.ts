import { sql } from "drizzle-orm";
import {
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
  primaryKey,
  text,
  timestamp,
  varchar,
} from "drizzle-orm/mysql-core";

/**
 * Core user table backing auth flow.
 * This table is intentionally preserved: OAuth owns user creation and identity.
 */
export const users = mysqlTable("users", {
  /** Surrogate primary key managed by MySQL. */
  id: int("id").autoincrement().primaryKey(),
  /** Manus OAuth identifier (openId) returned from the OAuth callback. */
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;

/** Explicit, normalized-email allowlist used by the authentication layer. */
export const adminAccess = mysqlTable("adminAccess", {
  email: varchar("email", { length: 320 }).primaryKey(),
  createdAt: datetime("createdAt")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
});

export const contentCourses = mysqlTable(
  "contentCourses",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    title: varchar("title", { length: 180 }).notNull(),
    category: varchar("category", { length: 100 }).notNull(),
    eyebrow: varchar("eyebrow", { length: 160 }).notNull(),
    description: text("description").notNull(),
    color: varchar("color", { length: 16 }).notNull(),
    image: varchar("image", { length: 2048 }),
    icon: mysqlEnum("icon", [
      "nutrition",
      "training",
      "mindset",
      "deficit",
      "surplus",
      "equipment",
      "supplements",
    ]).notNull(),
    status: mysqlEnum("status", ["draft", "published"])
      .notNull()
      .default("draft"),
    isSample: boolean("isSample").notNull().default(false),
    position: int("position").notNull(),
    revision: int("revision").notNull().default(1),
    archivedAt: datetime("archivedAt"),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updatedAt: datetime("updatedAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [
    index("contentCourses_catalog_idx").on(
      table.archivedAt,
      table.status,
      table.position
    ),
  ]
);

export const contentLessons = mysqlTable(
  "contentLessons",
  {
    id: varchar("id", { length: 128 }).primaryKey(),
    courseId: varchar("courseId", { length: 128 })
      .notNull()
      .references(() => contentCourses.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    title: varchar("title", { length: 180 }).notNull(),
    duration: varchar("duration", { length: 32 }).notNull(),
    description: text("description").notNull(),
    takeaways: json("takeaways").$type<string[]>().notNull(),
    videoUrl: varchar("videoUrl", { length: 2048 }),
    videoType: mysqlEnum("videoType", ["demo", "file", "embed"])
      .notNull()
      .default("demo"),
    /** Current native conversion job. It is fenced in the worker before attach. */
    videoJobId: varchar("videoJobId", { length: 64 }),
    /** Stable generated poster URL. Source-upload URLs are never stored here. */
    videoPosterUrl: varchar("videoPosterUrl", { length: 2048 }),
    resources: json("resources")
      .$type<
        Array<{ id: string; title: string; url: string; filename?: string }>
      >()
      .notNull(),
    position: int("position").notNull(),
    revision: int("revision").notNull().default(1),
    archivedAt: datetime("archivedAt"),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updatedAt: datetime("updatedAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [
    index("contentLessons_course_order_idx").on(
      table.courseId,
      table.archivedAt,
      table.position
    ),
    index("contentLessons_video_job_idx").on(table.videoJobId),
  ]
);

/** Metadata for direct-to-storage uploads. Files themselves are never stored in MySQL. */
export const contentUploads = mysqlTable(
  "contentUploads",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    objectKey: varchar("objectKey", { length: 512 }).notNull().unique(),
    filename: varchar("filename", { length: 255 }).notNull(),
    contentType: varchar("contentType", { length: 128 }).notNull(),
    size: int("size").notNull(),
    kind: mysqlEnum("kind", ["video", "image", "document"]).notNull(),
    /** `source` is verified original media and intentionally not playback-ready. */
    status: mysqlEnum("status", ["pending", "source", "ready"])
      .notNull()
      .default("pending"),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    readyAt: datetime("readyAt"),
  },
  table => [
    index("contentUploads_owner_status_idx").on(
      table.ownerUserId,
      table.status
    ),
  ]
);

/**
 * Durable native phone-video work queue. Object keys remain in contentUploads;
 * this table stores identifiers only so route DTOs cannot leak source locations.
 */
export const contentVideoJobs = mysqlTable(
  "contentVideoJobs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    lessonId: varchar("lessonId", { length: 128 })
      .notNull()
      .references(() => contentLessons.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    ownerUserId: int("ownerUserId")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    sourceUploadId: varchar("sourceUploadId", { length: 64 })
      .notNull()
      .unique()
      .references(() => contentUploads.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    status: mysqlEnum("status", [
      "uploading",
      "queued",
      "processing",
      "ready",
      "failed",
      "cancelled",
    ])
      .notNull()
      .default("uploading"),
    progress: int("progress").notNull().default(0),
    filename: varchar("filename", { length: 255 }).notNull(),
    pipelineVersion: int("pipelineVersion").notNull().default(1),
    attempts: int("attempts").notNull().default(0),
    /** Random token used to fence a stale worker after lease recovery/cancellation. */
    leaseToken: varchar("leaseToken", { length: 64 }),
    leaseExpiresAt: datetime("leaseExpiresAt"),
    lastHeartbeatAt: datetime("lastHeartbeatAt"),
    outputVideoUploadId: varchar("outputVideoUploadId", {
      length: 64,
    }).references(() => contentUploads.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    posterUploadId: varchar("posterUploadId", { length: 64 }).references(
      () => contentUploads.id,
      { onDelete: "restrict", onUpdate: "cascade" }
    ),
    durationSeconds: int("durationSeconds"),
    error: varchar("error", { length: 1000 }),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updatedAt: datetime("updatedAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    finishedAt: datetime("finishedAt"),
  },
  table => [
    index("contentVideoJobs_queue_idx").on(
      table.status,
      table.leaseExpiresAt,
      table.createdAt
    ),
    index("contentVideoJobs_lesson_idx").on(table.lessonId, table.status),
    index("contentVideoJobs_owner_idx").on(table.ownerUserId, table.createdAt),
  ]
);

/** Named, one-time setup markers. Seed scripts insert a marker only after completing. */
export const contentSetup = mysqlTable("contentSetup", {
  marker: varchar("marker", { length: 128 }).primaryKey(),
  completedAt: datetime("completedAt")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
});

/**
 * Explicit client approvals keyed by the normalized OAuth email. The email is
 * deliberately immutable: OAuth remains the source of identity, while this
 * table is an administrator-managed authorization record.
 */
export const coachingClients = mysqlTable(
  "coachingClients",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    /** Optional contact information; it is never an authentication identity. */
    email: varchar("email", { length: 320 }),
    name: varchar("name", { length: 180 }).notNull(),
    status: mysqlEnum("status", ["active", "revoked"])
      .notNull()
      .default("active"),
    revision: int("revision").notNull().default(1),
    /** SHA-256 lookup fingerprint for an active personal code, never returned. */
    codeLookupHash: varchar("codeLookupHash", { length: 64 }).unique(),
    /** Serialized salted scrypt verifier for an active personal code, never returned. */
    codeVerifier: varchar("codeVerifier", { length: 512 }),
    /** Monotonic invalidation generation for code-backed sessions. */
    codeVersion: int("codeVersion").notNull().default(0),
    codeIssuedAt: datetime("codeIssuedAt"),
    lastCodeLoginAt: datetime("lastCodeLoginAt"),
    createdBy: int("createdBy")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updatedAt: datetime("updatedAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [index("coachingClients_status_idx").on(table.status)]
);

/**
 * Opaque client sessions. Only a SHA-256 token fingerprint is persisted; a
 * session is valid only while its client has the same current codeVersion.
 */
export const clientCodeSessions = mysqlTable(
  "clientCodeSessions",
  {
    tokenHash: varchar("tokenHash", { length: 64 }).primaryKey(),
    clientId: varchar("clientId", { length: 64 })
      .notNull()
      .references(() => coachingClients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    codeVersion: int("codeVersion").notNull(),
    expiresAt: datetime("expiresAt").notNull(),
    revokedAt: datetime("revokedAt"),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [
    index("clientCodeSessions_client_active_idx").on(
      table.clientId,
      table.revokedAt,
      table.expiresAt
    ),
  ]
);

/**
 * Persistent, privacy-preserving login limiter. scopeHash is derived from the
 * requester network/fingerprint and never stores an IP address or a code.
 */
export const clientCodeAttempts = mysqlTable("clientCodeAttempts", {
  scopeHash: varchar("scopeHash", { length: 64 }).primaryKey(),
  windowStartedAt: datetime("windowStartedAt").notNull(),
  attempts: int("attempts").notNull().default(0),
  blockedUntil: datetime("blockedUntil"),
  updatedAt: datetime("updatedAt")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
});

/** Per-client course assignments. Client records and courses are never deleted here. */
export const clientCourseAccess = mysqlTable(
  "clientCourseAccess",
  {
    clientId: varchar("clientId", { length: 64 })
      .notNull()
      .references(() => coachingClients.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    courseId: varchar("courseId", { length: 128 })
      .notNull()
      .references(() => contentCourses.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [
    primaryKey({ columns: [table.clientId, table.courseId] }),
    index("clientCourseAccess_course_idx").on(table.courseId),
  ]
);

/**
 * Server-only encryption metadata. Do not expose this table or its key material
 * through access, client-management, or course DTOs.
 */
export const privateMedia = mysqlTable(
  "privateMedia",
  {
    objectKey: varchar("objectKey", { length: 512 }).primaryKey(),
    id: varchar("id", { length: 64 }).notNull().unique(),
    keyBase64: varchar("keyBase64", { length: 44 }).notNull(),
    nonceBase64: varchar("nonceBase64", { length: 16 }).notNull(),
    plainSize: int("plainSize").notNull(),
    chunkSize: int("chunkSize").notNull(),
    contentType: varchar("contentType", { length: 128 }).notNull(),
    layout: mysqlEnum("layout", ["single", "parts"]).notNull(),
    status: mysqlEnum("status", ["pending", "ready"])
      .notNull()
      .default("pending"),
    createdAt: datetime("createdAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
    updatedAt: datetime("updatedAt")
      .default(sql`(CURRENT_TIMESTAMP)`)
      .notNull(),
  },
  table => [index("privateMedia_status_idx").on(table.status, table.updatedAt)]
);

export type ContentCourseRow = typeof contentCourses.$inferSelect;
export type ContentLessonRow = typeof contentLessons.$inferSelect;
export type ContentUploadRow = typeof contentUploads.$inferSelect;
export type ContentVideoJobRow = typeof contentVideoJobs.$inferSelect;
export type CoachingClientRow = typeof coachingClients.$inferSelect;
export type ClientCodeSessionRow = typeof clientCodeSessions.$inferSelect;
export type ClientCodeAttemptRow = typeof clientCodeAttempts.$inferSelect;
export type ClientCourseAccessRow = typeof clientCourseAccess.$inferSelect;
export type PrivateMediaRow = typeof privateMedia.$inferSelect;
