import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientCodeSessions, coachingClients } from "../drizzle/schema";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => dbMock);

import {
  CLIENT_SESSION_TTL_MS,
  createCodeVerifier,
  disableClientCode,
  formatClientCode,
  generateClientCode,
  getClientAttemptFingerprint,
  hashClientSessionToken,
  hashCodeLookup,
  issueClientCode,
  normalizeClientCode,
  verifyCodeVerifier,
} from "./clientCodes";

function transactionDb() {
  const clientWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  const sessionWhere = vi.fn().mockResolvedValue([{ affectedRows: 1 }]);
  const clientSet = vi.fn((_values: unknown) => ({ where: clientWhere }));
  const sessionSet = vi.fn(() => ({ where: sessionWhere }));
  const updates = [clientSet, sessionSet];
  const tables = [coachingClients, clientCodeSessions];
  const tx = {
    update: vi.fn((table: unknown) => {
      expect(table).toBe(tables.shift());
      const set = updates.shift();
      if (!set) throw new Error("update inattendu");
      return { set };
    }),
    select: vi.fn(),
    insert: vi.fn(),
    delete: vi.fn(),
  };
  const db = {
    transaction: vi.fn((operation: (value: typeof tx) => unknown) =>
      operation(tx)
    ),
  };
  return { db, tx, clientWhere, sessionWhere, clientSet };
}

beforeEach(() => vi.clearAllMocks());

describe("personal client code primitives", () => {
  it("garde la même portée malgré des User-Agent ou forwarded headers arbitraires", () => {
    const base = {
      ip: "127.0.0.1",
      socket: { remoteAddress: "127.0.0.1" },
      headers: { "user-agent": "A" },
    };
    const changed = {
      ...base,
      headers: { "user-agent": "B", "x-forwarded-for": "198.51.100.2" },
    };
    expect(getClientAttemptFingerprint(base as never)).toBe(
      getClientAttemptFingerprint(changed as never)
    );
    expect(getClientAttemptFingerprint(base as never)).not.toContain(
      "127.0.0.1"
    );
  });

  it("génère uniquement le format EJ lisible non ambigu et normalise les séparateurs", () => {
    const code = generateClientCode();
    expect(code).toMatch(
      /^EJ-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u
    );
    const normalized = normalizeClientCode(
      ` ${code.toLowerCase().replaceAll("-", " ")} `
    );
    expect(normalized).toBe(code.replaceAll("-", ""));
    expect(formatClientCode(normalized ?? "")).toBe(code);
    expect(normalizeClientCode("EJ-0000-OOOO-1111")).toBeNull();
    expect(normalizeClientCode("x".repeat(129))).toBeNull();
  });

  it("ne conserve qu’un vérificateur scrypt salé et compare les secrets en toute sécurité", async () => {
    const code = "EJ-ABCD-EFGH-JKLM";
    const normalized = normalizeClientCode(code);
    expect(normalized).not.toBeNull();
    const verifier = await createCodeVerifier(normalized ?? "");
    expect(verifier).toMatch(/^scrypt\$16384\$8\$1\$/u);
    expect(verifier).not.toContain(code);
    await expect(verifyCodeVerifier(normalized ?? "", verifier)).resolves.toBe(
      true
    );
    await expect(
      verifyCodeVerifier("EJ-ABCD-EFGH-JKLN", verifier)
    ).resolves.toBe(false);
    expect(hashCodeLookup(normalized ?? "")).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("hache les jetons de session opaques et conserve la durée contractuelle de 30 jours", () => {
    const token = "A".repeat(43);
    expect(hashClientSessionToken(token)).toMatch(/^[a-f0-9]{64}$/u);
    expect(hashClientSessionToken(token)).not.toBe(token);
    expect(CLIENT_SESSION_TTL_MS).toBe(30 * 24 * 60 * 60 * 1000);
  });

  it("émet/remplace un code et révoque les sessions dans une transaction isolée", async () => {
    const { db, tx, clientWhere, sessionWhere } = transactionDb();
    dbMock.getDb.mockResolvedValue(db);

    const issued = await issueClientCode({ id: "client-a", revision: 4 });

    expect(issued).toMatchObject({ id: "client-a", revision: 5 });
    expect(issued.code).toMatch(
      /^EJ-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}-[A-HJ-NP-Z2-9]{4}$/u
    );
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(clientWhere).toHaveBeenCalledTimes(1);
    expect(sessionWhere).toHaveBeenCalledTimes(1);
  });

  it("désactive le code et révoque les sessions dans la même transaction isolée", async () => {
    const { db, tx, clientWhere, sessionWhere, clientSet } = transactionDb();
    dbMock.getDb.mockResolvedValue(db);

    await expect(
      disableClientCode({ id: "client-a", revision: 5 })
    ).resolves.toEqual({
      id: "client-a",
      revision: 6,
    });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect(tx.update).toHaveBeenCalledTimes(2);
    expect(clientWhere).toHaveBeenCalledTimes(1);
    expect(sessionWhere).toHaveBeenCalledTimes(1);
    expect(clientSet.mock.calls[0]?.[0]).not.toHaveProperty("codeIssuedAt");
    expect(clientSet.mock.calls[0]?.[0]).not.toHaveProperty("lastCodeLoginAt");
  });
});
