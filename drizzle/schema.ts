import { sql } from "drizzle-orm";
import {
  boolean,
  datetime,
  index,
  int,
  json,
  mysqlEnum,
  mysqlTable,
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
    status: mysqlEnum("status", ["pending", "ready"])
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

/** Named, one-time setup markers. Seed scripts insert a marker only after completing. */
export const contentSetup = mysqlTable("contentSetup", {
  marker: varchar("marker", { length: 128 }).primaryKey(),
  completedAt: datetime("completedAt")
    .default(sql`(CURRENT_TIMESTAMP)`)
    .notNull(),
});

export type ContentCourseRow = typeof contentCourses.$inferSelect;
export type ContentLessonRow = typeof contentLessons.$inferSelect;
export type ContentUploadRow = typeof contentUploads.$inferSelect;
