import { Bookmark, CheckCircle2, CircleDashed, GraduationCap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import CourseCard from "@/components/CourseCard";
import { useLearning } from "@/contexts/LearningContext";
import { courses } from "@/lib/courses";
import "./LearningPages.css";

type LearningFilter = "all" | "in-progress" | "completed" | "saved";

const filters: { id: LearningFilter; label: string; icon: typeof CircleDashed }[] = [
  { id: "all", label: "Toute l’activité", icon: GraduationCap },
  { id: "in-progress", label: "En cours", icon: CircleDashed },
  { id: "completed", label: "Terminés", icon: CheckCircle2 },
  { id: "saved", label: "Enregistrées", icon: Bookmark },
];

export default function MyLearning() {
  const [filter, setFilter] = useState<LearningFilter>("all");
  const { saved, courseProgress } = useLearning();

  const courseActivity = useMemo(() => courses.map((course) => ({
    course,
    progress: courseProgress(course),
    savedCount: course.lessons.filter((lesson) => saved.includes(lesson.id)).length,
  })), [courseProgress, saved]);

  const filtered = courseActivity.filter(({ progress, savedCount }) => {
    if (filter === "in-progress") return progress > 0 && progress < 100;
    if (filter === "completed") return progress === 100;
    if (filter === "saved") return savedCount > 0;
    return progress > 0 || savedCount > 0;
  });

  const completedLessons = courseActivity.reduce((total, item) => total + Math.round(item.progress * item.course.lessons.length / 100), 0);
  const savedLessons = saved.length;

  return (
    <div className="lp-page">
      <section className="lp-learning-header">
        <div>
          <div className="lp-kicker"><GraduationCap size={14} /> TON ESPACE <span className="lp-demo-badge">DÉMO</span></div>
          <p className="eyebrow">PROGRESSION DANS CE NAVIGATEUR</p>
          <h1 className="page-title">Mon apprentissage</h1>
          <p className="lp-lead">Les leçons terminées, les enregistrements et les réflexions restent sur cet appareil. Ce prototype ne comprend ni compte ni dossier de coaching.</p>
        </div>
        <div className="lp-learning-stats">
          <div className="panel"><strong>{completedLessons}</strong><span>leçon{completedLessons === 1 ? "" : "s"} terminée{completedLessons === 1 ? "" : "s"}</span></div>
          <div className="panel"><strong>{savedLessons}</strong><span>leçon{savedLessons === 1 ? "" : "s"} enregistrée{savedLessons === 1 ? "" : "s"}</span></div>
        </div>
      </section>

      <section className="lp-learning-body">
        <div className="lp-learning-filter-list" role="tablist" aria-label="Filtrer l’activité d’apprentissage">
          {filters.map(({ id, label, icon: Icon }) => (
            <button type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} key={id} className={filter === id ? "is-active" : ""}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <div className="lp-learning-content">
          <div className="section-heading">
            <div><p className="eyebrow">TON ACTIVITÉ</p><h2>{filters.find((item) => item.id === filter)?.label}</h2></div>
            <span className="muted">{filtered.length} cours</span>
          </div>
          {filtered.length ? (
            <div className="lp-course-grid lp-learning-grid">
              {filtered.map(({ course, progress, savedCount }) => <CourseCard key={course.id} course={course} progress={progress} savedCount={savedCount} compact />)}
            </div>
          ) : (
            <div className="panel lp-empty-state lp-learning-empty">
              <GraduationCap size={28} />
              <h3>{filter === "saved" ? "Aucune leçon enregistrée pour le moment." : filter === "completed" ? "Aucune leçon terminée pour le moment." : "Ton espace d’apprentissage est prêt."}</h3>
              <p className="muted">Ouvre un cours d’exemple, puis enregistre une leçon ou marque-la comme terminée pour la voir ici.</p>
              <Link href="/courses" className="btn primary">Parcourir la bibliothèque</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
