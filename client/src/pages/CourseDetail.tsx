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
      <nav className="lp-breadcrumb" aria-label="Breadcrumb">
        <Link href="/courses">Library</Link><ChevronRight size={14} /><span>{course.title}</span>
      </nav>

      <section className="lp-course-hero panel">
        <CourseArtwork course={course} className="lp-course-hero-art" />
        <div className="lp-course-hero-copy">
          <div className="lp-course-hero-topline"><span className="lp-demo-badge">DEMO COURSE</span><span>{course.category}</span></div>
          <p className="eyebrow">{course.eyebrow}</p>
          <h1 className="page-title">{course.title}</h1>
          <p className="lp-lead">{course.description}</p>
          <div className="lp-course-facts">
            <span><Layers3 size={16} /> {course.lessons.length} sample lessons</span>
            <span><Clock3 size={16} /> {totalMinutes(course)} min catalogue runtime</span>
          </div>
          <div className="lp-course-actions">
            <Link href={`/learn/${course.id}/${lessonToOpen.id}`} className="btn primary"><Play size={16} fill="currentColor" /> {progress > 0 ? "Continue course" : "Start course"}</Link>
            <span className="lp-browser-note">Interface demo · no live coaching video</span>
          </div>
        </div>
      </section>

      <section className="lp-course-main-grid">
        <div>
          <div className="section-heading">
            <div>
              <p className="eyebrow">YOUR COURSE OUTLINE</p>
              <h2>Lessons to explore</h2>
            </div>
            <span className="lp-demo-badge">SAMPLE CONTENT</span>
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
          <p className="eyebrow">COURSE OVERVIEW</p>
          <h3>A thoughtful starting point.</h3>
          <p>This sample outline offers educational context—not individualized nutrition, training, or healthcare direction.</p>
          <div className="lp-progress-readout">
            <div><span>Demo progress</span><strong>{progress}%</strong></div>
            <div className="progress-track"><span className="progress-fill" style={{ width: `${progress}%` }} /></div>
            <small>{completedCount} of {course.lessons.length} lessons marked complete in this browser.</small>
          </div>
          <p className="lp-callout">Use each lesson as a prompt for an informed conversation with your coach.</p>
        </aside>
      </section>
    </div>
  );
}
