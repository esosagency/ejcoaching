import { and, asc, eq, inArray, isNull, sql, type SQL } from "drizzle-orm";
import { nanoid } from "nanoid";
import {
  clientCourseAccess,
  coachingClients,
  contentCourses,
  type User,
} from "../drizzle/schema";
import type { CodeClientIdentity } from "../shared/codeAccess";
import type { AccessInfo } from "../shared/clientAccess";
import { revokeClientSessions } from "./clientCodes";
import { getDb } from "./db";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/u;
const MAX_CLIENT_COURSES = 200;

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type ClientQueryExecutor = Pick<Database, "select">;

export type ClientManagementRow = {
  id: string;
  email: string | null;
  name: string;
  status: "active" | "revoked";
  revision: number;
  courseIds: string[];
  codeEnabled: boolean;
  codeIssuedAt: string | null;
  lastCodeLoginAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ApproveClientInput = {
  email?: string | null;
  name: string;
  courseIds: string[];
};

export type UpdateClientInput = {
  id: string;
  revision: number;
  name: string;
  courseIds: string[];
  /** Contact only; changing it never changes a login identity. */
  email?: string | null;
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

function isClientIdentity(
  client: CodeClientIdentity | null | undefined
): client is CodeClientIdentity {
  return Boolean(
    client &&
      isValidClientId(client.id) &&
      typeof client.name === "string" &&
      (client.email === null || typeof client.email === "string") &&
      Number.isSafeInteger(client.codeVersion) &&
      client.codeVersion >= 0
  );
}

/** Normalizes optional contact email consistently before writes. */
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

function accessUser(user: User): NonNullable<AccessInfo["user"]> {
  return {
    id: user.id,
    accountKey: String(user.id),
    name: user.name ?? "",
    email: normalizeClientEmail(user.email),
  };
}

function accessClient(
  client: CodeClientIdentity
): NonNullable<AccessInfo["user"]> {
  return {
    accountKey: `client_${client.id}`,
    name: client.name,
    email: client.email,
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

async function findActiveClientIdentity(
  db: ClientQueryExecutor,
  client: CodeClientIdentity
): Promise<CodeClientIdentity | null> {
  const [current] = await db
    .select({
      id: coachingClients.id,
      name: coachingClients.name,
      email: coachingClients.email,
      codeVersion: coachingClients.codeVersion,
    })
    .from(coachingClients)
    .where(
      and(
        eq(coachingClients.id, client.id),
        eq(coachingClients.status, "active"),
        eq(coachingClients.codeVersion, client.codeVersion)
      )
    )
    .limit(1);
  return current ?? null;
}

/**
 * Resolves authorization from the effective principal on every call. OAuth
 * users who are not real administrators are never upgraded through a contact
 * email; code-client status and codeVersion are always rechecked from MySQL.
 */
export async function getAccessForUser(
  user: User | null,
  client?: CodeClientIdentity | null
): Promise<AccessInfo> {
  if (isClientIdentity(client)) {
    const db = await requireDb();
    const current = await findActiveClientIdentity(db, client);
    if (!current) {
      return {
        authenticated: true,
        allowed: false,
        isAdmin: false,
        reason: "revoked",
        user: accessClient(client),
        clientId: client.id,
      };
    }
    return {
      authenticated: true,
      allowed: true,
      isAdmin: false,
      user: accessClient(current),
      clientId: current.id,
    };
  }

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

  return {
    authenticated: true,
    allowed: false,
    isAdmin: false,
    reason: "unapproved",
    user: userInfo,
  };
}

/** Returns only published, active courses visible to the current effective principal. */
export async function getAssignedCourseIds(
  user: User | null,
  client?: CodeClientIdentity | null
): Promise<string[]> {
  if (isClientIdentity(client)) {
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
          eq(coachingClients.id, client.id),
          eq(coachingClients.status, "active"),
          eq(coachingClients.codeVersion, client.codeVersion),
          isNull(contentCourses.archivedAt),
          eq(contentCourses.status, "published")
        )
      )
      .orderBy(asc(contentCourses.position), asc(contentCourses.id));
    return courses.map(course => course.id);
  }

  if (!isAuthenticatedUser(user) || user.role !== "admin") return [];
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

/**
 * Administrators may access any non-archived course, including drafts. Code
 * clients require current active status, matching codeVersion and an explicit
 * assignment to a published non-archived course.
 */
export async function canAccessCourse(
  user: User | null,
  courseId: string,
  client?: CodeClientIdentity | null
): Promise<boolean> {
  const normalizedCourseId =
    typeof courseId === "string" ? courseId.trim() : "";
  if (!isValidCourseId(normalizedCourseId)) return false;

  if (isClientIdentity(client)) {
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
          eq(coachingClients.id, client.id),
          eq(coachingClients.status, "active"),
          eq(coachingClients.codeVersion, client.codeVersion),
          eq(contentCourses.id, normalizedCourseId),
          isNull(contentCourses.archivedAt),
          eq(contentCourses.status, "published")
        )
      )
      .limit(1);
    return Boolean(course);
  }

  if (!isAuthenticatedUser(user) || user.role !== "admin") return false;
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

/** Returns client records for administration without code, session or hash material. */
export async function listClients(): Promise<ClientManagementRow[]> {
  const db = await requireDb();
  const clients = await db
    .select({
      id: coachingClients.id,
      email: coachingClients.email,
      name: coachingClients.name,
      status: coachingClients.status,
      revision: coachingClients.revision,
      codeLookupHash: coachingClients.codeLookupHash,
      codeVerifier: coachingClients.codeVerifier,
      codeIssuedAt: coachingClients.codeIssuedAt,
      lastCodeLoginAt: coachingClients.lastCodeLoginAt,
      createdAt: coachingClients.createdAt,
      updatedAt: coachingClients.updatedAt,
    })
    .from(coachingClients)
    .orderBy(asc(coachingClients.name), asc(coachingClients.id));

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
    codeEnabled: Boolean(client.codeLookupHash && client.codeVerifier),
    codeIssuedAt: client.codeIssuedAt ? toIso(client.codeIssuedAt) : null,
    lastCodeLoginAt: client.lastCodeLoginAt
      ? toIso(client.lastCodeLoginAt)
      : null,
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
  if (normalized.length === 0 || normalized.length > 180) {
    throw new ClientAccessValidationError(
      "Le nom du client doit contenir entre 1 et 180 caractères."
    );
  }
  return normalized;
}

function normalizeContactEmail(
  value: string | null | undefined
): string | null {
  const email = normalizeClientEmail(value);
  if (email && !isValidClientEmail(email)) {
    throw new ClientAccessValidationError("L’adresse courriel est invalide.");
  }
  return email;
}

function normalizeApprovalInput(
  input: ApproveClientInput
): Required<ApproveClientInput> {
  return {
    email: normalizeContactEmail(input.email),
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
  const normalized: UpdateClientInput = {
    id: input.id.trim(),
    revision: input.revision,
    name: normalizeName(input.name),
    courseIds: normalizeCourseIds(input.courseIds),
  };
  if (Object.prototype.hasOwnProperty.call(input, "email")) {
    normalized.email = normalizeContactEmail(input.email);
  }
  return normalized;
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

/** Adds a client and explicit assignments. Contact email is optional and never an identity. */
export async function approveClient(
  createdBy: number,
  rawInput: ApproveClientInput
): Promise<string> {
  assertAdminActorId(createdBy);
  const input = normalizeApprovalInput(rawInput);
  const db = await requireDb();

  return db.transaction(async tx => {
    await assertAssignableCourses(tx, input.courseIds);
    const id = nanoid(21);
    const now = new Date();
    await tx.insert(coachingClients).values({
      id,
      email: input.email,
      name: input.name,
      status: "active",
      revision: 1,
      codeVersion: 0,
      createdBy,
      createdAt: now,
      updatedAt: now,
    });
    if (input.courseIds.length > 0) {
      await tx.insert(clientCourseAccess).values(
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

/** Replaces assignments and contact/name with optimistic revision control. */
export async function updateClient(rawInput: UpdateClientInput): Promise<void> {
  const input = normalizeUpdateInput(rawInput);
  const db = await requireDb();

  await db.transaction(async tx => {
    await assertAssignableCourses(tx, input.courseIds);
    const changes: {
      name: string;
      revision: SQL;
      updatedAt: Date;
      email?: string | null;
    } = {
      name: input.name,
      revision: sql`${coachingClients.revision} + 1`,
      updatedAt: new Date(),
    };
    if (Object.prototype.hasOwnProperty.call(input, "email"))
      changes.email = input.email ?? null;
    const result = await tx
      .update(coachingClients)
      .set(changes)
      .where(
        and(
          eq(coachingClients.id, input.id),
          eq(coachingClients.revision, input.revision)
        )
      );
    if (affectedRows(result) === 0)
      await assertClientRevisionState(tx, input.id);

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

/**
 * Changes client authorization without removing assignments. Revoking advances
 * codeVersion and revokes sessions inside the same transaction, so later
 * reactivation can never revive an older opaque session.
 */
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
  const id = rawInput.id.trim();
  await db.transaction(async tx => {
    const now = new Date();
    const result = await tx
      .update(coachingClients)
      .set(
        rawInput.status === "revoked"
          ? {
              status: rawInput.status,
              codeVersion: sql`${coachingClients.codeVersion} + 1`,
              revision: sql`${coachingClients.revision} + 1`,
              updatedAt: now,
            }
          : {
              status: rawInput.status,
              revision: sql`${coachingClients.revision} + 1`,
              updatedAt: now,
            }
      )
      .where(
        and(
          eq(coachingClients.id, id),
          eq(coachingClients.revision, rawInput.revision)
        )
      );
    if (affectedRows(result) === 0) await assertClientRevisionState(tx, id);
    if (rawInput.status === "revoked") await revokeClientSessions(tx, id, now);
  });
}
