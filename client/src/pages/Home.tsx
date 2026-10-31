import { Link } from 'wouter';
import { ArrowRight, ArrowUpRight, BookOpen, CheckCircle2, ChevronRight, Clock3, Play, Sparkles } from 'lucide-react';
import { useLearning } from '@/contexts/LearningContext';
import { allLessons, courses, totalMinutes } from '@/lib/courses';

export default function Home() {
  const { completed, lastLesson, courseProgress } = useLearning();
  const currentCourse = courses.find(course => course.lessons.some(lesson => lesson.id === lastLesson)) || courses[0];
  const nextLesson = currentCourse.lessons.find(lesson => !completed.includes(lesson.id)) || currentCourse.lessons[0];
  const overall = Math.round(completed.length / allLessons.length * 100);
  const completedCourses = courses.filter(course => courseProgress(course) === 100).length;
  const featuredCourses = [courses[1], courses[2], courses[5]];
  const suggestions = [nextLesson, courses[1].lessons.find(lesson => !completed.includes(lesson.id)) || courses[1].lessons[0]];
  return (
    <div className="dashboard-page">
      <section className="welcome-row">
        <div><p className="eyebrow"><span className="eyebrow-line" /> TON PARCOURS, TON RYTHME</p><h1>Plus de confiance,<br className="mobile-line-break" /> une leçon à la fois.</h1><p className="muted">Des connaissances pour mieux t’entraîner, mieux manger et garder le cap.</p></div>
        <span className="welcome-tag"><Sparkles size={15} /> Apprends. Applique. Avance.</span>
      </section>
      <section className="dashboard-feature-layout">
        <article className="feature-course panel">
          {currentCourse.image ? <img className="feature-course-image" src={currentCourse.image} alt={`Visuel d’exemple du cours ${currentCourse.title}`} /> : <div className="feature-course-abstract"><ArrowUpRight size={180} strokeWidth={0.5} /></div>}
          <div className="feature-image-shade" />
          <div className="feature-content">
            <span className="feature-label"><span className="status-dot" /> {completed.length > 0 ? 'POURSUIS TON PARCOURS' : 'LE BON POINT DE DÉPART'}</span>
            <h2>{currentCourse.id === 'nutrition' ? <>Des bases solides<br />pour mieux avancer.</> : currentCourse.title}</h2>
            <p>{currentCourse.id === 'nutrition' ? 'Comprends ta nutrition. Bâtis de bonnes habitudes. Commence par les bases.' : currentCourse.description}</p>
            <div className="feature-meta"><span><BookOpen size={14} /> {currentCourse.lessons.length} leçons</span><span><Clock3 size={14} /> {totalMinutes(currentCourse)} min · exemple</span><span className="feature-level">Les bases</span></div>
            <Link href={`/learn/${currentCourse.id}/${nextLesson.id}`} className="btn primary feature-cta"><Play size={15} fill="currentColor" /> {completed.length ? 'Continuer à apprendre' : 'Commencer à apprendre'}<ArrowRight size={17} /></Link>
            <span className="feature-sample-note">COURS D’EXEMPLE · {currentCourse.title}</span>
          </div>
        </article>
        <article className="journey-panel panel">
          <div className="section-heading"><h2>Ton parcours d’apprentissage</h2><span className="tiny-badge">DÉMO</span></div>
          <div className="progress-ring" style={{ background: `conic-gradient(#a188fb ${overall}%, #28233c 0)` }} aria-label={`${overall} pour cent des leçons d’exemple terminées`}><div><strong>{overall}<span> %</span></strong><small>progression globale</small></div></div>
          <div className="journey-stats"><div><strong>{completed.length}<span> / {allLessons.length}</span></strong><small>Leçons terminées</small></div><div><strong>{completedCourses}<span> / {courses.length}</span></strong><small>Cours terminés</small></div></div>
          <p className="journey-note"><span className="status-dot" /> {completed.length > 0 ? 'Garde le cap. Chaque leçon compte.' : 'Ta première leçon, ton premier pas.'}</p>
          <Link href="/my-learning" className="journey-link">Voir mon apprentissage <ArrowUpRight size={15} /></Link>
        </article>
      </section>
      <section className="dashboard-courses-section">
        <div className="section-heading"><div><h2>Explore tes cours</h2><p className="muted">Des connaissances utiles à chaque étape de ton parcours.</p></div><Link href="/courses" className="text-link">Voir tous les cours <ArrowRight size={16} /></Link></div>
        <div className="dashboard-course-grid">
          {featuredCourses.map(course => (
            <Link href={`/courses/${course.id}`} key={course.id} className="dashboard-course-card panel">
              <div className="dashboard-card-art"><img src={course.image} alt={`Visuel d’exemple du cours ${course.title}`} loading="lazy" /><span className="course-category-pill">{course.category}</span><span className="course-art-arrow"><ArrowUpRight size={18} /></span></div>
              <div className="dashboard-card-body"><div className="course-card-title-row"><h3>{course.title}</h3></div><p>{course.description}</p><div className="dashboard-card-meta"><span><BookOpen size={13} />{course.lessons.length} leçons</span><span><Clock3 size={13} />{totalMinutes(course)} min</span><span className="sample-label">EXEMPLE</span></div><div className="progress-track"><span className="progress-fill" style={{ width: `${courseProgress(course)}%` }} /></div><div className="dashboard-card-progress"><span>{course.lessons.filter(lesson => completed.includes(lesson.id)).length} sur {course.lessons.length} terminées</span><span>{courseProgress(course)} %</span></div></div>
            </Link>
          ))}
        </div>
      </section>
      <section className="dashboard-bottom-layout">
        <article className="next-lessons panel"><div className="section-heading"><h2>{completed.length ? 'Garde ton élan' : 'Tes prochaines étapes'}</h2><span className="muted small-text">Leçons suggérées</span></div>
          {suggestions.map((lesson, index) => { const course = courses.find(item => item.lessons.some(item => item.id === lesson.id))!; return <Link key={lesson.id} href={`/learn/${course.id}/${lesson.id}`} className="suggested-lesson"><span className="lesson-step">{String(index + 1).padStart(2, '0')}</span><span className="suggested-lesson-info"><small>{course.title}</small><strong>{lesson.title}</strong></span><span className="suggested-duration">{lesson.duration}</span><span className="suggested-play"><Play size={14} /></span></Link>; })}
        </article>
        <article className="approach-panel panel"><span className="approach-icon"><CheckCircle2 size={23} /></span><p className="eyebrow">DE LA THÉORIE À LA PRATIQUE</p><h2>Tu n’as pas à tout<br />apprendre d’un coup.</h2><p>Choisis une leçon. Retiens une idée utile.<br />Parles-en à ton prochain suivi de coaching.</p><Link href="/resources" className="text-link">Explore les ressources <ChevronRight size={15} /></Link></article>
      </section>
    </div>
  );
}
