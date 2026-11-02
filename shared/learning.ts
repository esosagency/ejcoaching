export const MAX_LEARNING_NOTE_LENGTH = 10_000;
export const MAX_LEGACY_LEARNING_ITEMS = 1_000;
export const MAX_LEGACY_NOTE_TOTAL_LENGTH = 100_000;

export type ClientLearningRecord = {
  lessonId: string;
  completed: boolean;
  saved: boolean;
  note: string;
  noteRevision: number;
  lastViewedAt: string | null;
  updatedAt: string;
};

export type LearningSnapshot = {
  accountKey: string;
  records: ClientLearningRecord[];
  lastLessonId: string | null;
};

export type LearningAccountInput = { accountKey: string };
export type LearningLessonInput = LearningAccountInput & { lessonId: string };
export type SetCompletedInput = LearningLessonInput & { completed: boolean };
export type SetSavedInput = LearningLessonInput & { saved: boolean };
export type SaveLearningNoteInput = LearningLessonInput & {
  note: string;
  expectedRevision: number;
};
export type LegacyLearningImport = LearningAccountInput & {
  completedIds: string[];
  savedIds: string[];
  notes: Array<{ lessonId: string; note: string }>;
  lastLessonId?: string | null;
};
