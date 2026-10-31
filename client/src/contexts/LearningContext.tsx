import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { useCatalog } from './CatalogContext';
import type { Course } from '@shared/content';

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
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? [...new Set(value.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 128))] : [];
  } catch { return []; }
}
function readLast() {
  try { return localStorage.getItem('ej-demo-last') || 'nutrition-1'; }
  catch { return 'nutrition-1'; }
}
export function LearningProvider({ children }: { children: ReactNode }) {
  const { courses, isAdminPreview } = useCatalog();
  const validIds = useMemo(() => new Set(courses.flatMap(course => course.lessons.map(lesson => lesson.id))), [courses]);
  const [storedCompleted, setCompleted] = useState<string[]>(() => readList('ej-demo-completed'));
  const [storedSaved, setSaved] = useState<string[]>(() => readList('ej-demo-saved'));
  const [storedLast, setLastLesson] = useState(readLast);
  useEffect(() => { try { localStorage.setItem('ej-demo-completed', JSON.stringify(storedCompleted)); } catch {} }, [storedCompleted]);
  useEffect(() => { try { localStorage.setItem('ej-demo-saved', JSON.stringify(storedSaved)); } catch {} }, [storedSaved]);
  useEffect(() => { try { localStorage.setItem('ej-demo-last', storedLast); } catch {} }, [storedLast]);
  const completed = useMemo(() => storedCompleted.filter(id => validIds.has(id)), [storedCompleted, validIds]);
  const saved = useMemo(() => storedSaved.filter(id => validIds.has(id)), [storedSaved, validIds]);
  const lastLesson = validIds.has(storedLast) ? storedLast : courses.flatMap(course => course.lessons)[0]?.id || '';
  const toggleComplete = useCallback((id: string) => { if (!isAdminPreview && validIds.has(id)) setCompleted(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); }, [validIds, isAdminPreview]);
  const toggleSaved = useCallback((id: string) => { if (!isAdminPreview && validIds.has(id)) setSaved(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); }, [validIds, isAdminPreview]);
  const visitLesson = useCallback((id: string) => { if (!isAdminPreview && validIds.has(id)) setLastLesson(id); }, [validIds, isAdminPreview]);
  const courseProgress = useCallback((course: Course) => course.lessons.length ? Math.round(course.lessons.filter(lesson => completed.includes(lesson.id)).length / course.lessons.length * 100) : 0, [completed]);
  const resetProgress = () => { setCompleted([]); setSaved([]); setLastLesson('nutrition-1'); };
  return <LearningContext.Provider value={{ completed, saved, lastLesson, toggleComplete, toggleSaved, visitLesson, courseProgress, resetProgress }}>{children}</LearningContext.Provider>;
}
export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('La progression doit être fournie par LearningProvider.');
  return context;
}
