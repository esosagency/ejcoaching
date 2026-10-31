import { Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import CourseCard from "@/components/CourseCard";
import { useLearning } from "@/contexts/LearningContext";
import { courses } from "@/lib/courses";
import "./LearningPages.css";

const categories = ["All courses", "Nutrition", "Training", "Mindset", "Wellness"];

export default function Library() {
  const [category, setCategory] = useState("All courses");
  const [query, setQuery] = useState("");
  const { courseProgress } = useLearning();

  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesCategory = category === "All courses" || course.category === category;
      const matchesSearch = !normalizedQuery || [course.title, course.description, course.category, course.eyebrow]
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
      return matchesCategory && matchesSearch;
    });
  }, [category, query]);

  return (
    <div className="lp-page">
      <section className="lp-library-hero">
        <div className="lp-hero-copy">
          <div className="lp-kicker"><Sparkles size={13} /> EJ coaching academy <span className="lp-demo-badge">DEMO</span></div>
          <p className="eyebrow">VIDEO-LED EDUCATION</p>
          <h1 className="page-title">Learn the why behind your routine.</h1>
          <p className="lp-lead">A considered library of sample lessons to help you bring more confidence and better questions to your coaching conversations.</p>
        </div>
        <div className="lp-library-hero-stat panel">
          <span className="lp-stat-label">THE CATALOGUE</span>
          <strong>{courses.length}</strong>
          <span>sample courses across nutrition, training, mindset and wellness.</span>
        </div>
      </section>

      <section className="lp-library-controls" aria-label="Browse courses">
        <div className="lp-category-row" role="tablist" aria-label="Course category">
          {categories.map((item) => (
            <button
              key={item}
              type="button"
              className={`lp-filter-chip ${category === item ? "is-active" : ""}`}
              onClick={() => setCategory(item)}
              role="tab"
              aria-selected={category === item}
            >
              {item}
            </button>
          ))}
        </div>
        <label className="lp-search" aria-label="Search the course library">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search lessons, topics…" />
        </label>
      </section>

      <section>
        <div className="section-heading lp-library-heading">
          <div>
            <p className="eyebrow">CURATED FOR YOUR JOURNEY</p>
            <h2>{category === "All courses" ? "Explore the library" : category}</h2>
          </div>
          <p className="muted">{visibleCourses.length} {visibleCourses.length === 1 ? "course" : "courses"} · sample catalogue</p>
        </div>

        {visibleCourses.length ? (
          <div className="lp-course-grid">
            {visibleCourses.map((course) => <CourseCard key={course.id} course={course} progress={courseProgress(course)} />)}
          </div>
        ) : (
          <div className="panel lp-empty-state">
            <Search size={24} />
            <h3>No sample courses match that search.</h3>
            <p className="muted">Try a broader topic or return to all courses.</p>
            <button type="button" className="btn secondary" onClick={() => { setCategory("All courses"); setQuery(""); }}>Clear filters</button>
          </div>
        )}
      </section>
    </div>
  );
}
