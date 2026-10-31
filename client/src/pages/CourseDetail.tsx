import { Check, ChevronRight, Clock3, Layers3, Play, Star } from "lucide-react";
import { Link, useParams } from "wouter";
import { CourseArtwork } from "@/components/CourseCard";
import { useCatalog } from "@/contexts/CatalogContext";
import { useLearning } from "@/contexts/LearningContext";
import { totalMinutes } from "@/lib/courses";
import type { Course } from "@shared/content";
import NotFound from "@/pages/NotFound";
import "./LearningPages.css";

function safeCourseProgress(course: Course, courseProgress: (course: Course) => number) {
  return course.lessons.length ? courseProgress(course) : 0;
}

export default function CourseDetail() {
  const { courseId, id } = useParams<{ courseId?: string; id?: string }>();
  const { courses: catalogCourses, loading, error, retry, isAdminPreview } = useCatalog();
  const { completed, courseProgress, lastLesson } = useLearning();
  const requestedCourseId = courseId || id || "";
  const courses = isAdminPreview ? catalogCourses : catalogCourses.filter((item) => item.status !== "draft");
  const course = courses.find((item) => item.id === requestedCourseId);

  if (loading) return <div className="lp-page"><section className="panel lp-empty-state"><Layers3 size={26} /><h2>Chargement du cours</h2><p className="muted">Le contenu du cours est en cours de préparation.</p></section></div>;
  if (error) return <div className="lp-page"><section className="panel lp-empty-state"><Layers3 size={26} /><h2>Le cours est momentanément indisponible.</h2><p className="muted">Réessaie dans un instant.</p><button type="button" className="btn secondary" onClick={() => retry()}>Réessayer</button></section></div>;
  if (!course) return <NotFound />;

  const progress = safeCourseProgress(course, courseProgress);
  const recentlyViewed = course.lessons.find((lesson) => lesson.id === lastLesson);
  const lessonToOpen = progress > 0 && recentlyViewed ? recentlyViewed : course.lessons[0];
  const completedCount = course.lessons.filter((lesson) => completed.includes(lesson.id)).length;
  const isSample = course.isSample !== false;
  const lessonLink = (lessonId: string) => isAdminPreview ? `/admin/preview/${course.id}/lesson/${lessonId}` : `/learn/${course.id}/${lessonId}`;

  return (
    <div className="lp-page">
      {isAdminPreview && <div className="lp-demo-badge">Aperçu administrateur · ce cours n’est pas nécessairement publié</div>}
      <nav className="lp-breadcrumb" aria-label="Fil d’Ariane">
        {isAdminPreview ? <Link href="/admin">Administration</Link> : <Link href="/courses">Bibliothèque de cours</Link>}<ChevronRight size={14} /><span>{course.title}</span>
      </nav>
      <section className="lp-course-hero panel">
        <CourseArtwork course={course} className="lp-course-hero-art" />
        <div className="lp-course-hero-copy">
          <div className="lp-course-hero-topline">{isSample && <span className="lp-demo-badge">COURS D’EXEMPLE</span>}<span>{course.category}</span></div>
          <p className="eyebrow">{course.eyebrow}</p>
          <h1 className="page-title">{course.title}</h1>
          <p className="lp-lead">{course.description}</p>
          <div className="lp-course-facts">
            <span><Layers3 size={16} /> {course.lessons.length} leçon{course.lessons.length === 1 ? "" : "s"}{isSample ? " d’exemple" : ""}</span>
            <span><Clock3 size={16} /> {totalMinutes(course)} min au total</span>
          </div>
          <div className="lp-course-actions">
            {lessonToOpen ? <Link href={lessonLink(lessonToOpen.id)} className="btn primary"><Play size={16} fill="currentColor" /> {progress > 0 ? "Continuer le cours" : "Commencer le cours"}</Link> : <span className="lp-browser-note">Les leçons seront ajoutées bientôt.</span>}
            {isSample && <span className="lp-browser-note">Contenu d’exemple à visée éducative.</span>}
          </div>
        </div>
      </section>
      <section className="lp-course-main-grid">
        <div>
          <div className="section-heading">
            <div><p className="eyebrow">PLAN DE TON COURS</p><h2>Leçons à explorer</h2></div>
            {isSample && <span className="lp-demo-badge">CONTENU D’EXEMPLE</span>}
          </div>
          <div className="lp-lesson-outline panel">
            {course.lessons.length ? course.lessons.map((lesson, index) => {
              const done = completed.includes(lesson.id);
              return <Link href={lessonLink(lesson.id)} className="lp-outline-row" key={lesson.id}><span className={`lp-lesson-index ${done ? "is-done" : ""}`}>{done ? <Check size={15} /> : String(index + 1).padStart(2, "0")}</span><span className="lp-outline-copy"><strong>{lesson.title}</strong><small>{lesson.description}</small></span><span className="lp-outline-duration">{lesson.duration}</span><ChevronRight className="lp-outline-arrow" size={17} /></Link>;
            }) : <div className="lp-empty-state"><Layers3 size={23} /><h3>Les leçons seront ajoutées bientôt.</h3><p className="muted">Ce cours est publié, mais son plan n’est pas encore disponible.</p></div>}
          </div>
        </div>
        <aside className="lp-overview-card panel">
          <div className="lp-overview-icon"><Star size={19} fill="currentColor" /></div>
          <p className="eyebrow">APERÇU DU COURS</p>
          <h3>Un point de départ réfléchi.</h3>
          <p>{isSample ? "Ce cours d’exemple offre un contexte éducatif, et non des directives personnalisées en matière de nutrition, d’entraînement ou de soins de santé." : "Ce cours offre du contenu éducatif. Les conseils personnalisés relèvent de ta conversation de coaching ou de soins de santé."}</p>
          <div className="lp-progress-readout">
            <div><span>Progression dans ce navigateur</span><strong>{progress} %</strong></div>
            <div className="progress-track"><span className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <small>{course.lessons.length ? `${completedCount} leçon${completedCount === 1 ? "" : "s"} terminée${completedCount === 1 ? "" : "s"} sur ${course.lessons.length} dans ce navigateur.` : "Aucune leçon n’est disponible pour le moment."}</small>
          </div>
          <p className="lp-callout">Utilise chaque leçon comme point de départ pour une conversation éclairée avec ton coach.</p>
        </aside>
      </section>
    </div>
  );
}
