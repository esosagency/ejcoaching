import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  adminAccess,
  clientCourseAccess,
  coachingClients,
  contentCourses,
  type User,
} from "../drizzle/schema";
import type { AccessInfo } from "../shared/clientAccess";
import { getDb } from "./db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_CLIENT_COURSES = 200;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ClientQueryExecutor = Pick<Database, "select">;

export type ClientManagementRow = {
  id: string;
  email: string;
  name: string;
  status: "active" | "revoked";
  revision: number;
  courseIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ApproveClientInput = {
  email: string;
  name: string;
  courseIds: string[];
};

export type UpdateClientInput = {
  id: string;
  revision: number;
  name: string;
  courseIds: string[];
};

export type SetClientStatusInput = {
  id: string;
  revision: number;
  status: "active" | "revoked";
};

export class ClientAccessNotFoundError extends Error {
  constructor() {
    super("Client introuvable.");
    this.name = "ClientAccessNotFoundError";
  }
}

export class ClientAccessConflictError extends Error {
  constructor(
    message = "Ce client a été modifié par une autre personne. Rechargez la page et réessayez."
  ) {
    super(message);
    this.name = "ClientAccessConflictError";
  }
}

export class ClientAccessValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientAccessValidationError";
  }
}

export class ClientAccessDatabaseUnavailableError extends Error {
  constructor() {
    super("La base de données des accès clients est indisponible.");
    this.name = "ClientAccessDatabaseUnavailableError";
  }
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new ClientAccessDatabaseUnavailableError();
  return db;
}

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") {
    return 0;
  }
  const value = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" ? value : 0;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isAuthenticatedUser(user: User | null): user is User {
  return Boolean(
    user &&
      Number.isSafeInteger(user.id) &&
      user.id > 0 &&
      typeof user.openId === "string" &&
      user.openId.trim().length > 0 &&
      (user.role === "user" || user.role === "admin")
  );
}

/** Normalizes an email consistently before client-access lookups or writes. */
export function normalizeClientEmail(
  value: string | null | undefined
): string | null {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  return normalized.length > 0 ? normalized : null;
}

/** Shared validation predicate used by the router and direct server callers. */
export function isValidClientEmail(value: string): boolean {
  return value.length <= 320 && EMAIL_PATTERN.test(value);
}

function currentOAuthEmail(user: User): string | null {
  const email = normalizeClientEmail(user.email);
  return email && isValidClientEmail(email) ? email : null;
}

function accessUser(user: User): AccessInfo["user"] {
  return {
    id: user.id,
    name: user.name ?? "",
    email: normalizeClientEmail(user.email) ?? "",
  };
}

function signedOutAccess(): AccessInfo {
  return {
    authenticated: false,
    allowed: false,
    isAdmin: false,
    reason: "signed_out",
  };
}

async function findClientByEmail(db: ClientQueryExecutor, email: string) {
  const [client] = await db
    .select({ id: coachingClients.id, status: coachingClients.status })
    .from(coachingClients)
    .where(eq(coachingClients.email, email))
    .limit(1);
  return client;
}

/**
 * Resolves current authorization from the OAuth identity on every call. An
 * administrator is allowed without consulting client-approval records; all
 * other identities must have a current active approval.
 */
export async function getAccessForUser(user: User | null): Promise<AccessInfo> {
  if (!isAuthenticatedUser(user)) return signedOutAccess();

  const userInfo = accessUser(user);
  if (user.role === "admin") {
    return {
      authenticated: true,
      allowed: true,
      isAdmin: true,
      user: userInfo,
    };
  }

  const email = currentOAuthEmail(user);
  if (!email) {
    return {
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "unapproved",
      user: userInfo,
    };
  }

  const db = await requireDb();
  const client = await findClientByEmail(db, email);
  if (!client) {
    return {
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "unapproved",
      user: userInfo,
    };
  }
  if (client.status === "revoked") {
    return {
      authenticated: true,
      allowed: false,
      isAdmin: false,
      reason: "revoked",
      user: userInfo,
      clientId: client.id,
    };
  }

  return {
    authenticated: true,
    allowed: true,
    isAdmin: false,
    user: userInfo,
    clientId: client.id,
  };
}

/**
 * Returns only active, non-archived published course IDs. The lookup always
 * joins the current client approval and assignment rows so a revocation takes
 * effect at the next access check.
 */
export async function getAssignedCourseIds(user: User): Promise<string[]> {
  if (!isAuthenticatedUser(user)) return [];

  if (user.role === "admin") {
    const db = await requireDb();
    const courses = await db
      .select({ id: contentCourses.id })
      .from(contentCourses)
      .where(
        and(
          isNull(contentCourses.archivedAt),
          eq(contentCourses.status, "published")
        )
      )
      .orderBy(asc(contentCourses.position), asc(contentCourses.id));
    return courses.map(course => course.id);
  }

  const email = currentOAuthEmail(user);
  if (!email) return [];
  const db = await requireDb();

  const courses = await db
    .select({ id: contentCourses.id })
    .from(clientCourseAccess)
    .innerJoin(
      coachingClients,
      eq(clientCourseAccess.clientId, coachingClients.id)
    )
    .innerJoin(
      contentCourses,
      eq(clientCourseAccess.courseId, contentCourses.id)
    )
    .where(
      and(
        eq(coachingClients.email, email),
        eq(coachingClients.status, "active"),
        isNull(contentCourses.archivedAt),
        eq(contentCourses.status, "published")
      )
    )
    .orderBy(asc(contentCourses.position), asc(contentCourses.id));
  return courses.map(course => course.id);
}

/**
 * Privileged administrators may access any active course, including drafts.
 * The present course schema has no separate course-owner column, so its owner
 * authority is represented by the existing administrator role. Clients must
 * satisfy their current approval, assignment, publication, and archive state.
 */
export async function canAccessCourse(
  user: User | null,
  courseId: string
): Promise<boolean> {
  const normalizedCourseId =
    typeof courseId === "string" ? courseId.trim() : "";
  if (!isAuthenticatedUser(user) || !isValidCourseId(normalizedCourseId)) {
    return false;
  }

  if (user.role === "admin") {
    const db = await requireDb();
    const [course] = await db
      .select({ id: contentCourses.id })
      .from(contentCourses)
      .where(
        and(
          eq(contentCourses.id, normalizedCourseId),
          isNull(contentCourses.archivedAt)
        )
      )
      .limit(1);
    return Boolean(course);
  }

  const email = currentOAuthEmail(user);
  if (!email) return false;
  const db = await requireDb();

  const [course] = await db
    .select({ id: contentCourses.id })
    .from(clientCourseAccess)
    .innerJoin(
      coachingClients,
      eq(clientCourseAccess.clientId, coachingClients.id)
    )
    .innerJoin(
      contentCourses,
      eq(clientCourseAccess.courseId, contentCourses.id)
    )
    .where(
      and(
        eq(coachingClients.email, email),
        eq(coachingClients.status, "active"),
        eq(contentCourses.id, normalizedCourseId),
        isNull(contentCourses.archivedAt),
        eq(contentCourses.status, "published")
      )
    )
    .limit(1);
  return Boolean(course);
}

/** Returns client records for administration without private-media metadata. */
export async function listClients(): Promise<ClientManagementRow[]> {
  const db = await requireDb();
  const clients = await db
    .select({
      id: coachingClients.id,
      email: coachingClients.email,
      name: coachingClients.name,
      status: coachingClients.status,
      revision: coachingClients.revision,
      createdAt: coachingClients.createdAt,
      updatedAt: coachingClients.updatedAt,
    })
    .from(coachingClients)
    .orderBy(asc(coachingClients.email), asc(coachingClients.id));

  if (clients.length === 0) return [];

  const assignments = await db
    .select({
      clientId: clientCourseAccess.clientId,
      courseId: clientCourseAccess.courseId,
    })
    .from(clientCourseAccess)
    .where(
      inArray(
        clientCourseAccess.clientId,
        clients.map(client => client.id)
      )
    )
    .orderBy(
      asc(clientCourseAccess.clientId),
      asc(clientCourseAccess.courseId)
    );

  const courseIdsByClient = new Map<string, string[]>();
  for (const assignment of assignments) {
    const courseIds = courseIdsByClient.get(assignment.clientId) ?? [];
    courseIds.push(assignment.courseId);
    courseIdsByClient.set(assignment.clientId, courseIds);
  }

  return clients.map(client => ({
    id: client.id,
    email: client.email,
    name: client.name,
    status: client.status,
    revision: client.revision,
    courseIds: courseIdsByClient.get(client.id) ?? [],
    createdAt: toIso(client.createdAt),
    updatedAt: toIso(client.updatedAt),
  }));
}

function isValidCourseId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 128
  );
}

function normalizeCourseIds(courseIds: readonly string[]): string[] {
  if (courseIds.length > MAX_CLIENT_COURSES) {
    throw new ClientAccessValidationError(
      "Sélectionnez au plus 200 cours pour un client."
    );
  }

  const normalized = courseIds.map(courseId => courseId.trim());
  if (!normalized.every(isValidCourseId)) {
    throw new ClientAccessValidationError(
      "Un identifiant de cours est invalide."
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw new ClientAccessValidationError(
      "Un cours ne peut être sélectionné qu’une seule fois."
    );
  }
  return normalized;
}

function normalizeName(name: string): string {
  const normalized = name.trim();
  if (normalized.length > 180) {
    throw new ClientAccessValidationError(
      "Le nom du client doit contenir au plus 180 caractères."
    );
  }
  return normalized;
}

function normalizeApprovalInput(input: ApproveClientInput): ApproveClientInput {
  const email = normalizeClientEmail(input.email);
  if (!email || !isValidClientEmail(email)) {
    throw new ClientAccessValidationError("L’adresse courriel est invalide.");
  }
  return {
    email,
    name: normalizeName(input.name),
    courseIds: normalizeCourseIds(input.courseIds),
  };
}

function normalizeUpdateInput(input: UpdateClientInput): UpdateClientInput {
  if (!isValidClientId(input.id)) {
    throw new ClientAccessValidationError(
      "L’identifiant du client est invalide."
    );
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 1) {
    throw new ClientAccessValidationError(
      "La révision du client est invalide."
    );
  }
  return {
    id: input.id.trim(),
    revision: input.revision,
    name: normalizeName(input.name),
    courseIds: normalizeCourseIds(input.courseIds),
  };
}

function isValidClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 64
  );
}

async function assertAssignableCourses(
  db: ClientQueryExecutor,
  courseIds: string[]
): Promise<void> {
  if (courseIds.length === 0) return;

  const courses = await db
    .select({ id: contentCourses.id })
    .from(contentCourses)
    .where(
      and(
        inArray(contentCourses.id, courseIds),
        isNull(contentCourses.archivedAt)
      )
    );
  const availableIds = new Set(courses.map(course => course.id));
  if (courseIds.some(courseId => !availableIds.has(courseId))) {
    throw new ClientAccessValidationError(
      "Le ou les cours sélectionnés sont introuvables ou archivés."
    );
  }
}

async function assertClientRevisionState(
  db: ClientQueryExecutor,
  id: string
): Promise<never> {
  const [client] = await db
    .select({ id: coachingClients.id })
    .from(coachingClients)
    .where(eq(coachingClients.id, id))
    .limit(1);
  if (!client) throw new ClientAccessNotFoundError();
  throw new ClientAccessConflictError();
}

function assertAdminActorId(createdBy: number): void {
  if (!Number.isSafeInteger(createdBy) || createdBy < 1) {
    throw new ClientAccessValidationError(
      "Le compte administrateur est invalide."
    );
  }
}

/**
 * Adds one client approval and its explicitly supplied course assignments.
 * An approval may never overwrite an existing (including revoked) email and
 * cannot be created for an address on the administrator allowlist.
 */
export async function approveClient(
  createdBy: number,
  rawInput: ApproveClientInput
): Promise<string> {
  assertAdminActorId(createdBy);
  const input = normalizeApprovalInput(rawInput);
  const db = await requireDb();

  return db.transaction(async tx => {
    const [administrator] = await tx
      .select({ email: adminAccess.email })
      .from(adminAccess)
      .where(eq(adminAccess.email, input.email))
      .limit(1);
    if (administrator) {
      throw new ClientAccessValidationError(
        "Une adresse administrateur ne peut pas être approuvée comme cliente."
      );
    }

    const [existing] = await tx
      .select({ id: coachingClients.id })
      .from(coachingClients)
      .where(eq(coachingClients.email, input.email))
      .limit(1);
    if (existing) {
      throw new ClientAccessConflictError(
        "Cette adresse courriel a déjà une approbation client."
      );
    }

    await assertAssignableCourses(tx, input.courseIds);

    const id = nanoid(21);
    const now = new Date();
    await tx.insert(coachingClients).values({
      id,
      email: input.email,
      name: input.name,
      status: "active",
      revision: 1,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
    if (input.courseIds.length > 0) {
      await tx
        .insert(clientCourseAccess)
        .values(
          input.courseIds.map(courseId => ({
            clientId: id,
            courseId,
            createdAt: now,
          }))
        );
    }
    return id;
  });
}

/** Replaces explicit assignments and updates the client name with optimistic revision control. */
export async function updateClient(rawInput: UpdateClientInput): Promise<void> {
  const input = normalizeUpdateInput(rawInput);
  const db = await requireDb();

  await db.transaction(async tx => {
    await assertAssignableCourses(tx, input.courseIds);
    const result = await tx
      .update(coachingClients)
      .set({
        name: input.name,
        revision: sql`${coachingClients.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coachingClients.id, input.id),
          eq(coachingClients.revision, input.revision)
        )
      );
    if (affectedRows(result) === 0) {
      await assertClientRevisionState(tx, input.id);
      return;
    }

    await tx
      .delete(clientCourseAccess)
      .where(eq(clientCourseAccess.clientId, input.id));
    if (input.courseIds.length > 0) {
      const now = new Date();
      await tx.insert(clientCourseAccess).values(
        input.courseIds.map(courseId => ({
          clientId: input.id,
          courseId,
          createdAt: now,
        }))
      );
    }
  });
}

/** Changes authorization status without removing assignments, so reactivation restores them. */
export async function setClientStatus(
  rawInput: SetClientStatusInput
): Promise<void> {
  if (!isValidClientId(rawInput.id)) {
    throw new ClientAccessValidationError(
      "L’identifiant du client est invalide."
    );
  }
  if (!Number.isSafeInteger(rawInput.revision) || rawInput.revision < 1) {
    throw new ClientAccessValidationError(
      "La révision du client est invalide."
    );
  }
  if (rawInput.status !== "active" && rawInput.status !== "revoked") {
    throw new ClientAccessValidationError("Le statut du client est invalide.");
  }

  const db = await requireDb();
  await db.transaction(async tx => {
    const result = await tx
      .update(coachingClients)
      .set({
        status: rawInput.status,
        revision: sql`${coachingClients.revision} + 1`,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(coachingClients.id, rawInput.id.trim()),
          eq(coachingClients.revision, rawInput.revision)
        )
      );
    if (affectedRows(result) === 0) {
      await assertClientRevisionState(tx, rawInput.id.trim());
    }
  });
}
