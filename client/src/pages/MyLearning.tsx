import { Bookmark, CheckCircle2, CircleDashed, GraduationCap, RotateCcw } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import CourseCard from "@/components/CourseCard";
import { useCatalog } from "@/contexts/CatalogContext";
import { useLearning } from "@/contexts/LearningContext";
import type { Course } from "@shared/content";
import "./LearningPages.css";

type LearningFilter = "all" | "in-progress" | "completed" | "saved";
const filters: { id: LearningFilter; label: string; icon: typeof CircleDashed }[] = [
  { id: "all", label: "Toute l’activité", icon: GraduationCap },
  { id: "in-progress", label: "En cours", icon: CircleDashed },
  { id: "completed", label: "Terminés", icon: CheckCircle2 },
  { id: "saved", label: "Enregistrées", icon: Bookmark },
];

function safeCourseProgress(course: Course, courseProgress: (course: Course) => number) {
  return course.lessons.length ? courseProgress(course) : 0;
}

export default function MyLearning() {
  const [filter, setFilter] = useState<LearningFilter>("all");
  const { courses: catalogCourses, loading, error, retry, isAdminPreview } = useCatalog();
  const { completed, saved, courseProgress, persistence, isSaving, resetProgress } = useLearning();
  const courses = useMemo(() => isAdminPreview ? catalogCourses : catalogCourses.filter((course) => course.status !== "draft"), [catalogCourses, isAdminPreview]);
  const lessonIds = useMemo(() => new Set(courses.flatMap((course) => course.lessons.map((lesson) => lesson.id))), [courses]);
  const completedVisible = completed.filter((id) => lessonIds.has(id));
  const savedVisible = saved.filter((id) => lessonIds.has(id));
  const courseActivity = useMemo(() => courses.map((course) => ({
    course,
    progress: safeCourseProgress(course, courseProgress),
    savedCount: course.lessons.filter((lesson) => savedVisible.includes(lesson.id)).length,
    completedCount: course.lessons.filter((lesson) => completedVisible.includes(lesson.id)).length,
  })), [completedVisible, courseProgress, courses, savedVisible]);
  const filtered = courseActivity.filter(({ progress, savedCount }) => {
    if (filter === "in-progress") return progress > 0 && progress < 100;
    if (filter === "completed") return progress === 100;
    if (filter === "saved") return savedCount > 0;
    return progress > 0 || savedCount > 0;
  });
  const completedLessons = courseActivity.reduce((total, item) => total + item.completedCount, 0);
  const savedLessons = savedVisible.length;

  if (loading) return <div className="lp-page"><section className="panel lp-empty-state"><GraduationCap size={28} /><h2>Chargement de ton apprentissage</h2><p className="muted">Les cours publiés sont en cours de chargement.</p></section></div>;
  if (error) return <div className="lp-page"><section className="panel lp-empty-state"><GraduationCap size={28} /><h2>Ton apprentissage est momentanément indisponible.</h2><p className="muted">Réessaie dans un instant pour retrouver les cours publiés.</p><button type="button" className="btn secondary" onClick={() => retry()}>Réessayer</button></section></div>;

  return (
    <div className="lp-page">
      <section className="lp-learning-header">
        <div>
          <div className="lp-kicker"><GraduationCap size={14} /> TON ESPACE</div>
          <p className="eyebrow">{persistence === "client-cloud" ? "PROGRESSION SYNCHRONISÉE" : "PROGRESSION DANS CE NAVIGATEUR"}</p>
          <h1 className="page-title">Mon apprentissage</h1>
          <p className="lp-lead">{persistence === "client-cloud" ? "Tes leçons terminées, tes enregistrements et tes notes suivent ton compte EJ Coaching sur tes appareils connectés. Elles ne sont pas versées à ton dossier de coaching." : "Les leçons terminées, les enregistrements et les réflexions restent sur cet appareil. Elles ne sont pas enregistrées dans ton dossier de coaching."}</p>
        </div>
        <div className="lp-learning-stats">
          <div className="panel"><strong>{completedLessons}</strong><span>leçon{completedLessons === 1 ? "" : "s"} terminée{completedLessons === 1 ? "" : "s"}</span></div>
          <div className="panel"><strong>{savedLessons}</strong><span>leçon{savedLessons === 1 ? "" : "s"} enregistrée{savedLessons === 1 ? "" : "s"}</span></div>
        </div>
      </section>
      <section className="lp-learning-body">
        <div className="lp-learning-filter-list" role="tablist" aria-label="Filtrer l’activité d’apprentissage">
          {filters.map(({ id, label, icon: Icon }) => <button type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} key={id} className={filter === id ? "is-active" : ""}><Icon size={17} /> {label}</button>)}
        </div>
        <div className="lp-learning-content">
          <div className="section-heading"><div><p className="eyebrow">TON ACTIVITÉ</p><h2>{filters.find((item) => item.id === filter)?.label}</h2></div><span className="muted">{filtered.length} cours</span></div>
          {filtered.length ? (
            <div className="lp-course-grid lp-learning-grid">{filtered.map(({ course, progress, savedCount }) => <CourseCard key={course.id} course={course} progress={progress} savedCount={savedCount} progressScope={persistence === "client-cloud" ? "account" : "browser"} compact />)}</div>
          ) : (
            <div className="panel lp-empty-state lp-learning-empty">
              <GraduationCap size={28} />
              <h3>{filter === "saved" ? "Aucune leçon enregistrée pour le moment." : filter === "completed" ? "Aucune leçon terminée pour le moment." : "Ton espace d’apprentissage est prêt."}</h3>
              <p className="muted">Ouvre un cours, puis enregistre une leçon ou marque-la comme terminée pour la voir ici. {persistence === "client-cloud" ? "Ta progression sera synchronisée avec ton compte." : "Cette progression reste dans ce navigateur."}</p>
              <Link href="/courses" className="btn primary">Parcourir la bibliothèque</Link>
            </div>
          )}
          {persistence !== "preview" && (
            <section className="lp-reset-progress">
              <div>
                <strong>Repartir avec une nouvelle progression</strong>
                <p>{persistence === "client-cloud" ? "Réinitialise les leçons terminées, enregistrées et la dernière leçon sur tous tes appareils. Tes notes sont conservées." : "Réinitialise les leçons terminées, enregistrées et la dernière leçon dans ce navigateur. Tes notes sont conservées."}</p>
              </div>
              <button type="button" className="btn secondary" disabled={isSaving} onClick={() => void resetProgress()}>
                <RotateCcw size={15} /> Réinitialiser
              </button>
            </section>
          )}
        </div>
      </section>
    </div>
  );
}
