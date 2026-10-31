import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { allLessons, type Course } from '@/lib/courses';

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
const validIds = new Set(allLessons.map(lesson => lesson.id));
function readList(key: string): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) || '[]');
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === 'string' && validIds.has(id)) : [];
  } catch { return []; }
}
function readLast() {
  try { const value = localStorage.getItem('ej-demo-last'); return value && validIds.has(value) ? value : 'nutrition-1'; }
  catch { return 'nutrition-1'; }
}
export function LearningProvider({ children }: { children: ReactNode }) {
  const [completed, setCompleted] = useState<string[]>(() => readList('ej-demo-completed'));
  const [saved, setSaved] = useState<string[]>(() => readList('ej-demo-saved'));
  const [lastLesson, setLastLesson] = useState(readLast);
  useEffect(() => { try { localStorage.setItem('ej-demo-completed', JSON.stringify(completed)); } catch {} }, [completed]);
  useEffect(() => { try { localStorage.setItem('ej-demo-saved', JSON.stringify(saved)); } catch {} }, [saved]);
  useEffect(() => { try { localStorage.setItem('ej-demo-last', lastLesson); } catch {} }, [lastLesson]);
  const toggleComplete = (id: string) => { if (validIds.has(id)) setCompleted(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); };
  const toggleSaved = (id: string) => { if (validIds.has(id)) setSaved(items => items.includes(id) ? items.filter(item => item !== id) : [...items, id]); };
  const visitLesson = (id: string) => { if (validIds.has(id)) setLastLesson(id); };
  const courseProgress = (course: Course) => Math.round(course.lessons.filter(lesson => completed.includes(lesson.id)).length / course.lessons.length * 100);
  const resetProgress = () => { setCompleted([]); setSaved([]); setLastLesson('nutrition-1'); };
  return <LearningContext.Provider value={{ completed, saved, lastLesson, toggleComplete, toggleSaved, visitLesson, courseProgress, resetProgress }}>{children}</LearningContext.Provider>;
}
export function useLearning() {
  const context = useContext(LearningContext);
  if (!context) throw new Error('useLearning must be used within LearningProvider');
  return context;
}
