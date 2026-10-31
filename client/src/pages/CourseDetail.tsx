import { Check, ChevronRight, Clock3, Layers3, Play, Star } from "lucide-react";
import { Link, useParams } from "wouter";
import { CourseArtwork } from "@/components/CourseCard";
import { useLearning } from "@/contexts/LearningContext";
import { getCourse, totalMinutes } from "@/lib/courses";
import NotFound from "@/pages/NotFound";
import "./LearningPages.css";

export default function CourseDetail() {
  const { courseId } = useParams<{ courseId: string }>();
  const course = getCourse(courseId);
  const { completed, courseProgress, lastLesson } = useLearning();

  if (!course) return <NotFound />;

  const progress = courseProgress(course);
  const recentlyViewed = course.lessons.find((lesson) => lesson.id === lastLesson);
  const lessonToOpen = progress > 0 && recentlyViewed ? recentlyViewed : course.lessons[0];
  const completedCount = course.lessons.filter((lesson) => completed.includes(lesson.id)).length;

  return (
    <div className="lp-page">
      <nav className="lp-breadcrumb" aria-label="Fil d’Ariane">
        <Link href="/courses">Bibliothèque de cours</Link><ChevronRight size={14} /><span>{course.title}</span>
      </nav>

      <section className="lp-course-hero panel">
        <CourseArtwork course={course} className="lp-course-hero-art" />
        <div className="lp-course-hero-copy">
          <div className="lp-course-hero-topline"><span className="lp-demo-badge">COURS D’EXEMPLE</span><span>{course.category}</span></div>
          <p className="eyebrow">{course.eyebrow}</p>
          <h1 className="page-title">{course.title}</h1>
          <p className="lp-lead">{course.description}</p>
          <div className="lp-course-facts">
            <span><Layers3 size={16} /> {course.lessons.length} leçon{course.lessons.length === 1 ? "" : "s"} d’exemple</span>
            <span><Clock3 size={16} /> {totalMinutes(course)} min au total dans le catalogue</span>
          </div>
          <div className="lp-course-actions">
            <Link href={`/learn/${course.id}/${lessonToOpen.id}`} className="btn primary"><Play size={16} fill="currentColor" /> {progress > 0 ? "Continuer le cours" : "Commencer le cours"}</Link>
            <span className="lp-browser-note">Démo d’interface · pas de vidéo de coaching en direct</span>
          </div>
        </div>
      </section>

      <section className="lp-course-main-grid">
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">PLAN DE TON COURS</p>
              <h2>Leçons à explorer</h2>
            </div>
            <span className="lp-demo-badge">CONTENU D’EXEMPLE</span>
          </div>
          <div className="lp-lesson-outline panel">
            {course.lessons.map((lesson, index) => {
              const done = completed.includes(lesson.id);
              return (
                <Link href={`/learn/${course.id}/${lesson.id}`} className="lp-outline-row" key={lesson.id}>
                  <span className={`lp-lesson-index ${done ? "is-done" : ""}`}>{done ? <Check size={15} /> : String(index + 1).padStart(2, "0")}</span>
                  <span className="lp-outline-copy"><strong>{lesson.title}</strong><small>{lesson.description}</small></span>
                  <span className="lp-outline-duration">{lesson.duration}</span>
                  <ChevronRight className="lp-outline-arrow" size={17} />
                </Link>
              );
            })}
          </div>
        </div>

        <aside className="lp-overview-card panel">
          <div className="lp-overview-icon"><Star size={19} fill="currentColor" /></div>
          <p className="eyebrow">APERÇU DU COURS</p>
          <h3>Un point de départ réfléchi.</h3>
          <p>Ce plan d’exemple offre un contexte éducatif, et non des directives personnalisées en matière de nutrition, d’entraînement ou de soins de santé.</p>
          <div className="lp-progress-readout">
            <div><span>Progression de la démo</span><strong>{progress} %</strong></div>
            <div className="progress-track"><span className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <small>{completedCount} leçon{completedCount === 1 ? "" : "s"} terminée{completedCount === 1 ? "" : "s"} sur {course.lessons.length} dans ce navigateur.</small>
          </div>
          <p className="lp-callout">Utilise chaque leçon comme point de départ pour une conversation éclairée avec ton coach.</p>
        </aside>
      </section>
    </div>
  );
}
