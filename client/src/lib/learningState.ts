import {
  MAX_LEARNING_NOTE_LENGTH,
  type ClientLearningRecord,
  type LegacyLearningImport,
  type LearningSnapshot,
} from "@shared/learning";

export type LearningRecordMap = Record<string, ClientLearningRecord>;

export type RecordPatch = Partial<
  Pick<ClientLearningRecord, "completed" | "saved" | "lastViewedAt">
>;

const emptyRecord = (lessonId: string): ClientLearningRecord => ({
  lessonId,
  completed: false,
  saved: false,
  note: "",
  noteRevision: 0,
  lastViewedAt: null,
  updatedAt: "",
});

export function recordsByLesson(
  records: ClientLearningRecord[]
): LearningRecordMap {
  return records.reduce<LearningRecordMap>((result, record) => {
    result[record.lessonId] = record;
    return result;
  }, {});
}

export function patchLearningRecord(
  records: LearningRecordMap,
  lessonId: string,
  patch: RecordPatch
): LearningRecordMap {
  return {
    ...records,
    [lessonId]: {
      ...(records[lessonId] ?? emptyRecord(lessonId)),
      ...patch,
    },
  };
}

export function replaceLearningRecord(
  records: LearningRecordMap,
  record: ClientLearningRecord
): LearningRecordMap {
  return { ...records, [record.lessonId]: record };
}

/**
 * Keep only browser data that can be sent to the conservative server import.
 * Visibility is still re-checked by the server; the client-side filter avoids
 * carrying old, unrelated lesson identifiers across account changes.
 */
export function makeLegacyLearningImport({
  accountKey,
  completedIds,
  savedIds,
  notes,
  lastLessonId,
  validLessonIds,
  maxItems,
  maxNoteTotalLength,
}: {
  accountKey: string;
  completedIds: string[];
  savedIds: string[];
  notes: Array<{ lessonId: string; note: string }>;
  lastLessonId: string | null;
  validLessonIds: Set<string>;
  maxItems: number;
  maxNoteTotalLength: number;
}): LegacyLearningImport {
  const cleanIds = (ids: string[]) =>
    [...new Set(ids)].filter(id => validLessonIds.has(id)).slice(0, maxItems);

  let remainingNoteCharacters = maxNoteTotalLength;
  const cleanNotes: LegacyLearningImport["notes"] = [];
  const includedNotes = new Set<string>();

  for (const item of notes) {
    if (
      includedNotes.has(item.lessonId) ||
      !validLessonIds.has(item.lessonId) ||
      typeof item.note !== "string" ||
      remainingNoteCharacters <= 0 ||
      cleanNotes.length >= maxItems
    ) {
      continue;
    }

    const note = item.note.slice(
      0,
      Math.min(MAX_LEARNING_NOTE_LENGTH, remainingNoteCharacters)
    );
    includedNotes.add(item.lessonId);
    remainingNoteCharacters -= note.length;
    cleanNotes.push({ lessonId: item.lessonId, note });
  }

  return {
    accountKey,
    completedIds: cleanIds(completedIds),
    savedIds: cleanIds(savedIds),
    notes: cleanNotes,
    lastLessonId:
      lastLessonId && validLessonIds.has(lastLessonId) ? lastLessonId : null,
  };
}

/** Applies an incoming snapshot without discarding optimistic boolean fields. */
export function mergeSnapshotWithPendingFields(
  snapshot: LearningSnapshot,
  pending: Record<string, RecordPatch>
): LearningRecordMap {
  let records = recordsByLesson(snapshot.records);
  for (const [lessonId, patch] of Object.entries(pending)) {
    records = patchLearningRecord(records, lessonId, patch);
  }
  return records;
}
