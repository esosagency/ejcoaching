import { describe, expect, it } from "vitest";
import type { LearningSnapshot } from "@shared/learning";
import {
  makeLegacyLearningImport,
  mergeSnapshotWithPendingFields,
  recordsByLesson,
} from "./learningState";

const snapshot: LearningSnapshot = {
  accountKey: "client_abc",
  lastLessonId: "lesson-a",
  records: [
    {
      lessonId: "lesson-a",
      completed: false,
      saved: true,
      note: "Version serveur",
      noteRevision: 3,
      lastViewedAt: "2026-10-31T12:00:00.000Z",
      updatedAt: "2026-10-31T12:00:00.000Z",
    },
  ],
};

describe("learning state helpers", () => {
  it("indexes server records by their stable lesson identifier", () => {
    expect(recordsByLesson(snapshot.records)["lesson-a"]?.noteRevision).toBe(3);
  });

  it("keeps an optimistic explicit boolean during an incoming refresh", () => {
    const merged = mergeSnapshotWithPendingFields(snapshot, {
      "lesson-a": { completed: true },
      "lesson-b": { saved: true },
    });

    expect(merged["lesson-a"]).toMatchObject({
      completed: true,
      saved: true,
      note: "Version serveur",
      noteRevision: 3,
    });
    expect(merged["lesson-b"]).toMatchObject({
      completed: false,
      saved: true,
      noteRevision: 0,
    });
  });

  it("filters and bounds a local import before it reaches the API", () => {
    const imported = makeLegacyLearningImport({
      accountKey: "client_abc",
      completedIds: ["lesson-a", "lesson-a", "not-visible"],
      savedIds: ["lesson-b", "not-visible"],
      notes: [
        { lessonId: "lesson-a", note: "À revoir" },
        { lessonId: "lesson-a", note: "doublon ignoré" },
        { lessonId: "not-visible", note: "ignorée" },
      ],
      lastLessonId: "not-visible",
      validLessonIds: new Set(["lesson-a", "lesson-b"]),
      maxItems: 2,
      maxNoteTotalLength: 10,
    });

    expect(imported).toEqual({
      accountKey: "client_abc",
      completedIds: ["lesson-a"],
      savedIds: ["lesson-b"],
      notes: [{ lessonId: "lesson-a", note: "À revoir" }],
      lastLessonId: null,
    });
  });
});
