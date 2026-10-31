import { Bookmark, CheckCircle2, CircleDashed, GraduationCap } from "lucide-react";
import { useMemo, useState } from "react";
import { Link } from "wouter";
import CourseCard from "@/components/CourseCard";
import { useLearning } from "@/contexts/LearningContext";
import { courses } from "@/lib/courses";
import "./LearningPages.css";

type LearningFilter = "all" | "in-progress" | "completed" | "saved";

const filters: { id: LearningFilter; label: string; icon: typeof CircleDashed }[] = [
  { id: "all", label: "All activity", icon: GraduationCap },
  { id: "in-progress", label: "In progress", icon: CircleDashed },
  { id: "completed", label: "Completed", icon: CheckCircle2 },
  { id: "saved", label: "Saved", icon: Bookmark },
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
          <div className="lp-kicker"><GraduationCap size={14} /> YOUR SPACE <span className="lp-demo-badge">DEMO</span></div>
          <p className="eyebrow">BROWSER-ONLY PROGRESS</p>
          <h1 className="page-title">My learning</h1>
          <p className="lp-lead">Completion marks, saves, and reflections stay on this device. There are no accounts or coaching records in this prototype.</p>
        </div>
        <div className="lp-learning-stats">
          <div className="panel"><strong>{completedLessons}</strong><span>lessons marked complete</span></div>
          <div className="panel"><strong>{savedLessons}</strong><span>lessons saved</span></div>
        </div>
      </section>

      <section className="lp-learning-body">
        <div className="lp-learning-filter-list" role="tablist" aria-label="Learning activity filter">
          {filters.map(({ id, label, icon: Icon }) => (
            <button type="button" role="tab" aria-selected={filter === id} onClick={() => setFilter(id)} key={id} className={filter === id ? "is-active" : ""}>
              <Icon size={17} /> {label}
            </button>
          ))}
        </div>
        <div className="lp-learning-content">
          <div className="section-heading">
            <div><p className="eyebrow">YOUR ACTIVITY</p><h2>{filters.find((item) => item.id === filter)?.label}</h2></div>
            <span className="muted">{filtered.length} {filtered.length === 1 ? "course" : "courses"}</span>
          </div>
          {filtered.length ? (
            <div className="lp-course-grid lp-learning-grid">
              {filtered.map(({ course, progress, savedCount }) => <CourseCard key={course.id} course={course} progress={progress} savedCount={savedCount} compact />)}
            </div>
          ) : (
            <div className="panel lp-empty-state lp-learning-empty">
              <GraduationCap size={28} />
              <h3>{filter === "saved" ? "No saved lessons yet." : filter === "completed" ? "Nothing completed yet." : "Your learning space is ready."}</h3>
              <p className="muted">Open a sample course, then save a lesson or mark it complete to see it here.</p>
              <Link href="/courses" className="btn primary">Browse the library</Link>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
