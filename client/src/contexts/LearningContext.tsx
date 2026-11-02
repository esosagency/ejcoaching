import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { skipToken } from "@tanstack/react-query";
import {
  MAX_LEGACY_LEARNING_ITEMS,
  MAX_LEGACY_NOTE_TOTAL_LENGTH,
  MAX_LEARNING_NOTE_LENGTH,
  type ClientLearningRecord,
  type LearningSnapshot,
} from "@shared/learning";
import { trpc } from "@/lib/trpc";
import { useCatalog } from "./CatalogContext";
import { useAccess } from "./AccessContext";
import { accountStorageKey, readAccountStorage } from "@/lib/accountStorage";
import {
  makeLegacyLearningImport,
  mergeSnapshotWithPendingFields,
  patchLearningRecord,
  recordsByLesson,
  replaceLearningRecord,
  type LearningRecordMap,
  type RecordPatch,
} from "@/lib/learningState";
import type { Course } from "@shared/content";

export type LearningPersistence = "client-cloud" | "admin-local" | "preview";
export type LearningSyncStatus =
  | "local"
  | "loading"
  | "saving"
  | "synced"
  | "error";
export type LessonAction = "completed" | "saved" | "visit";
export type LessonNoteStatus =
  | "local"
  | "saved"
  | "dirty"
  | "saving"
  | "error"
  | "conflict";

type LessonNote = {
  text: string;
  revision: number;
  status: LessonNoteStatus;
  error: string | null;
  serverVersion?: { text: string; revision: number };
};

type NoteDraft = LessonNote & {
  acknowledgedText: string;
  expectedRevision: number;
};

type LocalProgress = {
  completed: string[];
  saved: string[];
  lastLesson: string;
};

type LearningState = {
  completed: string[];
  saved: string[];
  lastLesson: string;
  /** `client-cloud` is server-authoritative; admin practice stays browser-local. */
  persistence: LearningPersistence;
  loading: boolean;
  isSaving: boolean;
  syncStatus: LearningSyncStatus;
  syncError: string | null;
  retrySync: () => void;
  isLessonActionPending: (lessonId: string, action: LessonAction) => boolean;
  toggleComplete: (id: string) => void;
  toggleSaved: (id: string) => void;
  visitLesson: (id: string) => void;
  courseProgress: (course: Course) => number;
  resetProgress: () => Promise<void>;
  noteForLesson: (lessonId: string) => LessonNote;
  setNoteDraft: (lessonId: string, note: string) => void;
  saveNote: (lessonId: string) => Promise<void>;
  resolveNoteConflict: (lessonId: string, choice: "keep" | "load") => void;
};

const LearningContext = createContext<LearningState | null>(null);

function errorMessage(error: unknown, fallback: string) {
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

function isConflictError(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof (error as { data?: { code?: unknown } }).data?.code === "string" &&
    (error as { data: { code: string } }).data.code === "CONFLICT"
  );
}

function readList(key: string, legacy: string | undefined, owner: boolean) {
  try {
    const value: unknown = JSON.parse(
      readAccountStorage(key, legacy, owner) || "[]"
    );
    return Array.isArray(value)
      ? [
          ...new Set(
            value.filter(
              (id): id is string =>
                typeof id === "string" && id.length > 0 && id.length <= 128
            )
          ),
        ]
      : [];
  } catch {
    return [];
  }
}

function readLocalProgress(
  accountKey: string | undefined,
  owner: boolean
): LocalProgress {
  const completedKey = accountStorageKey(accountKey, "completed");
  const savedKey = accountStorageKey(accountKey, "saved");
  const lastKey = accountStorageKey(accountKey, "last");
  return {
    completed: readList(completedKey, "ej-demo-completed", owner),
    saved: readList(savedKey, "ej-demo-saved", owner),
    lastLesson: readAccountStorage(lastKey, "ej-demo-last", owner) || "",
  };
}

function readLocalNotes(
  accountKey: string | undefined,
  lessonIds: Iterable<string>,
  owner: boolean
) {
  const notes: Record<string, string> = {};
  for (const lessonId of lessonIds) {
    const key = accountStorageKey(accountKey, `notes-${lessonId}`);
    const legacy = `ej-demo-notes-${lessonId}`;
    const note = readAccountStorage(key, legacy, owner);
    if (note) notes[lessonId] = note.slice(0, MAX_LEARNING_NOTE_LENGTH);
  }
  return notes;
}

function updateLocalList(items: string[], id: string, enabled: boolean) {
  if (enabled) return items.includes(id) ? items : [...items, id];
  return items.filter(item => item !== id);
}

function removePendingField(
  fields: Record<string, RecordPatch>,
  lessonId: string,
  field: "completed" | "saved" | "lastViewedAt"
) {
  const current = fields[lessonId];
  if (!current) return fields;
  const { [field]: _removed, ...remaining } = current;
  if (!Object.keys(remaining).length) {
    const { [lessonId]: _lessonRemoved, ...rest } = fields;
    return rest;
  }
  return { ...fields, [lessonId]: remaining };
}

function hasPendingField(
  fields: Record<string, RecordPatch>,
  lessonId: string,
  field: "completed" | "saved" | "lastViewedAt"
) {
  return Object.prototype.hasOwnProperty.call(fields[lessonId] ?? {}, field);
}

function addPendingField(
  fields: Record<string, RecordPatch>,
  lessonId: string,
  field: "completed" | "saved" | "lastViewedAt",
  value: boolean | string | null
) {
  return {
    ...fields,
    [lessonId]: { ...fields[lessonId], [field]: value },
  };
}

export function LearningProvider({ children }: { children: ReactNode }) {
  const { courses, isAdminPreview, loading: catalogLoading } = useCatalog();
  const { access } = useAccess();
  const accountKey = access?.user?.accountKey;
  const owner = Boolean(access?.isAdmin);
  const isCodeClient = Boolean(
    !isAdminPreview && !owner && accountKey && accountKey.startsWith("client_")
  );
  const persistence: LearningPersistence = isAdminPreview
    ? "preview"
    : isCodeClient
      ? "client-cloud"
      : "admin-local";
  const validIds = useMemo(
    () =>
      new Set(
        courses.flatMap(course => course.lessons.map(lesson => lesson.id))
      ),
    [courses]
  );
  const validIdsKey = useMemo(
    () => [...validIds].sort().join("\u0000"),
    [validIds]
  );
  const snapshotInput = isCodeClient && accountKey ? { accountKey } : undefined;

  // The learning namespace is registered by the integration owner with the
  // shared input/output contracts from shared/learning.ts.
  const utils = trpc.useUtils();
  const {
    data: snapshotData,
    error: snapshotError,
    isPending: isSnapshotPending,
    refetch: refetchSnapshot,
  } = trpc.learning.snapshot.useQuery(snapshotInput ?? skipToken, {
    enabled: Boolean(snapshotInput),
    retry: false,
    staleTime: 0,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  });
  const { mutateAsync: setCompleted } =
    trpc.learning.setCompleted.useMutation();
  const { mutateAsync: setSaved } = trpc.learning.setSaved.useMutation();
  const { mutateAsync: visit } = trpc.learning.visit.useMutation();
  const { mutateAsync: saveRemoteNote } = trpc.learning.saveNote.useMutation();
  const { mutateAsync: importLocal } = trpc.learning.importLocal.useMutation();
  const { mutateAsync: resetRemoteProgress } =
    trpc.learning.reset.useMutation();

  const [localProgress, setLocalProgress] = useState<LocalProgress>(() =>
    readLocalProgress(accountKey, owner)
  );
  const [localNotes, setLocalNotes] = useState<Record<string, string>>({});
  const [cloudRecords, setCloudRecords] = useState<LearningRecordMap>({});
  const [cloudLastLesson, setCloudLastLesson] = useState("");
  const [pendingFields, setPendingFields] = useState<
    Record<string, RecordPatch>
  >({});
  const [pendingLastLesson, setPendingLastLesson] = useState<string | null>(
    null
  );
  const [noteDrafts, setNoteDrafts] = useState<Record<string, NoteDraft>>({});
  const [pendingCount, setPendingCount] = useState(0);
  const [localSyncError, setLocalSyncError] = useState<string | null>(null);

  const accountKeyRef = useRef(accountKey);
  const validIdsRef = useRef(validIds);
  const cloudRecordsRef = useRef(cloudRecords);
  const noteDraftsRef = useRef(noteDrafts);
  const pendingFieldsRef = useRef(pendingFields);
  const pendingLastLessonRef = useRef(pendingLastLesson);
  const retryActionRef = useRef<(() => void) | null>(null);
  const migrationAttemptedRef = useRef<string | null>(null);
  const noteSaveInFlightRef = useRef(new Set<string>());
  const persistNoteRef = useRef<(lessonId: string) => Promise<void>>(
    async () => {
      // Assigned after persistNote is defined.
    }
  );

  const setPendingField = useCallback(
    (
      lessonId: string,
      field: "completed" | "saved" | "lastViewedAt",
      value: boolean | string | null
    ) => {
      const next = addPendingField(
        pendingFieldsRef.current,
        lessonId,
        field,
        value
      );
      pendingFieldsRef.current = next;
      setPendingFields(next);
    },
    []
  );
  const clearPendingField = useCallback(
    (lessonId: string, field: "completed" | "saved" | "lastViewedAt") => {
      const next = removePendingField(
        pendingFieldsRef.current,
        lessonId,
        field
      );
      pendingFieldsRef.current = next;
      setPendingFields(next);
    },
    []
  );
  const updateNoteDrafts = useCallback(
    (
      update: (current: Record<string, NoteDraft>) => Record<string, NoteDraft>
    ) => {
      const next = update(noteDraftsRef.current);
      noteDraftsRef.current = next;
      setNoteDrafts(next);
    },
    []
  );

  useEffect(() => {
    accountKeyRef.current = accountKey;
    validIdsRef.current = validIds;
  }, [accountKey, validIds]);
  useEffect(() => {
    cloudRecordsRef.current = cloudRecords;
  }, [cloudRecords]);
  useEffect(() => {
    noteDraftsRef.current = noteDrafts;
  }, [noteDrafts]);
  useEffect(() => {
    pendingFieldsRef.current = pendingFields;
  }, [pendingFields]);
  useEffect(() => {
    pendingLastLessonRef.current = pendingLastLesson;
  }, [pendingLastLesson]);

  useEffect(() => {
    setLocalSyncError(null);
    retryActionRef.current = null;
    setPendingCount(0);
    setPendingFields({});
    setPendingLastLesson(null);
    setNoteDrafts({});
    pendingFieldsRef.current = {};
    noteDraftsRef.current = {};
    noteSaveInFlightRef.current.clear();
    setCloudRecords({});
    setCloudLastLesson("");
    migrationAttemptedRef.current = null;
    if (persistence !== "client-cloud") {
      setLocalProgress(readLocalProgress(accountKey, owner));
      setLocalNotes(readLocalNotes(accountKey, validIds, owner));
    }
  }, [accountKey, owner, persistence]); // valid IDs load separately below.

  useEffect(() => {
    if (persistence !== "admin-local") return;
    setLocalNotes(readLocalNotes(accountKey, validIds, owner));
  }, [accountKey, owner, persistence, validIdsKey]);

  useEffect(() => {
    if (persistence !== "admin-local") return;
    try {
      localStorage.setItem(
        accountStorageKey(accountKey, "completed"),
        JSON.stringify(localProgress.completed)
      );
      localStorage.setItem(
        accountStorageKey(accountKey, "saved"),
        JSON.stringify(localProgress.saved)
      );
      localStorage.setItem(
        accountStorageKey(accountKey, "last"),
        localProgress.lastLesson
      );
    } catch {
      // Browser storage remains best-effort for administrator practice data.
    }
  }, [accountKey, localProgress, persistence]);

  useEffect(() => {
    if (!isCodeClient || !snapshotData || !accountKey) return;
    if (snapshotData.accountKey !== accountKey) return;
    const pending = pendingFieldsRef.current;
    setCloudRecords(mergeSnapshotWithPendingFields(snapshotData, pending));
    setCloudLastLesson(
      pendingLastLessonRef.current || snapshotData.lastLessonId || ""
    );
  }, [accountKey, isCodeClient, snapshotData]);

  const setSnapshot = useCallback(
    (snapshot: LearningSnapshot) => {
      if (!accountKey || snapshot.accountKey !== accountKey) return;
      setCloudRecords(
        mergeSnapshotWithPendingFields(snapshot, pendingFieldsRef.current)
      );
      setCloudLastLesson(
        pendingLastLessonRef.current || snapshot.lastLessonId || ""
      );
      utils.learning.snapshot.setData({ accountKey }, snapshot);
    },
    [accountKey, utils]
  );

  const refreshSnapshot = useCallback(() => {
    if (!isCodeClient) return;
    void refetchSnapshot();
  }, [isCodeClient, refetchSnapshot]);

  useEffect(() => {
    if (!isCodeClient || typeof window === "undefined") return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === "visible") refreshSnapshot();
    };
    const refreshWhenOnline = () => refreshSnapshot();
    window.addEventListener("focus", refreshWhenVisible);
    window.addEventListener("online", refreshWhenOnline);
    document.addEventListener("visibilitychange", refreshWhenVisible);
    return () => {
      window.removeEventListener("focus", refreshWhenVisible);
      window.removeEventListener("online", refreshWhenOnline);
      document.removeEventListener("visibilitychange", refreshWhenVisible);
    };
  }, [isCodeClient, refreshSnapshot]);

  const runLegacyImport = useCallback(
    async (force = false) => {
      if (!isCodeClient || !accountKey || !snapshotData || catalogLoading)
        return;
      const marker = accountStorageKey(
        accountKey,
        "learning-cloud-migrated-v1"
      );
      try {
        if (!force && localStorage.getItem(marker) === "1") return;
      } catch {
        // A failed marker write means the safe, idempotent server import may
        // occur again in this browser; server-side guards still preserve data.
      }
      if (!force && migrationAttemptedRef.current === accountKey) return;
      migrationAttemptedRef.current = accountKey;
      setPendingCount(count => count + 1);
      setLocalSyncError(null);
      const localProgress = readLocalProgress(accountKey, false);
      const importForAccount = makeLegacyLearningImport({
        accountKey,
        completedIds: localProgress.completed,
        savedIds: localProgress.saved,
        notes: Object.entries(
          readLocalNotes(accountKey, validIdsRef.current, false)
        ).map(([lessonId, note]) => ({ lessonId, note })),
        lastLessonId: localProgress.lastLesson || null,
        validLessonIds: validIdsRef.current,
        maxItems: MAX_LEGACY_LEARNING_ITEMS,
        maxNoteTotalLength: MAX_LEGACY_NOTE_TOTAL_LENGTH,
      });
      try {
        const snapshot = await importLocal(importForAccount);
        if (accountKeyRef.current !== accountKey) return;
        setSnapshot(snapshot);
        try {
          localStorage.setItem(marker, "1");
        } catch {
          // Do not claim a migration marker when storage is unavailable.
        }
      } catch (error) {
        if (accountKeyRef.current !== accountKey) return;
        const message = errorMessage(
          error,
          "Impossible d’importer la progression de ce navigateur pour le moment."
        );
        setLocalSyncError(message);
        retryActionRef.current = () => {
          void runLegacyImport(true);
        };
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
      }
    },
    [
      accountKey,
      catalogLoading,
      importLocal,
      isCodeClient,
      setSnapshot,
      snapshotData,
    ]
  );

  useEffect(() => {
    if (!isCodeClient || !snapshotData || !accountKey || catalogLoading) return;
    void runLegacyImport();
  }, [accountKey, catalogLoading, isCodeClient, runLegacyImport, snapshotData]);

  const applyServerRecord = useCallback(
    (record: ClientLearningRecord) => {
      const pendingPatch = pendingFieldsRef.current[record.lessonId];
      const recordWithPendingFields = pendingPatch
        ? { ...record, ...pendingPatch }
        : record;
      setCloudRecords(records =>
        replaceLearningRecord(records, recordWithPendingFields)
      );
      if (!accountKey) return;
      utils.learning.snapshot.setData(
        { accountKey },
        (current: LearningSnapshot | undefined) => {
          if (!current) return current;
          return {
            ...current,
            records: [
              ...current.records.filter(
                (item: ClientLearningRecord) =>
                  item.lessonId !== record.lessonId
              ),
              record,
            ],
          };
        }
      );
    },
    [accountKey, utils]
  );

  const mutateBoolean = useCallback(
    async (lessonId: string, field: "completed" | "saved", value: boolean) => {
      if (!isCodeClient || !accountKey || !validIdsRef.current.has(lessonId))
        return;
      if (hasPendingField(pendingFieldsRef.current, lessonId, field)) return;
      const before = cloudRecordsRef.current[lessonId]?.[field] ?? false;
      setPendingField(lessonId, field, value);
      setCloudRecords(records =>
        patchLearningRecord(records, lessonId, { [field]: value })
      );
      setPendingCount(count => count + 1);
      setLocalSyncError(null);
      try {
        const record =
          field === "completed"
            ? await setCompleted({
                accountKey,
                lessonId,
                completed: value,
              })
            : await setSaved({
                accountKey,
                lessonId,
                saved: value,
              });
        if (accountKeyRef.current !== accountKey) return;
        applyServerRecord(record);
        clearPendingField(lessonId, field);
        refreshSnapshot();
      } catch (error) {
        if (accountKeyRef.current !== accountKey) return;
        setCloudRecords(records => {
          const current = records[lessonId];
          return current?.[field] === value
            ? patchLearningRecord(records, lessonId, { [field]: before })
            : records;
        });
        clearPendingField(lessonId, field);
        const message = errorMessage(
          error,
          "Impossible d’enregistrer ce changement. Vérifie ta connexion et réessaie."
        );
        setLocalSyncError(message);
        retryActionRef.current = () => {
          void mutateBoolean(lessonId, field, value);
        };
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
      }
    },
    [
      accountKey,
      applyServerRecord,
      clearPendingField,
      isCodeClient,
      refreshSnapshot,
      setCompleted,
      setPendingField,
      setSaved,
    ]
  );

  const visitRemoteLesson = useCallback(
    async (lessonId: string) => {
      if (!isCodeClient || !accountKey || !validIdsRef.current.has(lessonId))
        return;
      if (hasPendingField(pendingFieldsRef.current, lessonId, "lastViewedAt"))
        return;
      setPendingField(lessonId, "lastViewedAt", new Date().toISOString());
      setPendingLastLesson(lessonId);
      setCloudLastLesson(lessonId);
      setPendingCount(count => count + 1);
      try {
        const record = await visit({
          accountKey,
          lessonId,
        });
        if (accountKeyRef.current !== accountKey) return;
        applyServerRecord(record);
        clearPendingField(lessonId, "lastViewedAt");
        if (pendingLastLessonRef.current === lessonId)
          setPendingLastLesson(null);
        refreshSnapshot();
      } catch (error) {
        if (accountKeyRef.current !== accountKey) return;
        clearPendingField(lessonId, "lastViewedAt");
        if (pendingLastLessonRef.current === lessonId)
          setPendingLastLesson(null);
        const message = errorMessage(
          error,
          "Impossible de mettre à jour la dernière leçon. Réessaie lorsque la connexion sera rétablie."
        );
        setLocalSyncError(message);
        retryActionRef.current = () => {
          void visitRemoteLesson(lessonId);
        };
        refreshSnapshot();
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
      }
    },
    [
      accountKey,
      applyServerRecord,
      clearPendingField,
      isCodeClient,
      refreshSnapshot,
      setPendingField,
      visit,
    ]
  );

  const persistNote = useCallback(
    async (lessonId: string) => {
      if (!isCodeClient || !accountKey || !validIdsRef.current.has(lessonId))
        return;
      const saveKey = `${accountKey}\u0000${lessonId}`;
      if (noteSaveInFlightRef.current.has(saveKey)) return;
      const draft = noteDraftsRef.current[lessonId];
      if (
        !draft ||
        draft.status === "saving" ||
        draft.status === "conflict" ||
        draft.text === draft.acknowledgedText
      ) {
        return;
      }
      const submittedText = draft.text;
      const expectedRevision = draft.expectedRevision;
      noteSaveInFlightRef.current.add(saveKey);
      updateNoteDrafts(current => {
        const existing = current[lessonId];
        if (!existing || existing.text !== submittedText) return current;
        return {
          ...current,
          [lessonId]: { ...existing, status: "saving", error: null },
        };
      });
      setPendingCount(count => count + 1);
      setLocalSyncError(null);
      try {
        const record = await saveRemoteNote({
          accountKey,
          lessonId,
          note: submittedText,
          expectedRevision,
        });
        if (accountKeyRef.current !== accountKey) return;
        applyServerRecord(record);
        updateNoteDrafts(current => {
          const existing = current[lessonId];
          if (!existing) return current;
          if (
            existing.text === submittedText &&
            existing.expectedRevision === expectedRevision
          ) {
            const { [lessonId]: _acknowledged, ...remaining } = current;
            return remaining;
          }
          return {
            ...current,
            [lessonId]: {
              ...existing,
              acknowledgedText: record.note,
              expectedRevision: record.noteRevision,
              revision: record.noteRevision,
              status: "dirty",
              error: null,
              serverVersion: undefined,
            },
          };
        });
        refreshSnapshot();
      } catch (error) {
        if (accountKeyRef.current !== accountKey) return;
        let serverRecord = cloudRecordsRef.current[lessonId];
        if (isConflictError(error)) {
          try {
            const refreshed = await refetchSnapshot();
            if (refreshed.data?.accountKey === accountKey) {
              setSnapshot(refreshed.data);
              serverRecord = recordsByLesson(refreshed.data.records)[lessonId];
            }
          } catch {
            // Keep the user's text even if the recovery read also fails.
          }
        }
        updateNoteDrafts(current => {
          const existing = current[lessonId];
          if (!existing) return current;
          if (isConflictError(error)) {
            return {
              ...current,
              [lessonId]: {
                ...existing,
                status: "conflict",
                error:
                  "Une version plus récente de cette note existe. Choisis la version à conserver.",
                serverVersion: {
                  text: serverRecord?.note ?? "",
                  revision:
                    serverRecord?.noteRevision ?? existing.expectedRevision,
                },
              },
            };
          }
          return {
            ...current,
            [lessonId]: {
              ...existing,
              status: "error",
              error: errorMessage(
                error,
                "La note n’a pas été enregistrée. Ton texte est conservé ici."
              ),
            },
          };
        });
        if (!isConflictError(error)) {
          const message = errorMessage(
            error,
            "La note n’a pas été enregistrée. Ton texte est conservé ici."
          );
          setLocalSyncError(message);
          retryActionRef.current = () => {
            void persistNote(lessonId);
          };
        }
      } finally {
        setPendingCount(count => Math.max(0, count - 1));
        noteSaveInFlightRef.current.delete(saveKey);
        const latestDraft = noteDraftsRef.current[lessonId];
        if (
          accountKeyRef.current === accountKey &&
          latestDraft?.status === "dirty" &&
          latestDraft.text !== latestDraft.acknowledgedText
        ) {
          queueMicrotask(() => {
            void persistNoteRef.current(lessonId);
          });
        }
      }
    },
    [
      accountKey,
      applyServerRecord,
      isCodeClient,
      refreshSnapshot,
      refetchSnapshot,
      saveRemoteNote,
      setSnapshot,
      updateNoteDrafts,
    ]
  );

  persistNoteRef.current = persistNote;

  useEffect(() => {
    if (persistence !== "client-cloud") return;
    const hasDirtyDraft = Object.values(noteDrafts).some(
      draft => draft.status === "dirty" && draft.text !== draft.acknowledgedText
    );
    if (!hasDirtyDraft) return;
    const timeout = window.setTimeout(() => {
      for (const [lessonId, draft] of Object.entries(noteDraftsRef.current)) {
        if (draft.status === "dirty" && draft.text !== draft.acknowledgedText) {
          void persistNote(lessonId);
        }
      }
    }, 800);
    return () => window.clearTimeout(timeout);
  }, [noteDrafts, persistence, persistNote]);

  const completed = useMemo(() => {
    const values =
      persistence === "client-cloud"
        ? Object.values(cloudRecords)
            .filter(record => record.completed)
            .map(record => record.lessonId)
        : localProgress.completed;
    return values.filter(id => validIds.has(id));
  }, [cloudRecords, localProgress.completed, persistence, validIds]);
  const saved = useMemo(() => {
    const values =
      persistence === "client-cloud"
        ? Object.values(cloudRecords)
            .filter(record => record.saved)
            .map(record => record.lessonId)
        : localProgress.saved;
    return values.filter(id => validIds.has(id));
  }, [cloudRecords, localProgress.saved, persistence, validIds]);
  const lastLesson = useMemo(() => {
    const remembered =
      persistence === "client-cloud"
        ? cloudLastLesson
        : localProgress.lastLesson;
    return validIds.has(remembered)
      ? remembered
      : courses.flatMap(course => course.lessons)[0]?.id || "";
  }, [
    cloudLastLesson,
    courses,
    localProgress.lastLesson,
    persistence,
    validIds,
  ]);

  const toggleComplete = useCallback(
    (lessonId: string) => {
      if (!validIdsRef.current.has(lessonId) || persistence === "preview")
        return;
      if (persistence === "client-cloud") {
        const next = !(cloudRecordsRef.current[lessonId]?.completed ?? false);
        void mutateBoolean(lessonId, "completed", next);
        return;
      }
      setLocalProgress(current => ({
        ...current,
        completed: updateLocalList(
          current.completed,
          lessonId,
          !current.completed.includes(lessonId)
        ),
      }));
    },
    [mutateBoolean, persistence]
  );

  const toggleSaved = useCallback(
    (lessonId: string) => {
      if (!validIdsRef.current.has(lessonId) || persistence === "preview")
        return;
      if (persistence === "client-cloud") {
        const next = !(cloudRecordsRef.current[lessonId]?.saved ?? false);
        void mutateBoolean(lessonId, "saved", next);
        return;
      }
      setLocalProgress(current => ({
        ...current,
        saved: updateLocalList(
          current.saved,
          lessonId,
          !current.saved.includes(lessonId)
        ),
      }));
    },
    [mutateBoolean, persistence]
  );

  const visitLesson = useCallback(
    (lessonId: string) => {
      if (!validIdsRef.current.has(lessonId) || persistence === "preview")
        return;
      if (persistence === "client-cloud") {
        void visitRemoteLesson(lessonId);
        return;
      }
      setLocalProgress(current => ({ ...current, lastLesson: lessonId }));
    },
    [persistence, visitRemoteLesson]
  );

  const courseProgress = useCallback(
    (course: Course) =>
      course.lessons.length
        ? Math.round(
            (course.lessons.filter(lesson => completed.includes(lesson.id))
              .length /
              course.lessons.length) *
              100
          )
        : 0,
    [completed]
  );

  const noteForLesson = useCallback(
    (lessonId: string): LessonNote => {
      if (persistence === "preview") {
        return { text: "", revision: 0, status: "local", error: null };
      }
      if (persistence === "admin-local") {
        return {
          text: localNotes[lessonId] || "",
          revision: 0,
          status: "local",
          error: null,
        };
      }
      const draft = noteDrafts[lessonId];
      if (draft) {
        return {
          text: draft.text,
          revision: draft.revision,
          status: draft.status,
          error: draft.error,
          serverVersion: draft.serverVersion,
        };
      }
      const record = cloudRecords[lessonId];
      return {
        text: record?.note || "",
        revision: record?.noteRevision || 0,
        status: "saved",
        error: null,
      };
    },
    [cloudRecords, localNotes, noteDrafts, persistence]
  );

  const setNoteDraft = useCallback(
    (lessonId: string, note: string) => {
      if (!validIdsRef.current.has(lessonId) || persistence === "preview")
        return;
      const text = note.slice(0, MAX_LEARNING_NOTE_LENGTH);
      if (persistence === "admin-local") {
        setLocalNotes(current => ({ ...current, [lessonId]: text }));
        try {
          localStorage.setItem(
            accountStorageKey(accountKey, `notes-${lessonId}`),
            text
          );
        } catch {
          setLocalSyncError(
            "Cette note n’a pas pu être enregistrée dans ce navigateur."
          );
        }
        return;
      }
      updateNoteDrafts(current => {
        const existing = current[lessonId];
        if (existing) {
          return {
            ...current,
            [lessonId]: {
              ...existing,
              text,
              status: existing.status === "conflict" ? "conflict" : "dirty",
              error: existing.status === "conflict" ? existing.error : null,
            },
          };
        }
        const record = cloudRecordsRef.current[lessonId];
        return {
          ...current,
          [lessonId]: {
            text,
            revision: record?.noteRevision || 0,
            expectedRevision: record?.noteRevision || 0,
            acknowledgedText: record?.note || "",
            status: "dirty",
            error: null,
          },
        };
      });
    },
    [accountKey, persistence, updateNoteDrafts]
  );

  const saveNote = useCallback(
    async (lessonId: string) => {
      if (persistence === "client-cloud") await persistNote(lessonId);
    },
    [persistence, persistNote]
  );

  const resolveNoteConflict = useCallback(
    (lessonId: string, choice: "keep" | "load") => {
      if (persistence !== "client-cloud") return;
      const draft = noteDraftsRef.current[lessonId];
      const serverVersion = draft?.serverVersion;
      if (!draft || !serverVersion) return;
      if (choice === "load") {
        const current = cloudRecordsRef.current[lessonId];
        if (current) {
          setCloudRecords(records =>
            replaceLearningRecord(records, {
              ...current,
              note: serverVersion.text,
              noteRevision: serverVersion.revision,
            })
          );
        }
        updateNoteDrafts(current => {
          const { [lessonId]: _removed, ...remaining } = current;
          return remaining;
        });
        setLocalSyncError(null);
        return;
      }
      updateNoteDrafts(current => ({
        ...current,
        [lessonId]: {
          ...draft,
          revision: serverVersion.revision,
          expectedRevision: serverVersion.revision,
          acknowledgedText: serverVersion.text,
          status: "dirty",
          error: null,
          serverVersion: undefined,
        },
      }));
      setLocalSyncError(null);
    },
    [persistence, updateNoteDrafts]
  );

  const resetProgress = useCallback(async () => {
    if (persistence === "preview") return;
    if (persistence === "admin-local") {
      const confirmed = window.confirm(
        "Réinitialiser les leçons terminées, enregistrées et la dernière leçon dans ce navigateur? Tes notes seront conservées."
      );
      if (!confirmed) return;
      setLocalProgress({ completed: [], saved: [], lastLesson: "" });
      return;
    }
    if (!accountKey) return;
    const confirmed = window.confirm(
      "Réinitialiser ta progression sur tous tes appareils? Les leçons terminées, enregistrées et la dernière leçon seront effacées; tes notes seront conservées."
    );
    if (!confirmed) return;
    setPendingCount(count => count + 1);
    setLocalSyncError(null);
    try {
      const snapshot = await resetRemoteProgress({ accountKey });
      if (accountKeyRef.current !== accountKey) return;
      setSnapshot(snapshot);
    } catch (error) {
      if (accountKeyRef.current !== accountKey) return;
      const message = errorMessage(
        error,
        "Impossible de réinitialiser la progression. Rien n’a été supprimé."
      );
      setLocalSyncError(message);
      retryActionRef.current = () => {
        void resetProgress();
      };
    } finally {
      setPendingCount(count => Math.max(0, count - 1));
    }
  }, [accountKey, persistence, resetRemoteProgress, setSnapshot]);

  const retrySync = useCallback(() => {
    setLocalSyncError(null);
    const retryAction = retryActionRef.current;
    retryActionRef.current = null;
    if (retryAction) {
      retryAction();
      return;
    }
    refreshSnapshot();
  }, [refreshSnapshot]);

  const isLessonActionPending = useCallback(
    (lessonId: string, action: LessonAction) => {
      if (action === "visit")
        return hasPendingField(pendingFields, lessonId, "lastViewedAt");
      return hasPendingField(pendingFields, lessonId, action);
    },
    [pendingFields]
  );

  const queryError = snapshotError
    ? errorMessage(
        snapshotError,
        "Impossible de synchroniser ta progression pour le moment."
      )
    : null;
  const syncError = localSyncError || queryError;
  const loading = persistence === "client-cloud" && isSnapshotPending;
  const syncStatus: LearningSyncStatus =
    persistence !== "client-cloud"
      ? "local"
      : loading
        ? "loading"
        : pendingCount > 0
          ? "saving"
          : syncError
            ? "error"
            : "synced";

  const value = useMemo<LearningState>(
    () => ({
      completed,
      saved,
      lastLesson,
      persistence,
      loading,
      isSaving: pendingCount > 0,
      syncStatus,
      syncError,
      retrySync,
      isLessonActionPending,
      toggleComplete,
      toggleSaved,
      visitLesson,
      courseProgress,
      resetProgress,
      noteForLesson,
      setNoteDraft,
      saveNote,
      resolveNoteConflict,
    }),
    [
      completed,
      courseProgress,
      isLessonActionPending,
      lastLesson,
      loading,
      noteForLesson,
      pendingCount,
      persistence,
      resetProgress,
      resolveNoteConflict,
      retrySync,
      saveNote,
      saved,
      setNoteDraft,
      syncError,
      syncStatus,
      toggleComplete,
      toggleSaved,
      visitLesson,
    ]
  );

  return (
    <LearningContext.Provider value={value}>
      {children}
    </LearningContext.Provider>
  );
}

export function useLearning() {
  const context = useContext(LearningContext);
  if (!context)
    throw new Error("La progression doit être fournie par LearningProvider.");
  return context;
}
