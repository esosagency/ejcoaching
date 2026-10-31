import type { CSSProperties, FormEvent } from "react";
import { useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  CirclePlus,
  ExternalLink,
  FileText,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  X,
} from "lucide-react";
import { Link, useLocation } from "wouter";
import type { Course, CourseIcon, CourseInput } from "@shared/content";
import AdminGate from "@/components/AdminGate";
import { trpc } from "@/lib/trpc";
import "./Admin.css";

const iconOptions: Array<{ value: CourseIcon; label: string }> = [
  { value: "nutrition", label: "Nutrition" },
  { value: "training", label: "Entraînement" },
  { value: "mindset", label: "Mentalité" },
  { value: "deficit", label: "Déficit" },
  { value: "surplus", label: "Surplus" },
  { value: "equipment", label: "Équipement" },
  { value: "supplements", label: "Suppléments" },
];

type StatusFilter = "all" | "draft" | "published";

function newCourseInput(): CourseInput {
  return {
    title: "",
    category: "Nutrition",
    eyebrow: "ACADÉMIE EJ COACHING",
    description: "",
    color: "#8a66ef",
    image: "",
    icon: "nutrition",
    status: "draft",
    isSample: false,
  };
}

function courseStatus(course: Course): "draft" | "published" {
  return course.status === "published" ? "published" : "draft";
}

function CreateCourseModal({
  onClose,
  onCreate,
  isSaving,
}: {
  onClose: () => void;
  onCreate: (input: CourseInput) => Promise<void>;
  isSaving: boolean;
}) {
  const [form, setForm] = useState<CourseInput>(newCourseInput);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !isSaving) onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isSaving, onClose]);

  const update = <Key extends keyof CourseInput>(
    key: Key,
    value: CourseInput[Key]
  ) => {
    setForm(current => ({ ...current, [key]: value }));
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.title.trim()) {
      setError("Donne un titre à ton cours avant de le créer.");
      return;
    }
    if (!form.category.trim()) {
      setError("Ajoute une catégorie pour classer ce cours.");
      return;
    }
    if (!form.description.trim()) {
      setError("Ajoute une description pour présenter ce cours.");
      return;
    }

    setError(null);
    try {
      await onCreate({
        ...form,
        title: form.title.trim(),
        category: form.category.trim(),
        eyebrow: form.eyebrow.trim(),
        description: form.description.trim(),
        image: form.image?.trim() || undefined,
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "La création du cours a échoué. Réessaie."
      );
    }
  };

  return (
    <div
      className="admin-modal-backdrop"
      role="presentation"
      onMouseDown={event => {
        if (event.target === event.currentTarget && !isSaving) onClose();
      }}
    >
      <section
        className="admin-modal panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-course-title"
      >
        <header className="admin-modal-header">
          <div>
            <p className="eyebrow">
              <span className="eyebrow-line" /> NOUVEAU COURS
            </p>
            <h2 id="new-course-title">Créer un cours</h2>
            <p>
              Le cours est enregistré comme brouillon par défaut. Tu pourras
              ajouter ses leçons ensuite.
            </p>
          </div>
          <button
            type="button"
            className="icon-button admin-modal-close"
            aria-label="Fermer la création de cours"
            onClick={onClose}
            disabled={isSaving}
          >
            <X size={20} />
          </button>
        </header>

        <form onSubmit={submit}>
          <div className="admin-form-grid">
            <label className="admin-field is-full">
              <span>Titre du cours</span>
              <input
                autoFocus
                value={form.title}
                onChange={event => update("title", event.target.value)}
                placeholder="Ex. Bâtir une routine qui te convient"
                required
              />
            </label>
            <label className="admin-field">
              <span>Catégorie</span>
              <input
                value={form.category}
                onChange={event => update("category", event.target.value)}
                placeholder="Ex. Nutrition"
                required
              />
            </label>
            <label className="admin-field">
              <span>Étiquette</span>
              <input
                value={form.eyebrow}
                onChange={event => update("eyebrow", event.target.value)}
                placeholder="ACADÉMIE EJ COACHING"
              />
            </label>
            <label className="admin-field is-full">
              <span>Description</span>
              <textarea
                value={form.description}
                onChange={event => update("description", event.target.value)}
                placeholder="Explique ce que la personne va pouvoir apprendre."
              />
            </label>
            <label className="admin-field">
              <span>Icône</span>
              <select
                value={form.icon}
                onChange={event =>
                  update("icon", event.target.value as CourseIcon)
                }
              >
                {iconOptions.map(icon => (
                  <option key={icon.value} value={icon.value}>
                    {icon.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="admin-field">
              <span>Couleur</span>
              <span className="admin-input-row">
                <input
                  aria-label="Sélecteur de couleur"
                  type="color"
                  value={form.color}
                  onChange={event => update("color", event.target.value)}
                />
                <input
                  value={form.color}
                  onChange={event => update("color", event.target.value)}
                  placeholder="#8a66ef"
                />
              </span>
            </label>
            <label className="admin-field is-full">
              <span>
                URL de couverture <small>(facultatif)</small>
              </span>
              <input
                type="url"
                value={form.image ?? ""}
                onChange={event => update("image", event.target.value)}
                placeholder="https://…"
              />
            </label>
            <fieldset className="admin-field is-full">
              <span>État de publication</span>
              <div className="admin-choice-row">
                <label className="admin-choice">
                  <input
                    type="radio"
                    name="new-course-status"
                    checked={form.status === "draft"}
                    onChange={() => update("status", "draft")}
                  />{" "}
                  Brouillon
                </label>
                <label className="admin-choice">
                  <input
                    type="radio"
                    name="new-course-status"
                    checked={form.status === "published"}
                    onChange={() => update("status", "published")}
                  />{" "}
                  Publié
                </label>
              </div>
            </fieldset>
            <label className="admin-switch is-full">
              <input
                type="checkbox"
                checked={form.isSample}
                onChange={event => update("isSample", event.target.checked)}
              />
              Marquer comme cours d’exemple
            </label>
          </div>
          {error && (
            <p className="admin-form-error" role="alert">
              {error}
            </p>
          )}
          <footer className="admin-form-actions">
            <button
              type="button"
              className="btn secondary"
              onClick={onClose}
              disabled={isSaving}
            >
              Annuler
            </button>
            <button type="submit" className="btn primary" disabled={isSaving}>
              {isSaving ? (
                <LoaderCircle size={16} className="admin-spin-icon" />
              ) : (
                <CirclePlus size={16} />
              )}
              {isSaving ? "Création…" : "Créer le cours"}
            </button>
          </footer>
        </form>
      </section>
    </div>
  );
}

function CoursesContent() {
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const coursesQuery = trpc.content.adminList.useQuery(undefined, {
    refetchOnWindowFocus: false,
  });
  const createCourse = trpc.content.createCourse.useMutation();
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [creating, setCreating] = useState(false);

  const visibleCourses = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase("fr-CA");
    return (coursesQuery.data ?? []).filter(course => {
      const status = courseStatus(course);
      const matchesStatus = statusFilter === "all" || status === statusFilter;
      const matchesQuery =
        !normalizedQuery ||
        [course.title, course.category, course.eyebrow, course.description]
          .join(" ")
          .toLocaleLowerCase("fr-CA")
          .includes(normalizedQuery);
      return matchesStatus && matchesQuery;
    });
  }, [coursesQuery.data, query, statusFilter]);

  const invalidateContent = async () => {
    await Promise.all([
      utils.content.catalog.invalidate(),
      utils.content.adminList.invalidate(),
      utils.content.adminGet.invalidate(),
    ]);
  };

  const handleCreate = async (input: CourseInput) => {
    const result = await createCourse.mutateAsync({
      ...input,
      image: input.image,
    });
    await invalidateContent();
    setCreating(false);
    setLocation(`/admin/courses/${result.id}`);
  };

  return (
    <div className="admin-page">
      <header className="admin-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-line" /> ADMINISTRATION
          </p>
          <h1 className="page-title">Gérer mes cours</h1>
          <p className="admin-lead">
            Crée, organise et publie les cours de l’académie. Les brouillons
            restent invisibles dans la bibliothèque cliente.
          </p>
        </div>
        <div className="admin-heading-actions">
          <button
            type="button"
            className="btn primary"
            onClick={() => setCreating(true)}
          >
            <Plus size={17} /> Créer un cours
          </button>
        </div>
      </header>

      <section aria-labelledby="course-list-title">
        <div className="admin-toolbar">
          <div className="admin-toolbar-copy">
            <h2 id="course-list-title">Tous les cours</h2>
            <p>
              {coursesQuery.data?.length ?? 0} cours accessibles dans
              l’administration
            </p>
          </div>
          <div className="admin-filters">
            <label
              className="admin-search"
              aria-label="Rechercher parmi les cours"
            >
              <Search size={16} />
              <input
                value={query}
                onChange={event => setQuery(event.target.value)}
                placeholder="Rechercher un cours…"
              />
            </label>
            <select
              className="admin-filter-select"
              value={statusFilter}
              onChange={event =>
                setStatusFilter(event.target.value as StatusFilter)
              }
              aria-label="Filtrer par état"
            >
              <option value="all">Tous les états</option>
              <option value="draft">Brouillons</option>
              <option value="published">Publiés</option>
            </select>
          </div>
        </div>

        {coursesQuery.isLoading ? (
          <div className="panel admin-loading" aria-live="polite">
            <LoaderCircle size={25} className="admin-spin-icon" /> Chargement
            des cours…
          </div>
        ) : coursesQuery.isError ? (
          <div className="panel admin-query-error" role="alert">
            <FileText size={27} />
            <h2>Impossible de charger les cours</h2>
            <p>Réessaie dans un instant. Aucun contenu n’a été modifié.</p>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                void coursesQuery.refetch();
              }}
            >
              Réessayer
            </button>
          </div>
        ) : visibleCourses.length ? (
          <div className="admin-course-grid">
            {visibleCourses.map(course => {
              const status = courseStatus(course);
              return (
                <article key={course.id} className="admin-course-panel">
                  <span
                    className="admin-course-color"
                    style={
                      { "--admin-course-color": course.color } as CSSProperties
                    }
                  />
                  <div className="admin-course-body">
                    <div className="admin-course-meta">
                      <span
                        className={`admin-status ${status === "published" ? "is-published" : ""}`}
                      >
                        {status === "published" ? "Publié" : "Brouillon"}
                      </span>
                      {course.isSample && (
                        <span className="admin-sample-label">EXEMPLE</span>
                      )}
                    </div>
                    <h3>{course.title}</h3>
                    <p className="admin-course-description">
                      {course.description ||
                        "Aucune description pour le moment."}
                    </p>
                    <div className="admin-course-details">
                      <span>
                        <BookOpen size={13} /> {course.lessons.length} leçon
                        {course.lessons.length === 1 ? "" : "s"}
                      </span>
                      <span>{course.category}</span>
                    </div>
                  </div>
                  <footer className="admin-course-actions">
                    <Link
                      className="btn secondary"
                      href={`/admin/courses/${course.id}`}
                    >
                      <Pencil size={14} /> Modifier
                    </Link>
                    {status === "published" && (
                      <Link
                        className="btn secondary"
                        href={`/courses/${course.id}`}
                      >
                        <ExternalLink size={14} /> Voir publié
                      </Link>
                    )}
                  </footer>
                </article>
              );
            })}
          </div>
        ) : (
          <div className="panel admin-empty">
            <Search size={27} />
            <h2>Aucun cours ne correspond</h2>
            <p>
              {query || statusFilter !== "all"
                ? "Essaie une autre recherche ou enlève le filtre d’état."
                : "Crée ton premier cours pour commencer à bâtir la bibliothèque."}
            </p>
            {query || statusFilter !== "all" ? (
              <button
                type="button"
                className="btn secondary"
                onClick={() => {
                  setQuery("");
                  setStatusFilter("all");
                }}
              >
                Effacer les filtres
              </button>
            ) : (
              <button
                type="button"
                className="btn primary"
                onClick={() => setCreating(true)}
              >
                <Plus size={16} /> Créer un cours
              </button>
            )}
          </div>
        )}
      </section>

      {creating && (
        <CreateCourseModal
          onClose={() => setCreating(false)}
          onCreate={handleCreate}
          isSaving={createCourse.isPending}
        />
      )}
    </div>
  );
}

export default function AdminCourses() {
  return (
    <AdminGate>
      <CoursesContent />
    </AdminGate>
  );
}
