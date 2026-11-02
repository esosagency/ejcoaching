import type { CSSProperties } from "react";
import { Apple, BookOpen, Brain, Dumbbell, Flame, PackageOpen, Pill, Play, TrendingUp } from "lucide-react";
import { Link } from "wouter";
import { totalMinutes } from "@/lib/courses";
import type { Course } from "@shared/content";
import "@/pages/LearningPages.css";

type CourseCardProps = {
  course: Course;
  progress?: number;
  savedCount?: number;
  compact?: boolean;
  progressScope?: "account" | "browser";
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
  const Icon = courseIcons[course.icon] || BookOpen;
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

export default function CourseCard({ course, progress = 0, savedCount = 0, compact = false, progressScope = "account" }: CourseCardProps) {
  const safeProgress = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
  const isSample = course.isSample !== false;
  const progressLabel = safeProgress === 100 ? (progressScope === "account" ? "Terminé pour ton compte" : "Terminé dans ce navigateur") : `${safeProgress} % de progression ${progressScope === "account" ? "pour ton compte" : "dans ce navigateur"}`;
  return (
    <Link href={`/courses/${course.id}`} className={`lp-course-card ${compact ? "lp-course-card-compact" : ""}`}>
      <CourseArtwork course={course} />
      <div className="lp-course-card-body">
        <div className="lp-card-meta"><span>{course.category}</span><span>{course.lessons.length} leçon{course.lessons.length === 1 ? "" : "s"}</span></div>
        <h3>{course.title}</h3>
        {!compact && <p>{course.description}</p>}
        <div className="lp-course-card-footer">
          <span>{totalMinutes(course)} min {isSample && <em>exemple</em>}</span>
          {savedCount > 0 ? <span className="lp-saved-count">{savedCount} leçon{savedCount === 1 ? "" : "s"} enregistrée{savedCount === 1 ? "" : "s"}</span> : isSample ? <span className="lp-demo-label">CONTENU D’EXEMPLE</span> : <span className="lp-demo-label">{progressLabel}</span>}
        </div>
        <div className="progress-track lp-card-progress" aria-label={progressLabel}><span className="progress-fill" style={{ width: `${safeProgress}%` }} /></div>
      </div>
    </Link>
  );
}
