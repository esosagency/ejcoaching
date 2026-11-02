import { Link } from "wouter";
import { ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, ChevronRight, Clock3, Play, Sparkles } from "lucide-react";
import { useCatalog } from "@/contexts/CatalogContext";
import { useLearning } from "@/contexts/LearningContext";
import { totalMinutes } from "@/lib/courses";
import type { Course, Lesson } from "@shared/content";

type SuggestedLesson = { course: Course; lesson: Lesson };

function safeCourseProgress(course: Course, courseProgress: (course: Course) => number) {
  return course.lessons.length ? courseProgress(course) : 0;
}

export default function Home() {
  const { courses: catalogCourses, loading, error, retry, isAdminPreview } = useCatalog();
  const { completed, lastLesson, courseProgress, persistence } = useLearning();
  const courses = isAdminPreview ? catalogCourses : catalogCourses.filter((course) => course.status !== "draft");
  const allLessons = courses.flatMap((course) => course.lessons);
  const completedLessonIds = completed.filter((id) => allLessons.some((lesson) => lesson.id === id));
  const coursesWithLessons = courses.filter((course) => course.lessons.length > 0);
  const currentCourse = coursesWithLessons.find((course) => course.lessons.some((lesson) => lesson.id === lastLesson)) || coursesWithLessons[0];
  const nextLesson = currentCourse?.lessons.find((lesson) => !completedLessonIds.includes(lesson.id)) || currentCourse?.lessons[0];
  const overall = allLessons.length ? Math.round((completedLessonIds.length / allLessons.length) * 100) : 0;
  const completedCourses = coursesWithLessons.filter((course) => safeCourseProgress(course, courseProgress) === 100).length;
  const featuredCandidates = currentCourse ? courses.filter((course) => course.id !== currentCourse.id) : courses;
  const featuredCourses = (featuredCandidates.length ? featuredCandidates : courses).slice(0, 3);
  const suggestions: SuggestedLesson[] = [];

  if (currentCourse && nextLesson) suggestions.push({ course: currentCourse, lesson: nextLesson });
  for (const course of coursesWithLessons) {
    if (suggestions.length >= 2) break;
    const lesson = course.lessons.find((item) => !completedLessonIds.includes(item.id)) || course.lessons[0];
    if (lesson && !suggestions.some((item) => item.lesson.id === lesson.id)) suggestions.push({ course, lesson });
  }

  if (loading) {
    return <div className="dashboard-page"><section className="panel lp-empty-state"><BookOpen size={26} /><h2>Chargement des cours</h2><p className="muted">La bibliothèque est en cours de préparation.</p></section></div>;
  }

  if (error) {
    return (
      <div className="dashboard-page">
        <section className="panel lp-empty-state">
          <BookOpen size={26} />
          <h2>La bibliothèque est momentanément indisponible.</h2>
          <p className="muted">Réessaie dans un instant pour retrouver les cours publiés.</p>
          <button type="button" className="btn secondary" onClick={() => retry()}>Réessayer</button>
        </section>
      </div>
    );
  }

  if (!courses.length) {
    return (
      <div className="dashboard-page">
        <section className="welcome-row">
          <div><p className="eyebrow"><span className="eyebrow-line" /> TON PARCOURS, TON RYTHME</p><h1>Ton espace d’apprentissage<br className="mobile-line-break" /> se prépare.</h1><p className="muted">Aucun cours publié n’est disponible pour le moment.</p></div>
          <span className="welcome-tag"><Sparkles size={15} /> Apprends. Applique. Avance.</span>
        </section>
        <section className="panel lp-empty-state">
          <BookOpen size={28} />
          <h2>Les premiers cours arriveront bientôt.</h2>
          <p className="muted">Si tu gères le contenu, ajoute un cours et publie-le dans l’administration.</p>
          <Link href="/admin" className="btn primary">Accéder à l’administration</Link>
        </section>
      </div>
    );
  }

  if (!currentCourse || !nextLesson) {
    return (
      <div className="dashboard-page">
        <section className="welcome-row">
          <div><p className="eyebrow"><span className="eyebrow-line" /> TON PARCOURS, TON RYTHME</p><h1>Les cours sont prêts,<br className="mobile-line-break" /> les leçons suivent.</h1><p className="muted">Les leçons publiées apparaîtront ici dès qu’elles seront ajoutées.</p></div>
          <span className="welcome-tag"><Sparkles size={15} /> Apprends. Applique. Avance.</span>
        </section>
        <section className="panel lp-empty-state">
          <BookOpen size={28} />
          <h2>Aucune leçon publiée pour le moment.</h2>
          <p className="muted">Explore les cours disponibles ou reviens lorsque de nouvelles leçons auront été ajoutées.</p>
          <Link href="/courses" className="btn primary">Voir les cours</Link>
        </section>
      </div>
    );
  }

  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div><p className="eyebrow"><span className="eyebrow-line" /> TON PARCOURS, TON RYTHME</p><h1>Plus de confiance,<br className="mobile-line-break" /> une leçon à la fois.</h1><p className="muted">Des connaissances pour mieux t’entraîner, mieux manger et garder le cap.</p></div>
        <span className="welcome-tag"><Sparkles size={15} /> Apprends. Applique. Avance.</span>
      </section>
      <section className="dashboard-feature-layout">
        <article className="feature-course panel">
          {currentCourse.image ? <img className="feature-course-image" src={currentCourse.image} alt={`Visuel du cours ${currentCourse.title}`} /> : <div className="feature-course-abstract"><ArrowUpRight size={180} strokeWidth={0.5} /></div>}
          <div className="feature-image-shade" />
          <div className="feature-content">
            <span className="feature-label"><span className="status-dot" /> {completedLessonIds.length > 0 ? "POURSUIS TON PARCOURS" : "LE BON POINT DE DÉPART"}</span>
            <h2>{currentCourse.title}</h2>
            <p>{currentCourse.description}</p>
            <div className="feature-meta"><span><BookOpen size={14} /> {currentCourse.lessons.length} leçon{currentCourse.lessons.length === 1 ? "" : "s"}</span><span><Clock3 size={14} /> {totalMinutes(currentCourse)} min</span><span className="feature-level">{currentCourse.category}</span></div>
            <Link href={`/learn/${currentCourse.id}/${nextLesson.id}`} className="btn primary feature-cta"><Play size={15} fill="currentColor" /> {completedLessonIds.length ? "Continuer à apprendre" : "Commencer à apprendre"}<ArrowRight size={17} /></Link>
            {currentCourse.isSample !== false && <span className="feature-sample-note">COURS D’EXEMPLE · {currentCourse.title}</span>}
          </div>
        </article>
        <article className="journey-panel panel">
          <div className="section-heading"><h2>Ton parcours d’apprentissage</h2><span className="tiny-badge">{persistence === "client-cloud" ? "PROGRESSION SYNCHRONISÉE" : "PROGRESSION LOCALE"}</span></div>
          <div className="progress-ring" style={{ background: `conic-gradient(#a188fb ${overall}%, #28233c 0)` }} aria-label={`${overall} pour cent des leçons terminées${persistence === "client-cloud" ? " pour ton compte" : " dans ce navigateur"}`}><div><strong>{overall}<span> %</span></strong><small>progression globale</small></div></div>
          <div className="journey-stats"><div><strong>{completedLessonIds.length}<span> / {allLessons.length}</span></strong><small>Leçons terminées</small></div><div><strong>{completedCourses}<span> / {coursesWithLessons.length}</span></strong><small>Cours terminés</small></div></div>
          <p className="journey-note"><span className="status-dot" /> {completedLessonIds.length > 0 ? "Garde le cap. Chaque leçon compte." : "Ta première leçon, ton premier pas."}</p>
          <Link href="/my-learning" className="journey-link">Voir mon apprentissage <ArrowUpRight size={15} /></Link>
        </article>
      </section>
      <section className="dashboard-courses-section">
        <div className="section-heading"><div><h2>Explore tes cours</h2><p className="muted">Des connaissances utiles à chaque étape de ton parcours.</p></div><Link href="/courses" className="text-link">Voir tous les cours <ArrowRight size={16} /></Link></div>
        <div className="dashboard-course-grid">
          {featuredCourses.map((course) => {
            const progress = safeCourseProgress(course, courseProgress);
            const completedCount = course.lessons.filter((lesson) => completedLessonIds.includes(lesson.id)).length;
            return (
              <Link href={`/courses/${course.id}`} key={course.id} className="dashboard-course-card panel">
                <div className="dashboard-card-art">{course.image ? <img src={course.image} alt={`Visuel du cours ${course.title}`} loading="lazy" /> : <div className="feature-course-abstract"><ArrowUpRight size={48} strokeWidth={0.8} /></div>}<span className="course-category-pill">{course.category}</span><span className="course-art-arrow"><ArrowUpRight size={18} /></span></div>
                <div className="dashboard-card-body"><div className="course-card-title-row"><h3>{course.title}</h3></div><p>{course.description}</p><div className="dashboard-card-meta"><span><BookOpen size={13} />{course.lessons.length} leçon{course.lessons.length === 1 ? "" : "s"}</span><span><Clock3 size={13} />{totalMinutes(course)} min</span>{course.isSample !== false && <span className="sample-label">EXEMPLE</span>}</div><div className="progress-track"><span className="progress-fill" style={{ width: `${progress}%` }} /></div><div className="dashboard-card-progress"><span>{completedCount} sur {course.lessons.length} terminée{completedCount === 1 ? "" : "s"}</span><span>{progress} %</span></div></div>
              </Link>
            );
          })}
        </div>
      </section>
      <section className="dashboard-bottom-layout">
        <article className="next-lessons panel"><div className="section-heading"><h2>{completedLessonIds.length ? "Garde ton élan" : "Tes prochaines étapes"}</h2><span className="muted small-text">Leçons suggérées</span></div>
          {suggestions.map(({ course, lesson }, index) => <Link key={lesson.id} href={`/learn/${course.id}/${lesson.id}`} className="suggested-lesson"><span className="lesson-step">{String(index + 1).padStart(2, "0")}</span><span className="suggested-lesson-info"><small>{course.title}</small><strong>{lesson.title}</strong></span><span className="suggested-duration">{lesson.duration}</span><span className="suggested-play"><Play size={14} /></span></Link>)}
        </article>
        <article className="approach-panel panel"><span className="approach-icon"><CheckCircle2 size={23} /></span><p className="eyebrow">DE LA THÉORIE À LA PRATIQUE</p><h2>Tu n’as pas à tout<br />apprendre d’un coup.</h2><p>Choisis une leçon. Retiens une idée utile.<br />Parles-en à ton prochain suivi de coaching.</p><Link href="/resources" className="text-link">Explore les ressources <ChevronRight size={15} /></Link></article>
      </section>
    </div>
  );
}
