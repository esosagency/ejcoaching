import { Search, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import CourseCard from "@/components/CourseCard";
import { useCatalog } from "@/contexts/CatalogContext";
import { useLearning } from "@/contexts/LearningContext";
import type { Course } from "@shared/content";
import "./LearningPages.css";

const allCoursesCategory = "Tous les cours";

function safeCourseProgress(course: Course, courseProgress: (course: Course) => number) {
  return course.lessons.length ? courseProgress(course) : 0;
}

export default function Library() {
  const [category, setCategory] = useState(allCoursesCategory);
  const [query, setQuery] = useState("");
  const { courses: catalogCourses, loading, error, retry, isAdminPreview } = useCatalog();
  const { courseProgress } = useLearning();
  const courses = useMemo(() => isAdminPreview ? catalogCourses : catalogCourses.filter((course) => course.status !== "draft"), [catalogCourses, isAdminPreview]);
  const categories = useMemo(() => [
    allCoursesCategory,
    ...Array.from(new Set(courses.map((course) => course.category).filter(Boolean))).sort((left, right) => left.localeCompare(right, "fr-CA")),
  ], [courses]);
  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr-CA");
    return courses.filter((course) => {
      const matchesCategory = category === allCoursesCategory || course.category === category;
      const searchableContent = [
        course.title,
        course.description,
        course.category,
        course.eyebrow,
        ...course.lessons.flatMap((lesson) => [lesson.title, lesson.description, ...lesson.takeaways]),
      ].join(" ").toLocaleLowerCase("fr-CA");
      return matchesCategory && (!normalizedQuery || searchableContent.includes(normalizedQuery));
    });
  }, [category, courses, query]);

  useEffect(() => {
    if (!categories.includes(category)) setCategory(allCoursesCategory);
  }, [categories, category]);

  if (loading) {
    return <div className="lp-page"><section className="panel lp-empty-state"><Search size={24} /><h2>Chargement de la bibliothèque</h2><p className="muted">Les cours publiés sont en cours de chargement.</p></section></div>;
  }

  if (error) {
    return <div className="lp-page"><section className="panel lp-empty-state"><Search size={24} /><h2>La bibliothèque est momentanément indisponible.</h2><p className="muted">Réessaie dans un instant pour retrouver les cours publiés.</p><button type="button" className="btn secondary" onClick={() => retry()}>Réessayer</button></section></div>;
  }

  const categoryCount = categories.length - 1;
  return (
    <div className="lp-page">
      <section className="lp-library-hero">
        <div className="lp-hero-copy">
          <div className="lp-kicker"><Sparkles size={13} /> Académie EJ Coaching</div>
          <p className="eyebrow">APPRENTISSAGE PAR VIDÉO</p>
          <h1 className="page-title">Comprends le pourquoi derrière ta routine.</h1>
          <p className="lp-lead">Une bibliothèque de cours pour t’aider à gagner en assurance et à poser de meilleures questions lors de tes conversations de coaching.</p>
        </div>
        <div className="lp-library-hero-stat panel">
          <span className="lp-stat-label">LE CATALOGUE</span>
          <strong>{new Intl.NumberFormat("fr-CA").format(courses.length)}</strong>
          <span>{courses.length === 1 ? "cours publié" : "cours publiés"} dans {new Intl.NumberFormat("fr-CA").format(categoryCount)} catégorie{categoryCount === 1 ? "" : "s"}.</span>
        </div>
      </section>
      <section className="lp-library-controls" aria-label="Parcourir les cours">
        <div className="lp-category-row" role="tablist" aria-label="Catégorie de cours">
          {categories.map((item) => (
            <button key={item} type="button" className={`lp-filter-chip ${category === item ? "is-active" : ""}`} onClick={() => setCategory(item)} role="tab" aria-selected={category === item}>{item}</button>
          ))}
        </div>
        <label className="lp-search" aria-label="Rechercher dans la bibliothèque de cours">
          <Search size={17} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Rechercher des leçons, des sujets…" />
        </label>
      </section>
      <section>
        <div className="section-heading lp-library-heading">
          <div><p className="eyebrow">CHOISI POUR TON PARCOURS</p><h2>{category === allCoursesCategory ? "Explorer la bibliothèque" : category}</h2></div>
          <p className="muted">{new Intl.NumberFormat("fr-CA").format(visibleCourses.length)} cours</p>
        </div>
        {visibleCourses.length ? (
          <div className="lp-course-grid">
            {visibleCourses.map((course) => <CourseCard key={course.id} course={course} progress={safeCourseProgress(course, courseProgress)} />)}
          </div>
        ) : courses.length === 0 ? (
          <div className="panel lp-empty-state">
            <Search size={24} />
            <h3>Aucun cours publié pour le moment.</h3>
            <p className="muted">Les nouveaux cours apparaîtront ici dès leur publication.</p>
            <Link href="/admin" className="btn secondary">Accéder à l’administration</Link>
          </div>
        ) : (
          <div className="panel lp-empty-state">
            <Search size={24} />
            <h3>Aucun cours ne correspond à cette recherche.</h3>
            <p className="muted">Essaie un sujet plus général ou reviens à tous les cours.</p>
            <button type="button" className="btn secondary" onClick={() => { setCategory(allCoursesCategory); setQuery(""); }}>Effacer les filtres</button>
          </div>
        )}
      </section>
    </div>
  );
}
