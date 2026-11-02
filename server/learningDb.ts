import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  clientCourseAccess,
  clientLessonProgress,
  clientLearningState,
  coachingClients,
  contentCourses,
  contentLessons,
} from "../drizzle/schema";
import type {
  ClientLearningRecord,
  LearningSnapshot,
  LegacyLearningImport,
  SaveLearningNoteInput,
  SetCompletedInput,
  SetSavedInput,
} from "../shared/learning";
import type { CodeClientIdentity } from "../shared/codeAccess";
import { getDb } from "./db";

/** Returned when the application principal or lesson entitlement is no longer current. */
export class LearningPermissionError extends Error {
  constructor(
    message = "Ton accès à cette leçon n’est plus disponible. Actualise ta connexion et réessaie."
  ) {
    super(message);
    this.name = "LearningPermissionError";
  }
}

/** Returned for an optimistic note save based on an old revision. */
export class LearningConflictError extends Error {
  constructor() {
    super(
      "Cette note a été modifiée ailleurs. Recharge la version enregistrée avant de réessayer."
    );
    this.name = "LearningConflictError";
  }
}

export class LearningValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LearningValidationError";
  }
}

export class LearningDatabaseUnavailableError extends Error {
  constructor() {
    super("La base de données de progression est indisponible.");
    this.name = "LearningDatabaseUnavailableError";
  }
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type LearningReader = Pick<Database, "select">;
type LearningWriter = Pick<Database, "select" | "insert" | "update">;
type LearningClient = Pick<CodeClientIdentity, "id" | "codeVersion">;
type ProgressRow = {
  lessonId: string;
  completed: boolean;
  saved: boolean;
  note: string;
  noteRevision: number;
  lastViewedAt: Date | null;
  updatedAt: Date;
};

function accountKeyFor(clientId: string): string {
  return `client_${clientId}`;
}

function assertClientPrincipal(client: LearningClient): void {
  if (
    typeof client.id !== "string" ||
    client.id.trim().length === 0 ||
    client.id.length > 64 ||
    !Number.isSafeInteger(client.codeVersion) ||
    client.codeVersion < 0
  ) {
    throw new LearningPermissionError(
      "Ta session client n’est plus valide. Reconnecte-toi avec ton code personnel."
    );
  }
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new LearningDatabaseUnavailableError();
  return db;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function toLearningRecord(row: ProgressRow): ClientLearningRecord {
  return {
    lessonId: row.lessonId,
    completed: row.completed,
    saved: row.saved,
    note: row.note,
    noteRevision: row.noteRevision,
    lastViewedAt: row.lastViewedAt ? toIso(row.lastViewedAt) : null,
    updatedAt: toIso(row.updatedAt),
  };
}

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") {
    return 0;
  }
  const affected = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof affected === "number" ? affected : 0;
}

function isDuplicateKeyError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as { code?: unknown; errno?: unknown };
  return candidate.code === "ER_DUP_ENTRY" || candidate.errno === 1062;
}

/**
 * Rechecks the persisted client status and current code generation. The caller's
 * `ctx.client` is a principal hint, never an authorization substitute.
 */
async function requireCurrentClient(
  db: LearningReader,
  client: LearningClient,
  lockForWrite = false
): Promise<void> {
  const query = db
    .select({ id: coachingClients.id })
    .from(coachingClients)
    .where(
      and(
        eq(coachingClients.id, client.id),
        eq(coachingClients.status, "active"),
        eq(coachingClients.codeVersion, client.codeVersion)
      )
    )
    .limit(1);
  const [current] = lockForWrite ? await query.for("update") : await query;
  if (!current) {
    throw new LearningPermissionError(
      "Ton accès client n’est plus actif. Reconnecte-toi avec ton code personnel."
    );
  }
}

/** Rechecks one current published, non-archived assignment before a lesson write. */
async function requireVisibleLesson(
  db: LearningReader,
  client: LearningClient,
  lessonId: string,
  lockForWrite = false
): Promise<void> {
  const query = db
    .select({ id: contentLessons.id })
    .from(contentLessons)
    .innerJoin(contentCourses, eq(contentLessons.courseId, contentCourses.id))
    .innerJoin(
      clientCourseAccess,
      and(
        eq(clientCourseAccess.courseId, contentCourses.id),
        eq(clientCourseAccess.clientId, client.id)
      )
    )
    .innerJoin(
      coachingClients,
      eq(clientCourseAccess.clientId, coachingClients.id)
    )
    .where(
      and(
        eq(contentLessons.id, lessonId),
        isNull(contentLessons.archivedAt),
        isNull(contentCourses.archivedAt),
        eq(contentCourses.status, "published"),
        eq(coachingClients.id, client.id),
        eq(coachingClients.status, "active"),
        eq(coachingClients.codeVersion, client.codeVersion)
      )
    )
    .limit(1);
  const [lesson] = lockForWrite ? await query.for("update") : await query;
  if (!lesson) throw new LearningPermissionError();
}

/** Resolves a bounded set of currently visible lesson IDs for legacy import. */
async function getVisibleLessonIds(
  db: LearningReader,
  client: LearningClient,
  lessonIds: string[],
  lockForWrite = false
): Promise<Set<string>> {
  if (lessonIds.length === 0) return new Set();
  const query = db
    .select({ id: contentLessons.id })
    .from(contentLessons)
    .innerJoin(contentCourses, eq(contentLessons.courseId, contentCourses.id))
    .innerJoin(
      clientCourseAccess,
      and(
        eq(clientCourseAccess.courseId, contentCourses.id),
        eq(clientCourseAccess.clientId, client.id)
      )
    )
    .innerJoin(
      coachingClients,
      eq(clientCourseAccess.clientId, coachingClients.id)
    )
    .where(
      and(
        inArray(contentLessons.id, lessonIds),
        isNull(contentLessons.archivedAt),
        isNull(contentCourses.archivedAt),
        eq(contentCourses.status, "published"),
        eq(coachingClients.id, client.id),
        eq(coachingClients.status, "active"),
        eq(coachingClients.codeVersion, client.codeVersion)
      )
    );
  const lessons = lockForWrite ? await query.for("update") : await query;
  return new Set(lessons.map(lesson => lesson.id));
}

async function readProgress(
  db: LearningReader,
  clientId: string,
  lessonId: string
): Promise<ClientLearningRecord> {
  const [row] = await db
    .select({
      lessonId: clientLessonProgress.lessonId,
      completed: clientLessonProgress.completed,
      saved: clientLessonProgress.saved,
      note: clientLessonProgress.note,
      noteRevision: clientLessonProgress.noteRevision,
      lastViewedAt: clientLessonProgress.lastViewedAt,
      updatedAt: clientLessonProgress.updatedAt,
    })
    .from(clientLessonProgress)
    .where(
      and(
        eq(clientLessonProgress.clientId, clientId),
        eq(clientLessonProgress.lessonId, lessonId)
      )
    )
    .limit(1);
  if (!row) {
    throw new LearningDatabaseUnavailableError();
  }
  return toLearningRecord(row);
}

async function getSnapshotForClient(
  db: LearningReader,
  client: LearningClient
): Promise<LearningSnapshot> {
  const rows = await db
    .select({
      lessonId: clientLessonProgress.lessonId,
      completed: clientLessonProgress.completed,
      saved: clientLessonProgress.saved,
      note: clientLessonProgress.note,
      noteRevision: clientLessonProgress.noteRevision,
      lastViewedAt: clientLessonProgress.lastViewedAt,
      updatedAt: clientLessonProgress.updatedAt,
    })
    .from(clientLessonProgress)
    .innerJoin(
      contentLessons,
      eq(clientLessonProgress.lessonId, contentLessons.id)
    )
    .innerJoin(contentCourses, eq(contentLessons.courseId, contentCourses.id))
    .innerJoin(
      clientCourseAccess,
      and(
        eq(clientCourseAccess.courseId, contentCourses.id),
        eq(clientCourseAccess.clientId, client.id)
      )
    )
    .innerJoin(
      coachingClients,
      eq(clientLessonProgress.clientId, coachingClients.id)
    )
    .where(
      and(
        eq(clientLessonProgress.clientId, client.id),
        isNull(contentLessons.archivedAt),
        isNull(contentCourses.archivedAt),
        eq(contentCourses.status, "published"),
        eq(coachingClients.id, client.id),
        eq(coachingClients.status, "active"),
        eq(coachingClients.codeVersion, client.codeVersion)
      )
    )
    .orderBy(
      asc(contentCourses.position),
      asc(contentLessons.position),
      asc(contentLessons.id)
    );

  const records = rows.map(toLearningRecord);
  let latestRecord: ClientLearningRecord | null = null;
  for (const record of records) {
    if (!record.lastViewedAt) continue;
    if (
      !latestRecord ||
      !latestRecord.lastViewedAt ||
      record.lastViewedAt > latestRecord.lastViewedAt ||
      (record.lastViewedAt === latestRecord.lastViewedAt &&
        record.lessonId > latestRecord.lessonId)
    ) {
      // A lexical lesson-id tie-breaker keeps the snapshot stable even if two
      // independent requests land in the same millisecond.
      latestRecord = record;
    }
  }

  return {
    accountKey: accountKeyFor(client.id),
    records,
    lastLessonId: latestRecord?.lessonId ?? null,
  };
}

/** Returns only records still visible to this active current code client. */
export async function snapshot(
  client: LearningClient
): Promise<LearningSnapshot> {
  assertClientPrincipal(client);
  const db = await requireDb();
  await requireCurrentClient(db, client);
  return getSnapshotForClient(db, client);
}

/** Explicit completion writes never alter saved state, notes, or last view. */
export async function setCompleted(
  client: LearningClient,
  input: Omit<SetCompletedInput, "accountKey">
): Promise<ClientLearningRecord> {
  assertClientPrincipal(client);
  const db = await requireDb();
  return db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    await requireVisibleLesson(tx, client, input.lessonId, true);
    const now = new Date();
    await tx
      .insert(clientLessonProgress)
      .values({
        clientId: client.id,
        lessonId: input.lessonId,
        completed: input.completed,
        completedSetAt: now,
        saved: false,
        note: "",
        noteRevision: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          completed: input.completed,
          completedSetAt: now,
          updatedAt: now,
        },
      });
    return readProgress(tx, client.id, input.lessonId);
  });
}

/** Explicit saved-state writes never alter completion, notes, or last view. */
export async function setSaved(
  client: LearningClient,
  input: Omit<SetSavedInput, "accountKey">
): Promise<ClientLearningRecord> {
  assertClientPrincipal(client);
  const db = await requireDb();
  return db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    await requireVisibleLesson(tx, client, input.lessonId, true);
    const now = new Date();
    await tx
      .insert(clientLessonProgress)
      .values({
        clientId: client.id,
        lessonId: input.lessonId,
        completed: false,
        saved: input.saved,
        savedSetAt: now,
        note: "",
        noteRevision: 0,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: {
          saved: input.saved,
          savedSetAt: now,
          updatedAt: now,
        },
      });
    return readProgress(tx, client.id, input.lessonId);
  });
}

/**
 * Updates only a note and only if its current revision equals the browser's
 * acknowledged revision. Completion/saved/visit mutations never touch it.
 */
export async function saveNote(
  client: LearningClient,
  input: Omit<SaveLearningNoteInput, "accountKey">
): Promise<ClientLearningRecord> {
  assertClientPrincipal(client);
  const db = await requireDb();
  return db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    await requireVisibleLesson(tx, client, input.lessonId, true);
    const now = new Date();
    const result = await tx
      .update(clientLessonProgress)
      .set({
        note: input.note,
        noteRevision: sql`${clientLessonProgress.noteRevision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(clientLessonProgress.clientId, client.id),
          eq(clientLessonProgress.lessonId, input.lessonId),
          eq(clientLessonProgress.noteRevision, input.expectedRevision)
        )
      );

    if (affectedRows(result) === 0) {
      if (input.expectedRevision !== 0) throw new LearningConflictError();
      try {
        await tx.insert(clientLessonProgress).values({
          clientId: client.id,
          lessonId: input.lessonId,
          completed: false,
          saved: false,
          note: input.note,
          noteRevision: 1,
          createdAt: now,
          updatedAt: now,
        });
      } catch (error) {
        if (isDuplicateKeyError(error)) throw new LearningConflictError();
        throw error;
      }
    }

    return readProgress(tx, client.id, input.lessonId);
  });
}

/** Records a fresh server timestamp without rewriting any other learning field. */
export async function visit(
  client: LearningClient,
  lessonId: string
): Promise<ClientLearningRecord> {
  assertClientPrincipal(client);
  const db = await requireDb();
  return db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    await requireVisibleLesson(tx, client, lessonId, true);
    const now = new Date();
    await tx
      .insert(clientLessonProgress)
      .values({
        clientId: client.id,
        lessonId,
        completed: false,
        saved: false,
        note: "",
        noteRevision: 0,
        lastViewedAt: now,
        createdAt: now,
        updatedAt: now,
      })
      .onDuplicateKeyUpdate({
        set: { lastViewedAt: now, updatedAt: now },
      });
    return readProgress(tx, client.id, lessonId);
  });
}

async function importCompleted(
  db: LearningWriter,
  clientId: string,
  lessonId: string,
  now: Date
): Promise<void> {
  await db
    .insert(clientLessonProgress)
    .values({
      clientId,
      lessonId,
      completed: true,
      completedSetAt: now,
      saved: false,
      note: "",
      noteRevision: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      // The timestamp is the durable signal that an explicit server value exists.
      set: {
        updatedAt: sql`if(${clientLessonProgress.completedSetAt} is null, ${now}, ${clientLessonProgress.updatedAt})`,
        completed: sql`if(${clientLessonProgress.completedSetAt} is null, true, ${clientLessonProgress.completed})`,
        completedSetAt: sql`if(${clientLessonProgress.completedSetAt} is null, ${now}, ${clientLessonProgress.completedSetAt})`,
      },
    });
}

async function importSaved(
  db: LearningWriter,
  clientId: string,
  lessonId: string,
  now: Date
): Promise<void> {
  await db
    .insert(clientLessonProgress)
    .values({
      clientId,
      lessonId,
      completed: false,
      saved: true,
      savedSetAt: now,
      note: "",
      noteRevision: 0,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        updatedAt: sql`if(${clientLessonProgress.savedSetAt} is null, ${now}, ${clientLessonProgress.updatedAt})`,
        saved: sql`if(${clientLessonProgress.savedSetAt} is null, true, ${clientLessonProgress.saved})`,
        savedSetAt: sql`if(${clientLessonProgress.savedSetAt} is null, ${now}, ${clientLessonProgress.savedSetAt})`,
      },
    });
}

async function importNote(
  db: LearningWriter,
  clientId: string,
  lessonId: string,
  note: string,
  now: Date
): Promise<void> {
  // Empty legacy entries carry no note content. Skipping them also avoids
  // turning an untouched revision-0 field into a deliberate empty note.
  if (note.length === 0) return;
  await db
    .insert(clientLessonProgress)
    .values({
      clientId,
      lessonId,
      completed: false,
      saved: false,
      note,
      noteRevision: 1,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      // The actual existing-row write is separately guarded below. A no-op here
      // avoids MySQL's left-to-right duplicate-key assignment evaluation.
      set: {
        clientId: sql`${clientLessonProgress.clientId}`,
      },
    });

  // A non-empty value or revision > 0 means the server state was touched,
  // including a deliberately cleared note (revision > 0). Keeping the entire
  // predicate in WHERE makes this existing-row write atomic.
  await db
    .update(clientLessonProgress)
    .set({ note, noteRevision: 1, updatedAt: now })
    .where(
      and(
        eq(clientLessonProgress.clientId, clientId),
        eq(clientLessonProgress.lessonId, lessonId),
        eq(clientLessonProgress.noteRevision, 0),
        eq(clientLessonProgress.note, "")
      )
    );
}

async function hasServerLastView(
  db: LearningReader,
  clientId: string
): Promise<boolean> {
  const [existing] = await db
    .select({ lessonId: clientLessonProgress.lessonId })
    .from(clientLessonProgress)
    .where(
      and(
        eq(clientLessonProgress.clientId, clientId),
        sql`${clientLessonProgress.lastViewedAt} is not null`
      )
    )
    .limit(1);
  return Boolean(existing);
}

async function hasLearningReset(
  db: LearningReader,
  clientId: string
): Promise<boolean> {
  const [state] = await db
    .select({ clientId: clientLearningState.clientId })
    .from(clientLearningState)
    .where(eq(clientLearningState.clientId, clientId))
    .limit(1);
  return Boolean(state);
}

async function importLastView(
  db: LearningWriter,
  clientId: string,
  lessonId: string,
  now: Date
): Promise<void> {
  await db
    .insert(clientLessonProgress)
    .values({
      clientId,
      lessonId,
      completed: false,
      saved: false,
      note: "",
      noteRevision: 0,
      lastViewedAt: now,
      createdAt: now,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        updatedAt: sql`if(${clientLessonProgress.lastViewedAt} is null, ${now}, ${clientLessonProgress.updatedAt})`,
        lastViewedAt: sql`if(${clientLessonProgress.lastViewedAt} is null, ${now}, ${clientLessonProgress.lastViewedAt})`,
      },
    });
}

function uniqueLessonIds(values: readonly string[]): string[] {
  return [...new Set(values)];
}

/**
 * Imports a browser's old per-account state only into untouched server fields.
 * Unauthorized, removed, draft, or archived lesson IDs are intentionally ignored.
 */
export async function importLocal(
  client: LearningClient,
  input: Omit<LegacyLearningImport, "accountKey">
): Promise<LearningSnapshot> {
  assertClientPrincipal(client);
  const db = await requireDb();
  await db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    const resetTombstoneExists = await hasLearningReset(tx, client.id);
    const candidateIds = uniqueLessonIds([
      ...input.completedIds,
      ...input.savedIds,
      ...input.notes.map(item => item.lessonId),
      ...(input.lastLessonId ? [input.lastLessonId] : []),
    ]);
    const visibleLessonIds = await getVisibleLessonIds(
      tx,
      client,
      candidateIds,
      true
    );
    const now = new Date();

    if (!resetTombstoneExists) {
      for (const lessonId of uniqueLessonIds(input.completedIds)) {
        if (visibleLessonIds.has(lessonId)) {
          await importCompleted(tx, client.id, lessonId, now);
        }
      }
      for (const lessonId of uniqueLessonIds(input.savedIds)) {
        if (visibleLessonIds.has(lessonId)) {
          await importSaved(tx, client.id, lessonId, now);
        }
      }
    }
    for (const item of input.notes) {
      if (visibleLessonIds.has(item.lessonId)) {
        await importNote(tx, client.id, item.lessonId, item.note, now);
      }
    }

    if (
      !resetTombstoneExists &&
      input.lastLessonId &&
      visibleLessonIds.has(input.lastLessonId) &&
      !(await hasServerLastView(tx, client.id))
    ) {
      await importLastView(tx, client.id, input.lastLessonId, now);
    }
  });
  return snapshot(client);
}

/**
 * Resets cross-device completion, saved state, and last-view markers while
 * intentionally preserving every personal note and its revision/history.
 */
export async function reset(client: LearningClient): Promise<LearningSnapshot> {
  assertClientPrincipal(client);
  const db = await requireDb();
  await db.transaction(async tx => {
    await requireCurrentClient(tx, client, true);
    const now = new Date();
    await tx
      .insert(clientLearningState)
      .values({ clientId: client.id, lastResetAt: now })
      .onDuplicateKeyUpdate({ set: { lastResetAt: now } });
    await tx
      .update(clientLessonProgress)
      .set({
        completed: false,
        completedSetAt: now,
        saved: false,
        savedSetAt: now,
        lastViewedAt: null,
        updatedAt: now,
      })
      .where(eq(clientLessonProgress.clientId, client.id));
  });
  return snapshot(client);
}
