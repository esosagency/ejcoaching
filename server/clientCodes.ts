import {
  createHash,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { parse as parseCookieHeader } from "cookie";
import type { Request, Response } from "express";
import {
  clientCodeAttempts,
  clientCodeSessions,
  coachingClients,
} from "../drizzle/schema";
import type { CodeClientIdentity } from "../shared/codeAccess";
import { getSessionCookieOptions } from "./_core/cookies";
import { getDb } from "./db";

export const CLIENT_SESSION_COOKIE = "ej_client_session";
export const CLIENT_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

const CODE_PREFIX = "EJ";
const CODE_GROUP_LENGTH = 4;
const CODE_GROUPS = 3;
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_RAW_CODE_LENGTH = 128;
const SESSION_TOKEN_BYTES = 32;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const ATTEMPT_BLOCK_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS_PER_WINDOW = 8;
const SCRYPT_N = 16_384;
const SCRYPT_R = 8;
const SCRYPT_P = 1;
const SCRYPT_KEY_LENGTH = 64;

export class ClientCodeNotFoundError extends Error {
  constructor() {
    super("Client introuvable.");
    this.name = "ClientCodeNotFoundError";
  }
}

export class ClientCodeConflictError extends Error {
  constructor(
    message = "Ce client a été modifié par une autre personne. Rechargez la page et réessayez."
  ) {
    super(message);
    this.name = "ClientCodeConflictError";
  }
}

export class ClientCodeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClientCodeValidationError";
  }
}

export class ClientCodeDatabaseUnavailableError extends Error {
  constructor() {
    super("La base de données des codes clients est indisponible.");
    this.name = "ClientCodeDatabaseUnavailableError";
  }
}

type Database = NonNullable<Awaited<ReturnType<typeof getDb>>>;
type QueryExecutor = Pick<Database, "select">;
type SessionMutationExecutor = Pick<Database, "update">;

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object") {
    return 0;
  }
  const value = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" ? value : 0;
}

async function requireDb(): Promise<Database> {
  const db = await getDb();
  if (!db) throw new ClientCodeDatabaseUnavailableError();
  return db;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Normalizes display variants (case, spaces, hyphens) to a canonical secret. */
export function normalizeClientCode(value: unknown): string | null {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_RAW_CODE_LENGTH
  ) {
    return null;
  }
  const compact = value.toUpperCase().replace(/[\s-]/gu, "");
  const expectedLength = CODE_PREFIX.length + CODE_GROUP_LENGTH * CODE_GROUPS;
  if (compact.length !== expectedLength || !compact.startsWith(CODE_PREFIX)) {
    return null;
  }
  const body = compact.slice(CODE_PREFIX.length);
  if (![...body].every(character => CODE_ALPHABET.includes(character))) {
    return null;
  }
  return compact;
}

/** Formats an already-normalized code solely for its one-time admin display. */
export function formatClientCode(normalizedCode: string): string {
  const code = normalizeClientCode(normalizedCode);
  if (!code)
    throw new ClientCodeValidationError("Le code personnel est invalide.");
  const body = code.slice(CODE_PREFIX.length);
  const groups = Array.from({ length: CODE_GROUPS }, (_, index) =>
    body.slice(index * CODE_GROUP_LENGTH, (index + 1) * CODE_GROUP_LENGTH)
  );
  return [CODE_PREFIX, ...groups].join("-");
}

/** Creates a random, readable personal code. It is never written without hashing. */
export function generateClientCode(): string {
  let body = "";
  while (body.length < CODE_GROUP_LENGTH * CODE_GROUPS) {
    const byte = randomBytes(1)[0] ?? 0;
    // Rejection sampling avoids modulo bias across the non-ambiguous alphabet.
    const limit = 256 - (256 % CODE_ALPHABET.length);
    if (byte >= limit) continue;
    body += CODE_ALPHABET[byte % CODE_ALPHABET.length];
  }
  return formatClientCode(`${CODE_PREFIX}${body}`);
}

export function hashCodeLookup(normalizedCode: string): string {
  return sha256(normalizedCode);
}

export function hashClientSessionToken(token: string): string {
  return sha256(token);
}

function deriveScrypt(value: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    nodeScrypt(
      value,
      salt,
      SCRYPT_KEY_LENGTH,
      {
        N: SCRYPT_N,
        r: SCRYPT_R,
        p: SCRYPT_P,
        maxmem: 32 * 1024 * 1024,
      },
      (error, derivedKey) => {
        if (error) reject(error);
        else resolve(derivedKey as Buffer);
      }
    );
  });
}

/** Creates the salted scrypt record persisted in coachingClients.codeVerifier. */
export async function createCodeVerifier(
  normalizedCode: string
): Promise<string> {
  const code = normalizeClientCode(normalizedCode);
  if (!code)
    throw new ClientCodeValidationError("Le code personnel est invalide.");
  const salt = randomBytes(16);
  const derived = await deriveScrypt(code, salt);
  return [
    "scrypt",
    String(SCRYPT_N),
    String(SCRYPT_R),
    String(SCRYPT_P),
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/** Performs a constant-time salted scrypt verification without parsing untrusted parameters. */
export async function verifyCodeVerifier(
  normalizedCode: string,
  serializedVerifier: string | null | undefined
): Promise<boolean> {
  const code = normalizeClientCode(normalizedCode);
  if (!code || typeof serializedVerifier !== "string") return false;
  const parts = serializedVerifier.split("$");
  if (
    parts.length !== 6 ||
    parts[0] !== "scrypt" ||
    parts[1] !== String(SCRYPT_N) ||
    parts[2] !== String(SCRYPT_R) ||
    parts[3] !== String(SCRYPT_P)
  ) {
    return false;
  }

  try {
    const salt = Buffer.from(parts[4] ?? "", "base64url");
    const expected = Buffer.from(parts[5] ?? "", "base64url");
    if (salt.length !== 16 || expected.length !== SCRYPT_KEY_LENGTH)
      return false;
    const actual = await deriveScrypt(code, salt);
    return timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

function isClientId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.trim().length <= 64
  );
}

function isRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1;
}

async function assertRevisionConflict(
  db: QueryExecutor,
  id: string
): Promise<never> {
  const [client] = await db
    .select({ id: coachingClients.id })
    .from(coachingClients)
    .where(eq(coachingClients.id, id))
    .limit(1);
  if (!client) throw new ClientCodeNotFoundError();
  throw new ClientCodeConflictError();
}

/** Revokes all active opaque sessions within the caller's surrounding transaction. */
export async function revokeClientSessions(
  db: SessionMutationExecutor,
  clientId: string,
  now = new Date()
): Promise<void> {
  await db
    .update(clientCodeSessions)
    .set({ revokedAt: now })
    .where(
      and(
        eq(clientCodeSessions.clientId, clientId),
        isNull(clientCodeSessions.revokedAt)
      )
    );
}

function isDuplicateEntryError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const code = (error as { code?: unknown }).code;
  return code === "ER_DUP_ENTRY" || code === "ER_DUP_ENTRY_WITH_KEY_NAME";
}

export type IssueClientCodeInput = { id: string; revision: number };

/**
 * Replaces an existing code atomically. The formatted secret is returned once,
 * only to the successful admin mutation caller; no persistence DTO includes it.
 */
export async function issueClientCode(
  rawInput: IssueClientCodeInput
): Promise<{ id: string; revision: number; code: string }> {
  if (!isClientId(rawInput.id) || !isRevision(rawInput.revision)) {
    throw new ClientCodeValidationError(
      "Les informations du client sont invalides."
    );
  }
  const db = await requireDb();

  // A unique lookup collision is astronomically unlikely; retry rather than
  // weakening the unique database invariant or exposing the collision.
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const code = generateClientCode();
    const normalizedCode = normalizeClientCode(code);
    if (!normalizedCode)
      throw new ClientCodeValidationError("Le code personnel est invalide.");
    const codeLookupHash = hashCodeLookup(normalizedCode);
    const codeVerifier = await createCodeVerifier(normalizedCode);
    const now = new Date();

    try {
      const result = await db.transaction(async tx => {
        const update = await tx
          .update(coachingClients)
          .set({
            codeLookupHash,
            codeVerifier,
            codeVersion: sql`${coachingClients.codeVersion} + 1`,
            codeIssuedAt: now,
            lastCodeLoginAt: null,
            revision: sql`${coachingClients.revision} + 1`,
            updatedAt: now,
          })
          .where(
            and(
              eq(coachingClients.id, rawInput.id.trim()),
              eq(coachingClients.revision, rawInput.revision)
            )
          );
        if (affectedRows(update) === 0) {
          await assertRevisionConflict(tx, rawInput.id.trim());
        }
        await revokeClientSessions(tx, rawInput.id.trim(), now);
        return {
          id: rawInput.id.trim(),
          revision: rawInput.revision + 1,
          code,
        };
      });
      return result;
    } catch (error) {
      if (isDuplicateEntryError(error) && attempt < 3) continue;
      throw error;
    }
  }

  throw new ClientCodeConflictError(
    "Impossible de générer un code personnel. Réessayez."
  );
}

/** Disables the current code and invalidates every client session atomically. */
export async function disableClientCode(
  rawInput: IssueClientCodeInput
): Promise<{ id: string; revision: number }> {
  if (!isClientId(rawInput.id) || !isRevision(rawInput.revision)) {
    throw new ClientCodeValidationError(
      "Les informations du client sont invalides."
    );
  }
  const db = await requireDb();
  const id = rawInput.id.trim();
  const now = new Date();

  return db.transaction(async tx => {
    const update = await tx
      .update(coachingClients)
      .set({
        codeLookupHash: null,
        codeVerifier: null,
        codeVersion: sql`${coachingClients.codeVersion} + 1`,
        revision: sql`${coachingClients.revision} + 1`,
        updatedAt: now,
      })
      .where(
        and(
          eq(coachingClients.id, id),
          eq(coachingClients.revision, rawInput.revision)
        )
      );
    if (affectedRows(update) === 0) await assertRevisionConflict(tx, id);
    await revokeClientSessions(tx, id, now);
    return { id, revision: rawInput.revision + 1 };
  });
}

function isOpaqueSessionToken(value: string): boolean {
  return /^[A-Za-z0-9_-]{40,96}$/u.test(value);
}

/** Resolves a client principal only if the persisted session and code generation remain current. */
export async function authenticateClientSession(
  token: string
): Promise<CodeClientIdentity | null> {
  if (!isOpaqueSessionToken(token)) return null;
  const db = await requireDb();
  const [session] = await db
    .select({
      id: coachingClients.id,
      name: coachingClients.name,
      email: coachingClients.email,
      codeVersion: coachingClients.codeVersion,
    })
    .from(clientCodeSessions)
    .innerJoin(
      coachingClients,
      eq(clientCodeSessions.clientId, coachingClients.id)
    )
    .where(
      and(
        eq(clientCodeSessions.tokenHash, hashClientSessionToken(token)),
        eq(coachingClients.status, "active"),
        eq(clientCodeSessions.codeVersion, coachingClients.codeVersion),
        isNull(clientCodeSessions.revokedAt),
        gt(clientCodeSessions.expiresAt, new Date())
      )
    )
    .limit(1);
  return session ?? null;
}

function attemptScopeHash(scope: string): string {
  return sha256(`ej-client-code-attempt-v1\u0000${scope}`);
}

/**
 * Produces a non-reversible, bounded attempt scope. It deliberately does not
 * trust forwarded headers supplied by arbitrary clients and stores no raw IP.
 */
export function getClientAttemptFingerprint(req: Request): string {
  const ip =
    typeof req.ip === "string" && req.ip.length > 0
      ? req.ip
      : (req.socket.remoteAddress ?? "unknown");
  // User-Agent and forwarded headers are caller-controlled and cannot reset the limit.
  return sha256(`ej-client-attempt-v2\u0000${ip}`);
}

async function isAttemptBlocked(
  db: QueryExecutor,
  scopeHash: string,
  now: Date
): Promise<boolean> {
  const [attempt] = await db
    .select({ blockedUntil: clientCodeAttempts.blockedUntil })
    .from(clientCodeAttempts)
    .where(eq(clientCodeAttempts.scopeHash, scopeHash))
    .limit(1);
  return Boolean(
    attempt?.blockedUntil && attempt.blockedUntil.getTime() > now.getTime()
  );
}

/** Uses a single MySQL upsert to persist failed attempts safely across requests. */
async function recordFailedAttempt(
  db: Pick<Database, "insert">,
  scopeHash: string,
  now: Date
): Promise<void> {
  const windowStart = new Date(now.getTime() - ATTEMPT_WINDOW_MS);
  const blockUntil = new Date(now.getTime() + ATTEMPT_BLOCK_MS);
  await db
    .insert(clientCodeAttempts)
    .values({
      scopeHash,
      windowStartedAt: now,
      attempts: 1,
      blockedUntil: null,
      updatedAt: now,
    })
    .onDuplicateKeyUpdate({
      set: {
        windowStartedAt: sql`CASE
          WHEN ${clientCodeAttempts.blockedUntil} IS NOT NULL AND ${clientCodeAttempts.blockedUntil} > ${now} THEN ${clientCodeAttempts.windowStartedAt}
          WHEN ${clientCodeAttempts.windowStartedAt} < ${windowStart} THEN ${now}
          ELSE ${clientCodeAttempts.windowStartedAt}
        END`,
        attempts: sql`CASE
          WHEN ${clientCodeAttempts.blockedUntil} IS NOT NULL AND ${clientCodeAttempts.blockedUntil} > ${now} THEN ${clientCodeAttempts.attempts}
          WHEN ${clientCodeAttempts.windowStartedAt} < ${windowStart} THEN 1
          ELSE ${clientCodeAttempts.attempts} + 1
        END`,
        blockedUntil: sql`CASE
          WHEN ${clientCodeAttempts.blockedUntil} IS NOT NULL AND ${clientCodeAttempts.blockedUntil} > ${now} THEN ${clientCodeAttempts.blockedUntil}
          WHEN ${clientCodeAttempts.windowStartedAt} < ${windowStart} THEN NULL
          WHEN ${clientCodeAttempts.attempts} + 1 >= ${MAX_ATTEMPTS_PER_WINDOW} THEN ${blockUntil}
          ELSE NULL
        END`,
        updatedAt: now,
      },
    });
}

/**
 * Checks a code and creates a 30-day opaque session in the same transaction as
 * the last-login update. Failure, disabled code, revocation and rate limiting
 * all return null to keep the login response generic.
 */
export async function loginWithClientCode(
  rawCode: unknown,
  fingerprint: string
): Promise<string | null> {
  const normalizedCode = normalizeClientCode(rawCode);
  const scopeHash = attemptScopeHash(fingerprint);
  const db = await requireDb();
  const now = new Date();

  return db.transaction(async tx => {
    if (await isAttemptBlocked(tx, scopeHash, now)) return null;

    const lookupHash = normalizedCode ? hashCodeLookup(normalizedCode) : null;
    const [client] = lookupHash
      ? await tx
          .select({
            id: coachingClients.id,
            codeVersion: coachingClients.codeVersion,
            codeVerifier: coachingClients.codeVerifier,
          })
          .from(coachingClients)
          .where(
            and(
              eq(coachingClients.codeLookupHash, lookupHash),
              eq(coachingClients.status, "active")
            )
          )
          .limit(1)
      : [];

    const verified = Boolean(
      client &&
        normalizedCode &&
        (await verifyCodeVerifier(normalizedCode, client.codeVerifier))
    );
    if (!client || !verified || !lookupHash) {
      await recordFailedAttempt(tx, scopeHash, now);
      return null;
    }

    const token = randomBytes(SESSION_TOKEN_BYTES).toString("base64url");
    const expiresAt = new Date(now.getTime() + CLIENT_SESSION_TTL_MS);
    const update = await tx
      .update(coachingClients)
      .set({ lastCodeLoginAt: now, updatedAt: now })
      .where(
        and(
          eq(coachingClients.id, client.id),
          eq(coachingClients.status, "active"),
          eq(coachingClients.codeVersion, client.codeVersion),
          eq(coachingClients.codeLookupHash, lookupHash)
        )
      );
    if (affectedRows(update) === 0) return null;

    await tx.insert(clientCodeSessions).values({
      tokenHash: hashClientSessionToken(token),
      clientId: client.id,
      codeVersion: client.codeVersion,
      expiresAt,
      revokedAt: null,
      createdAt: now,
    });
    // A correct login clears earlier failures for this anonymized scope. This
    // is intentionally inside the same transaction as the session creation.
    await tx
      .delete(clientCodeAttempts)
      .where(eq(clientCodeAttempts.scopeHash, scopeHash));
    return token;
  });
}

export function getClientSessionToken(req: Request): string | null {
  const cookies = parseCookieHeader(req.headers.cookie ?? "");
  const token = cookies[CLIENT_SESSION_COOKIE];
  return typeof token === "string" && token.length > 0 ? token : null;
}

/** Revokes only the opaque session presented by the current browser. */
export async function revokeClientSessionToken(
  token: string | null
): Promise<void> {
  if (!token || !isOpaqueSessionToken(token)) return;
  const db = await requireDb();
  await db
    .update(clientCodeSessions)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(clientCodeSessions.tokenHash, hashClientSessionToken(token)),
        isNull(clientCodeSessions.revokedAt)
      )
    );
}

export async function logoutClientRequest(req: Request): Promise<void> {
  await revokeClientSessionToken(getClientSessionToken(req));
}

export function setClientSessionCookie(
  req: Request,
  res: Response,
  token: string
): void {
  res.cookie(CLIENT_SESSION_COOKIE, token, {
    ...getSessionCookieOptions(req),
    maxAge: CLIENT_SESSION_TTL_MS,
  });
}

export function clearClientSessionCookie(req: Request, res: Response): void {
  res.clearCookie(CLIENT_SESSION_COOKIE, {
    ...getSessionCookieOptions(req),
    maxAge: -1,
  });
}
