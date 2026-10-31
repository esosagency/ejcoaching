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
        <div><p className="eyebrow"><span className="eyebrow-line" /> YOUR JOURNEY, YOUR PACE</p><h1>A stronger you,<br className="mobile-line-break" /> one lesson at a time.</h1><p className="muted">The knowledge to move better, eat smarter, and stay consistent.</p></div>
        <span className="welcome-tag"><Sparkles size={15} /> Learn. Apply. Progress.</span>
      </section>
      <section className="dashboard-feature-layout">
        <article className="feature-course panel">
          {currentCourse.image ? <img className="feature-course-image" src={currentCourse.image} alt={`${currentCourse.title} sample course artwork`} /> : <div className="feature-course-abstract"><ArrowUpRight size={180} strokeWidth={0.5} /></div>}
          <div className="feature-image-shade" />
          <div className="feature-content">
            <span className="feature-label"><span className="status-dot" /> {completed.length > 0 ? 'CONTINUE YOUR JOURNEY' : 'A GREAT PLACE TO START'}</span>
            <h2>{currentCourse.id === 'nutrition' ? <>Your foundation for<br />lasting progress.</> : currentCourse.title}</h2>
            <p>{currentCourse.id === 'nutrition' ? 'Understand your nutrition. Build better habits. Start with the fundamentals.' : currentCourse.description}</p>
            <div className="feature-meta"><span><BookOpen size={14} /> {currentCourse.lessons.length} lessons</span><span><Clock3 size={14} /> {totalMinutes(currentCourse)} min · sample</span><span className="feature-level">Foundations</span></div>
            <Link href={`/learn/${currentCourse.id}/${nextLesson.id}`} className="btn primary feature-cta"><Play size={15} fill="currentColor" /> {completed.length ? 'Continue learning' : 'Start learning'}<ArrowRight size={17} /></Link>
            <span className="feature-sample-note">SAMPLE COURSE · {currentCourse.title}</span>
          </div>
        </article>
        <article className="journey-panel panel">
          <div className="section-heading"><h2>Your learning journey</h2><span className="tiny-badge">DEMO</span></div>
          <div className="progress-ring" style={{ background: `conic-gradient(#a188fb ${overall}%, #28233c 0)` }} aria-label={`${overall} percent of sample lessons complete`}><div><strong>{overall}<span>%</span></strong><small>overall progress</small></div></div>
          <div className="journey-stats"><div><strong>{completed.length}<span> / {allLessons.length}</span></strong><small>Lessons completed</small></div><div><strong>{completedCourses}<span> / {courses.length}</span></strong><small>Courses completed</small></div></div>
          <p className="journey-note"><span className="status-dot" /> {completed.length > 0 ? 'Keep going. Every lesson counts.' : 'Your first lesson is a great first step.'}</p>
          <Link href="/my-learning" className="journey-link">View my learning <ArrowUpRight size={15} /></Link>
        </article>
      </section>
      <section className="dashboard-courses-section">
        <div className="section-heading"><div><h2>Explore your courses</h2><p className="muted">Practical knowledge for every part of your journey.</p></div><Link href="/courses" className="text-link">View all courses <ArrowRight size={16} /></Link></div>
        <div className="dashboard-course-grid">
          {featuredCourses.map(course => (
            <Link href={`/courses/${course.id}`} key={course.id} className="dashboard-course-card panel">
              <div className="dashboard-card-art"><img src={course.image} alt={`${course.title} sample artwork`} loading="lazy" /><span className="course-category-pill">{course.category}</span><span className="course-art-arrow"><ArrowUpRight size={18} /></span></div>
              <div className="dashboard-card-body"><div className="course-card-title-row"><h3>{course.title}</h3></div><p>{course.description}</p><div className="dashboard-card-meta"><span><BookOpen size={13} />{course.lessons.length} lessons</span><span><Clock3 size={13} />{totalMinutes(course)} min</span><span className="sample-label">SAMPLE</span></div><div className="progress-track"><span className="progress-fill" style={{ width: `${courseProgress(course)}%` }} /></div><div className="dashboard-card-progress"><span>{course.lessons.filter(lesson => completed.includes(lesson.id)).length} of {course.lessons.length} completed</span><span>{courseProgress(course)}%</span></div></div>
            </Link>
          ))}
        </div>
      </section>
      <section className="dashboard-bottom-layout">
        <article className="next-lessons panel"><div className="section-heading"><h2>{completed.length ? 'Keep your momentum' : 'Your next steps'}</h2><span className="muted small-text">Suggested lessons</span></div>
          {suggestions.map((lesson, index) => { const course = courses.find(item => item.lessons.some(item => item.id === lesson.id))!; return <Link key={lesson.id} href={`/learn/${course.id}/${lesson.id}`} className="suggested-lesson"><span className="lesson-step">{String(index + 1).padStart(2, '0')}</span><span className="suggested-lesson-info"><small>{course.title}</small><strong>{lesson.title}</strong></span><span className="suggested-duration">{lesson.duration}</span><span className="suggested-play"><Play size={14} /></span></Link>; })}
        </article>
        <article className="approach-panel panel"><span className="approach-icon"><CheckCircle2 size={23} /></span><p className="eyebrow">KNOWLEDGE INTO ACTION</p><h2>You don’t have to learn<br />everything at once.</h2><p>Pick one lesson. Take one useful idea.<br />Bring it into your next coaching conversation.</p><Link href="/resources" className="text-link">Explore learning resources <ChevronRight size={15} /></Link></article>
      </section>
    </div>
  );
}
