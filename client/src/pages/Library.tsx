import { Search, Sparkles } from "lucide-react";
import { useMemo, useState } from "react";
import CourseCard from "@/components/CourseCard";
import { useLearning } from "@/contexts/LearningContext";
import { courses } from "@/lib/courses";
import "./LearningPages.css";

const categories = ["Tous les cours", "Nutrition", "Entraînement", "Motivation", "Bien-être"];

export default function Library() {
  const [category, setCategory] = useState("Tous les cours");
  const [query, setQuery] = useState("");
  const { courseProgress } = useLearning();

  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return courses.filter((course) => {
      const matchesCategory = category === "Tous les cours" || course.category === category;
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
          <div className="lp-kicker"><Sparkles size={13} /> Académie EJ Coaching <span className="lp-demo-badge">DÉMO</span></div>
          <p className="eyebrow">APPRENTISSAGE PAR VIDÉO</p>
          <h1 className="page-title">Comprends le pourquoi derrière ta routine.</h1>
          <p className="lp-lead">Une bibliothèque réfléchie de leçons d’exemple pour t’aider à gagner en assurance et à poser de meilleures questions lors de tes conversations de coaching.</p>
        </div>
        <div className="lp-library-hero-stat panel">
          <span className="lp-stat-label">LE CATALOGUE</span>
          <strong>{courses.length}</strong>
          <span>cours d’exemple en nutrition, entraînement, motivation et bien-être.</span>
        </div>
      </section>

      <section className="lp-library-controls" aria-label="Parcourir les cours">
        <div className="lp-category-row" role="tablist" aria-label="Catégorie de cours">
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
        <label className="lp-search" aria-label="Rechercher dans la bibliothèque de cours">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher des leçons, des sujets…" />
        </label>
      </section>

      <section>
        <div className="section-heading lp-library-heading">
          <div>
            <p className="eyebrow">CHOISI POUR TON PARCOURS</p>
            <h2>{category === "Tous les cours" ? "Explorer la bibliothèque" : category}</h2>
          </div>
          <p className="muted">{visibleCourses.length} cours · catalogue d’exemples</p>
        </div>

        {visibleCourses.length ? (
          <div className="lp-course-grid">
            {visibleCourses.map((course) => <CourseCard key={course.id} course={course} progress={courseProgress(course)} />)}
          </div>
        ) : (
          <div className="panel lp-empty-state">
            <Search size={24} />
            <h3>Aucun cours d’exemple ne correspond à cette recherche.</h3>
            <p className="muted">Essaie un sujet plus général ou reviens à tous les cours.</p>
            <button type="button" className="btn secondary" onClick={() => { setCategory("Tous les cours"); setQuery(""); }}>Effacer les filtres</button>
          </div>
        )}
      </section>
    </div>
  );
}
