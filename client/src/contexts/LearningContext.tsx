import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { useCatalog } from "./CatalogContext";
import { useAccess } from "./AccessContext";
import { accountStorageKey, readAccountStorage } from "@/lib/accountStorage";
import type { Course } from "@shared/content";

type LearningState = {
  completed: string[];
  saved: string[];
  lastLesson: string;
  toggleComplete: (id: string) => void;
  toggleSaved: (id: string) => void;
  visitLesson: (id: string) => void;
  courseProgress: (course: Course) => number;
  resetProgress: () => void;
};
const LearningContext = createContext<LearningState | null>(null);
function readList(key: string, legacy: string, owner: boolean): string[] {
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
export function LearningProvider({ children }: { children: ReactNode }) {
  const { courses, isAdminPreview } = useCatalog();
  const { access } = useAccess();
  const owner = Boolean(access?.isAdmin);
  const userId = access?.user?.id;
  const completedKey = accountStorageKey(userId, "completed");
  const savedKey = accountStorageKey(userId, "saved");
  const lastKey = accountStorageKey(userId, "last");
  const validIds = useMemo(
    () =>
      new Set(
        courses.flatMap(course => course.lessons.map(lesson => lesson.id))
      ),
    [courses]
  );
  const [storedCompleted, setCompleted] = useState<string[]>(() =>
    readList(completedKey, "ej-demo-completed", owner)
  );
  const [storedSaved, setSaved] = useState<string[]>(() =>
    readList(savedKey, "ej-demo-saved", owner)
  );
  const [storedLast, setLastLesson] = useState(
    () => readAccountStorage(lastKey, "ej-demo-last", owner) || ""
  );
  useEffect(() => {
    if (isAdminPreview) return;
    try {
      localStorage.setItem(completedKey, JSON.stringify(storedCompleted));
    } catch {}
  }, [completedKey, storedCompleted, isAdminPreview]);
  useEffect(() => {
    if (isAdminPreview) return;
    try {
      localStorage.setItem(savedKey, JSON.stringify(storedSaved));
    } catch {}
  }, [savedKey, storedSaved, isAdminPreview]);
  useEffect(() => {
    if (isAdminPreview) return;
    try {
      localStorage.setItem(lastKey, storedLast);
    } catch {}
  }, [lastKey, storedLast, isAdminPreview]);
  const completed = useMemo(
    () => storedCompleted.filter(id => validIds.has(id)),
    [storedCompleted, validIds]
  );
  const saved = useMemo(
    () => storedSaved.filter(id => validIds.has(id)),
    [storedSaved, validIds]
  );
  const lastLesson = validIds.has(storedLast)
    ? storedLast
    : courses.flatMap(course => course.lessons)[0]?.id || "";
  const toggleComplete = useCallback(
    (id: string) => {
      if (!isAdminPreview && validIds.has(id))
        setCompleted(items =>
          items.includes(id)
            ? items.filter(item => item !== id)
            : [...items, id]
        );
    },
    [validIds, isAdminPreview]
  );
  const toggleSaved = useCallback(
    (id: string) => {
      if (!isAdminPreview && validIds.has(id))
        setSaved(items =>
          items.includes(id)
            ? items.filter(item => item !== id)
            : [...items, id]
        );
    },
    [validIds, isAdminPreview]
  );
  const visitLesson = useCallback(
    (id: string) => {
      if (!isAdminPreview && validIds.has(id)) setLastLesson(id);
    },
    [validIds, isAdminPreview]
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
  const resetProgress = () => {
    setCompleted([]);
    setSaved([]);
    setLastLesson("");
  };
  return (
    <LearningContext.Provider
      value={{
        completed,
        saved,
        lastLesson,
        toggleComplete,
        toggleSaved,
        visitLesson,
        courseProgress,
        resetProgress,
      }}
    >
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
