import type { CSSProperties } from "react";
import { Apple, Brain, Dumbbell, Flame, PackageOpen, Pill, Play, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { totalMinutes, type Course } from "@/lib/courses";
import "@/pages/LearningPages.css";

type CourseCardProps = {
  course: Course;
  progress?: number;
  savedCount?: number;
  compact?: boolean;
};

const courseIcons = {
  nutrition: Apple,
  training: Dumbbell,
  mindset: Brain,
  deficit: Flame,
  surplus: TrendingUp,
  equipment: PackageOpen,
  supplements: Pill,
};

export function CourseArtwork({ course, className = "" }: { course: Course; className?: string }) {
  const Icon = courseIcons[course.icon];
  const artStyle = { "--course-color": course.color } as CSSProperties;

  if (course.image) {
    return (
      <div className={`lp-course-art lp-course-photo ${className}`} style={artStyle}>
        <img src={course.image} alt="" />
        <span className="lp-art-shade" />
        <span className="lp-art-play"><Play size={14} fill="currentColor" /></span>
      </div>
    );
  }

  return (
    <div className={`lp-course-art lp-course-abstract ${className}`} style={artStyle} aria-hidden="true">
      <span className="lp-art-orbit lp-art-orbit-one" />
      <span className="lp-art-orbit lp-art-orbit-two" />
      <span className="lp-art-icon"><Icon size={30} strokeWidth={1.7} /></span>
      <span className="lp-art-title">EJ<br />COACHING</span>
      <span className="lp-art-play"><Play size={14} fill="currentColor" /></span>
    </div>
  );
}

export default function CourseCard({ course, progress = 0, savedCount = 0, compact = false }: CourseCardProps) {
  const progressLabel = progress === 100 ? "Completed in demo" : `${progress}% demo progress`;

  return (
    <Link href={`/courses/${course.id}`} className={`lp-course-card ${compact ? "lp-course-card-compact" : ""}`}>
      <CourseArtwork course={course} />
      <div className="lp-course-card-body">
        <div className="lp-card-meta">
          <span>{course.category}</span>
          <span>{course.lessons.length} lessons</span>
        </div>
        <h3>{course.title}</h3>
        {!compact && <p>{course.description}</p>}
        <div className="lp-course-card-footer">
          <span>{totalMinutes(course)} min <em>sample</em></span>
          {savedCount > 0 ? <span className="lp-saved-count">{savedCount} saved</span> : <span className="lp-demo-label">{progressLabel}</span>}
        </div>
        <div className="progress-track lp-card-progress" aria-label={progressLabel}>
          <span className="progress-fill" style={{ width: `${progress}%` }} />
        </div>
      </div>
    </Link>
  );
}
