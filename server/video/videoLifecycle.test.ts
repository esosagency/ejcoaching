import { beforeEach, describe, expect, it, vi } from "vitest";
import { MySqlDialect } from "drizzle-orm/mysql-core";
import type { SQL } from "drizzle-orm";

const mocks = vi.hoisted(() => ({ getDb: vi.fn() }));
vi.mock("../db", () => ({ getDb: mocks.getDb }));

import { archiveCourse, archiveLesson } from "../contentDb";
import {
  cancelObsoleteClaimedVideoJob,
  cancelVideoJob,
  claimNextVideoJob,
  recoverExpiredVideoJobs,
  touchUploadingVideoJob,
} from "./videoDb";

type Update = { values: Record<string, unknown>; where?: SQL };
const dialect = new MySqlDialect();

function mockDatabase(rows: unknown[][] = []) {
  const updates: Update[] = [];
  const selects: Array<{ where?: SQL }> = [];
  const transaction = vi.fn();
  const database = {
    transaction,
    select: vi.fn(() => {
      const selection: { where?: SQL } = {};
      selects.push(selection);
      const builder = {
        from: () => builder,
        innerJoin: () => builder,
        where: (where: SQL) => {
          selection.where = where;
          return builder;
        },
        orderBy: () => builder,
        limit: async () => rows.shift() ?? [],
      };
      return builder;
    }),
    update: vi.fn(() => ({
      set: (values: Record<string, unknown>) => ({
        where: async (where: SQL) => {
          updates.push({ values, where });
          return [{ affectedRows: 1 }];
        },
      }),
    })),
  };
  transaction.mockImplementation((callback: (db: typeof database) => unknown) =>
    callback(database)
  );
  mocks.getDb.mockResolvedValue(database);
  return { updates, selects };
}

function query(where: SQL | undefined) {
  if (!where) throw new Error("Expected a guarded SQL condition.");
  return dialect.sqlToQuery(where);
}

beforeEach(() => vi.clearAllMocks());

describe("phone video lifecycle safety (isolated, no database writes)", () => {
  it("can cancel a failed upload without replacing its previous playable video", async () => {
    const row = {
      id: "failed_job",
      lessonId: "lesson_one",
      ownerUserId: 22,
      sourceUploadId: "source_upload",
      status: "failed",
      progress: 0,
      filename: "IMG_1000.MOV",
      error: "Cette vidéo est corrompue.",
      durationSeconds: null,
    };
    const state = mockDatabase([[row], [{ ...row, status: "cancelled" }]]);
    const result = await cancelVideoJob(row.id, row.ownerUserId);
    expect(result.status).toBe("cancelled");
    expect(state.updates[0].values).toMatchObject({
      status: "cancelled",
      leaseToken: null,
    });
    expect(query(state.updates[0].where).params).toContain("failed");
    expect(state.updates[1].values).toHaveProperty("videoJobId", null);
    expect(state.updates[1].values).not.toHaveProperty("videoUrl");
    expect(query(state.updates[1].where).params).toContain("failed_job");
  });

  it("fences obsolete completion cancellation by the exact lease and current lesson state", async () => {
    const state = mockDatabase();
    await cancelObsoleteClaimedVideoJob("old_job", "old_lease");
    const condition = query(state.updates[0].where);
    expect(condition.params).toContain("old_lease");
    expect(condition.sql).toMatch(/leaseToken/);
    expect(condition.sql).toMatch(/not\s*\(exists/i);
    expect(condition.sql).toMatch(/videoJobId/);
    expect(condition.sql).toMatch(/archivedAt/);
  });

  it("claims only current non-archived lessons on the supported pipeline version", async () => {
    const state = mockDatabase([[]]);
    expect(await claimNextVideoJob("worker_one")).toBeNull();
    const condition = query(state.selects[0].where);
    expect(condition.sql).toMatch(/videoJobId/);
    expect(condition.sql).toMatch(/archivedAt/);
    expect(condition.sql).toMatch(/pipelineVersion/);
    expect(condition.params).toContain(1);
  });

  it("terminates obsolete queued or processing work before exhausted-lease recovery", async () => {
    const state = mockDatabase();
    await recoverExpiredVideoJobs();
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0].values.status).toBe("cancelled");
    expect(query(state.updates[0].where).sql).toMatch(/not\s*\(exists/i);
    expect(state.updates[1].values.status).toBe("failed");
  });

  it("expires inactive source transfers with an atomic time guard and exact lesson pointer", async () => {
    const state = mockDatabase([
      [{ id: "abandoned_upload", lessonId: "lesson_one" }],
    ]);
    await recoverExpiredVideoJobs();
    const cutoff = query(state.selects[0].where);
    expect(cutoff.sql).toMatch(/updatedAt/);
    expect(cutoff.params).toContain("uploading");
    expect(state.updates[0].values.status).toBe("cancelled");
    expect(query(state.updates[0].where).sql).toMatch(/updatedAt/);
    expect(state.updates[1].values.videoJobId).toBeNull();
    expect(state.updates[1].values).not.toHaveProperty("videoUrl");
    expect(query(state.updates[1].where).params).toContain("abandoned_upload");
  });

  it("refreshes only the current owner’s uploading job without editing the lesson", async () => {
    const state = mockDatabase();
    expect(await touchUploadingVideoJob("upload_one", 22)).toBe(true);
    const condition = query(state.updates[0].where);
    expect(condition.params).toContain(22);
    expect(condition.params).toContain("uploading");
    expect(state.updates[0].values).not.toHaveProperty("videoUrl");
  });

  it("archives a course and cancels its outstanding video work in the same transaction", async () => {
    const state = mockDatabase();
    await archiveCourse("course_one", 7);
    expect(state.updates).toHaveLength(3);
    expect(state.updates[0].values).toHaveProperty("archivedAt");
    expect(state.updates[1].values.status).toBe("cancelled");
    expect(query(state.updates[1].where).params).toContain("course_one");
    expect(state.updates[2].values.videoJobId).toBeNull();
    expect(state.updates[2].values).not.toHaveProperty("videoUrl");
  });

  it("archives a lesson and fences all of its unfinished recordings", async () => {
    const state = mockDatabase();
    await archiveLesson("course_one", "lesson_one", 3);
    expect(state.updates).toHaveLength(2);
    expect(state.updates[0].values.videoJobId).toBeNull();
    expect(state.updates[1].values.status).toBe("cancelled");
    expect(query(state.updates[1].where).params).toContain("lesson_one");
  });
});
