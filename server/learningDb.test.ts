import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { clientLessonProgress } from "../drizzle/schema";
import type { CodeClientIdentity } from "../shared/codeAccess";

const dbMock = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("./db", () => dbMock);

import {
  LearningConflictError,
  importLocal,
  reset,
  saveNote,
  setCompleted,
  snapshot,
} from "./learningDb";

const client: CodeClientIdentity = {
  id: "client-unit",
  name: "Client unité",
  email: null,
  codeVersion: 4,
};
const now = new Date("2026-11-01T17:00:00.000Z");

function progressRow(
  overrides: Partial<{
    lessonId: string;
    completed: boolean;
    saved: boolean;
    note: string;
    noteRevision: number;
    lastViewedAt: Date | null;
    updatedAt: Date;
  }> = {}
) {
  return {
    lessonId: "lesson-1",
    completed: false,
    saved: false,
    note: "",
    noteRevision: 0,
    lastViewedAt: null,
    updatedAt: now,
    ...overrides,
  };
}

function queryReturning(rows: unknown[], forUpdate: ReturnType<typeof vi.fn>) {
  const query: Record<string, ReturnType<typeof vi.fn>> & {
    then?: PromiseLike<unknown[]>["then"];
  } = {
    from: vi.fn(),
    innerJoin: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    for: vi.fn(),
  };
  query.from.mockReturnValue(query);
  query.innerJoin.mockReturnValue(query);
  query.where.mockReturnValue(query);
  query.orderBy.mockReturnValue(query);
  query.limit.mockReturnValue(query);
  query.for.mockImplementation(lock => {
    forUpdate(lock);
    return query;
  });
  query.then = (resolve, reject) => Promise.resolve(rows).then(resolve, reject);
  return query;
}

function createDb(
  selectResults: unknown[][] = [],
  updateResults: unknown[] = []
) {
  // This deliberately loose fake models only the Drizzle call surface used by
  // this module; it never has a connection or a real database import behind it.
  const insertValues: any = vi.fn();
  const onDuplicateKeyUpdate: any = vi
    .fn()
    .mockResolvedValue([{ affectedRows: 1 }]);
  insertValues.mockReturnValue({ onDuplicateKeyUpdate });

  const forUpdate: any = vi.fn();
  const updateWhere: any = vi.fn(() =>
    Promise.resolve(updateResults.shift() ?? [{ affectedRows: 1 }])
  );
  const updateSet: any = vi.fn(() => ({ where: updateWhere }));

  const db = {
    select: vi.fn(() => queryReturning(selectResults.shift() ?? [], forUpdate)),
    insert: vi.fn(() => ({ values: insertValues })),
    update: vi.fn(() => ({ set: updateSet })),
    transaction: vi.fn(async (operation: (tx: typeof db) => Promise<unknown>) =>
      operation(db)
    ),
  };
  return {
    db,
    forUpdate,
    insertValues,
    onDuplicateKeyUpdate,
    updateSet,
    updateWhere,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("learningDb", () => {
  it("retourne uniquement les enregistrements visibles et choisit la visite la plus récente", async () => {
    const fixture = createDb([
      [{ id: client.id }],
      [
        progressRow({
          lessonId: "lesson-earlier",
          lastViewedAt: new Date("2026-11-01T10:00:00.000Z"),
        }),
        progressRow({
          lessonId: "lesson-latest",
          lastViewedAt: new Date("2026-11-01T11:00:00.000Z"),
        }),
        progressRow({
          lessonId: "lesson-z-tie",
          lastViewedAt: new Date("2026-11-01T11:00:00.000Z"),
        }),
      ],
    ]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(snapshot(client)).resolves.toEqual({
      accountKey: "client_client-unit",
      lastLessonId: "lesson-z-tie",
      records: [
        {
          lessonId: "lesson-earlier",
          completed: false,
          saved: false,
          note: "",
          noteRevision: 0,
          lastViewedAt: "2026-11-01T10:00:00.000Z",
          updatedAt: "2026-11-01T17:00:00.000Z",
        },
        {
          lessonId: "lesson-latest",
          completed: false,
          saved: false,
          note: "",
          noteRevision: 0,
          lastViewedAt: "2026-11-01T11:00:00.000Z",
          updatedAt: "2026-11-01T17:00:00.000Z",
        },
        {
          lessonId: "lesson-z-tie",
          completed: false,
          saved: false,
          note: "",
          noteRevision: 0,
          lastViewedAt: "2026-11-01T11:00:00.000Z",
          updatedAt: "2026-11-01T17:00:00.000Z",
        },
      ],
    });
    expect(dbMock.getDb).toHaveBeenCalledTimes(1);
    expect(fixture.forUpdate).not.toHaveBeenCalled();
  });

  it("écrit seulement le champ terminé et son horodatage", async () => {
    const fixture = createDb([
      [{ id: client.id }],
      [{ id: "lesson-1" }],
      [progressRow({ completed: true })],
    ]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      setCompleted(client, { lessonId: "lesson-1", completed: true })
    ).resolves.toMatchObject({ lessonId: "lesson-1", completed: true });

    expect(fixture.insertValues).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: client.id,
        lessonId: "lesson-1",
        completed: true,
        saved: false,
        note: "",
        noteRevision: 0,
      })
    );
    expect(fixture.onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: expect.objectContaining({
        completed: true,
        completedSetAt: expect.any(Date),
      }),
    });
    const duplicateSet = (
      fixture.onDuplicateKeyUpdate.mock.calls as Array<
        [{ set: Record<string, unknown> }]
      >
    )[0][0].set;
    expect(duplicateSet).not.toHaveProperty("saved");
    expect(duplicateSet).not.toHaveProperty("note");
    expect(duplicateSet).not.toHaveProperty("noteRevision");
    expect(fixture.forUpdate).toHaveBeenCalledTimes(2);
    expect(fixture.forUpdate).toHaveBeenNthCalledWith(1, "update");
    expect(fixture.forUpdate).toHaveBeenNthCalledWith(2, "update");
  });

  it("signale un conflit de révision de note sans faire une insertion de secours", async () => {
    const fixture = createDb(
      [[{ id: client.id }], [{ id: "lesson-1" }]],
      [[{ affectedRows: 0 }]]
    );
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      saveNote(client, {
        lessonId: "lesson-1",
        note: "Texte conservé dans le brouillon du navigateur.",
        expectedRevision: 2,
      })
    ).rejects.toBeInstanceOf(LearningConflictError);
    expect(fixture.insertValues).not.toHaveBeenCalled();
  });

  it("importe seulement les leçons encore visibles et ne remplace pas une visite serveur", async () => {
    const fixture = createDb([
      [{ id: client.id }],
      [],
      [{ id: "lesson-visible" }],
      [{ lessonId: "another-server-visit" }],
      [{ id: client.id }],
      [],
    ]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(
      importLocal(client, {
        completedIds: ["lesson-visible", "lesson-hidden"],
        savedIds: ["lesson-visible"],
        notes: [
          { lessonId: "lesson-visible", note: "Note locale" },
          { lessonId: "lesson-hidden", note: "Ne doit pas être écrite" },
        ],
        lastLessonId: "lesson-visible",
      })
    ).resolves.toEqual({
      accountKey: "client_client-unit",
      records: [],
      lastLessonId: null,
    });

    const importedLessonIds = (
      fixture.insertValues.mock.calls as Array<[{ lessonId: string }]>
    ).map(([value]) => value.lessonId);
    expect(importedLessonIds).toEqual([
      "lesson-visible",
      "lesson-visible",
      "lesson-visible",
    ]);
    expect(importedLessonIds).not.toContain("lesson-hidden");
    expect(fixture.forUpdate).toHaveBeenCalledTimes(2);
    expect(fixture.forUpdate).toHaveBeenNthCalledWith(1, "update");
    expect(fixture.forUpdate).toHaveBeenNthCalledWith(2, "update");
  });

  it("importe une note existante avec un UPDATE atomiquement gardé", async () => {
    const fixture = createDb([
      [{ id: client.id }],
      [],
      [{ id: "lesson-visible" }],
      [{ id: client.id }],
      [],
    ]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await importLocal(client, {
      completedIds: [],
      savedIds: [],
      notes: [{ lessonId: "lesson-visible", note: "Note locale protégée" }],
      lastLessonId: null,
    });

    expect(fixture.onDuplicateKeyUpdate).toHaveBeenCalledWith({
      set: expect.objectContaining({ clientId: expect.anything() }),
    });
    expect(fixture.updateSet).toHaveBeenLastCalledWith(
      expect.objectContaining({
        note: "Note locale protégée",
        noteRevision: 1,
        updatedAt: expect.any(Date),
      })
    );
    expect(fixture.updateWhere).toHaveBeenLastCalledWith(
      and(
        eq(clientLessonProgress.clientId, client.id),
        eq(clientLessonProgress.lessonId, "lesson-visible"),
        eq(clientLessonProgress.noteRevision, 0),
        eq(clientLessonProgress.note, "")
      )
    );
  });

  it("réinitialise les états sans modifier les notes ni leur révision", async () => {
    const fixture = createDb([[{ id: client.id }], [{ id: client.id }], []]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await expect(reset(client)).resolves.toEqual({
      accountKey: "client_client-unit",
      records: [],
      lastLessonId: null,
    });

    expect(fixture.updateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        completed: false,
        saved: false,
        completedSetAt: expect.any(Date),
        savedSetAt: expect.any(Date),
        lastViewedAt: null,
      })
    );
    const resetSet = (
      fixture.updateSet.mock.calls as Array<[Record<string, unknown>]>
    )[0][0];
    expect(resetSet).not.toHaveProperty("note");
    expect(resetSet).not.toHaveProperty("noteRevision");
  });

  it("le tombstone de réinitialisation bloque les anciens états absents, mais laisse la note conservatrice", async () => {
    const fixture = createDb([
      [{ id: client.id }],
      [{ id: client.id }],
      [],
      [{ id: client.id }],
      [{ clientId: client.id }],
      [{ id: "lesson-visible" }],
      [{ id: client.id }],
      [],
    ]);
    dbMock.getDb.mockResolvedValue(fixture.db);

    await reset(client);
    const insertsBeforeLegacyImport = fixture.insertValues.mock.calls.length;

    await importLocal(client, {
      completedIds: ["lesson-visible"],
      savedIds: ["lesson-visible"],
      notes: [{ lessonId: "lesson-visible", note: "Note locale retenue" }],
      lastLessonId: "lesson-visible",
    });

    expect(fixture.insertValues).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        clientId: client.id,
        lastResetAt: expect.any(Date),
      })
    );
    const legacyImportValues = (
      fixture.insertValues.mock.calls as Array<[Record<string, unknown>]>
    )
      .slice(insertsBeforeLegacyImport)
      .map(([value]) => value);
    expect(legacyImportValues).toEqual([
      expect.objectContaining({
        clientId: client.id,
        lessonId: "lesson-visible",
        completed: false,
        saved: false,
        note: "Note locale retenue",
        noteRevision: 1,
      }),
    ]);
    expect(legacyImportValues[0]).not.toHaveProperty("lastViewedAt");
  });
});
