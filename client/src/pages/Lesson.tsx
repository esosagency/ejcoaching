import {
  Bookmark,
  Check,
  ChevronLeft,
  ChevronRight,
  FileText,
  ListVideo,
  LoaderCircle,
  LockKeyhole,
  Pause,
  Play,
  Save,
  Sparkles,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { getVimeoEmbedUrl } from "@shared/vimeo";
import { useCatalog } from "@/contexts/CatalogContext";
import { useLearning } from "@/contexts/LearningContext";
import { useAccess } from "@/contexts/AccessContext";
import { accountStorageKey, readAccountStorage } from "@/lib/accountStorage";
import NotFound from "@/pages/NotFound";
import "./LearningPages.css";

type LessonTab = "overview" | "notes" | "resources";

function readNotes(key: string, legacy?: string, owner = false) {
  try {
    return typeof window === "undefined"
      ? ""
      : readAccountStorage(key, legacy, owner) || "";
  } catch {
    return "";
  }
}

function embedId(pathname: string, marker: string) {
  const parts = pathname.split("/").filter(Boolean);
  const index = parts.indexOf(marker);
  return index >= 0 ? parts[index + 1] : undefined;
}

function safeEmbedUrl(value?: string) {
  if (!value?.trim()) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:") return null;
    const host = url.hostname.toLowerCase();
    const pathParts = url.pathname.split("/").filter(Boolean);

    if (
      ["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(
        host
      )
    ) {
      const id =
        host === "youtu.be"
          ? pathParts[0]
          : url.searchParams.get("v") ||
            embedId(url.pathname, "embed") ||
            embedId(url.pathname, "shorts") ||
            embedId(url.pathname, "live");
      return id && /^[A-Za-z0-9_-]{6,}$/.test(id)
        ? `https://www.youtube-nocookie.com/embed/${encodeURIComponent(id)}?rel=0`
        : null;
    }

    if (["vimeo.com", "www.vimeo.com", "player.vimeo.com"].includes(host))
      return getVimeoEmbedUrl(value);

    if (
      [
        "wistia.com",
        "www.wistia.com",
        "fast.wistia.com",
        "fast.wistia.net",
      ].includes(host)
    ) {
      const id =
        embedId(url.pathname, "medias") ||
        embedId(url.pathname, "media") ||
        embedId(url.pathname, "iframe");
      return id && /^[A-Za-z0-9_-]+$/.test(id)
        ? `https://fast.wistia.net/embed/medias/${encodeURIComponent(id)}`
        : null;
    }
  } catch {
    return null;
  }
  return null;
}

export default function Lesson() {
  const { courseId, id, lessonId } = useParams<{
    courseId?: string;
    id?: string;
    lessonId?: string;
  }>();
  const {
    courses: catalogCourses,
    loading,
    error,
    retry,
    isAdminPreview,
  } = useCatalog();
  const {
    completed,
    saved,
    toggleComplete,
    toggleSaved,
    visitLesson,
    courseProgress,
  } = useLearning();
  const [, navigate] = useLocation();
  const requestedCourseId = courseId || id || "";
  const courses = isAdminPreview
    ? catalogCourses
    : catalogCourses.filter(course => course.status !== "draft");
  const course = courses.find(item => item.id === requestedCourseId);
  const lesson = course?.lessons.find(item => item.id === lessonId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [videoError, setVideoError] = useState(false);
  const [activeTab, setActiveTab] = useState<LessonTab>("overview");
  const { access } = useAccess();
  const notesKey = accountStorageKey(
    access?.user?.id,
    `notes-${lessonId || "unknown"}`
  );
  const legacyNotesKey = `ej-demo-notes-${lessonId || "unknown"}`;
  const [notes, setNotes] = useState(() =>
    readNotes(notesKey, legacyNotesKey, Boolean(access?.isAdmin))
  );

  useEffect(() => {
    if (lesson && !isAdminPreview) visitLesson(lesson.id);
  }, [isAdminPreview, lesson?.id, visitLesson]);

  useEffect(() => {
    setNotes(readNotes(notesKey, legacyNotesKey, Boolean(access?.isAdmin)));
    setControlsVisible(false);
    setActiveTab("overview");
  }, [notesKey]);

  useEffect(() => {
    setControlsVisible(false);
    setVideoError(false);
  }, [lesson?.videoUrl]);

  useEffect(() => {
    const currentVideo = videoRef.current;
    return () => {
      currentVideo?.pause();
    };
  }, [lesson?.id]);

  useEffect(() => {
    if (!lessonId) return;
    try {
      localStorage.setItem(notesKey, notes);
    } catch {
      /* Browser storage is optional. */
    }
  }, [lessonId, notes, notesKey]);

  if (loading)
    return (
      <div className="lp-page">
        <section className="panel lp-empty-state">
          <ListVideo size={26} />
          <h2>Chargement de la leçon</h2>
          <p className="muted">Le contenu est en cours de préparation.</p>
        </section>
      </div>
    );
  if (error)
    return (
      <div className="lp-page">
        <section className="panel lp-empty-state">
          <ListVideo size={26} />
          <h2>La leçon est momentanément indisponible.</h2>
          <p className="muted">Réessaie dans un instant.</p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => retry()}
          >
            Réessayer
          </button>
        </section>
      </div>
    );
  if (!course || !lesson) return <NotFound />;

  const lessonIndex = course.lessons.findIndex(item => item.id === lesson.id);
  const previousLesson = course.lessons[lessonIndex - 1];
  const nextLesson = course.lessons[lessonIndex + 1];
  const isCompleted = completed.includes(lesson.id);
  const isSaved = saved.includes(lesson.id);
  const progress = course.lessons.length ? courseProgress(course) : 0;
  const videoType = lesson.videoType || "demo";
  const pendingWithoutVideo = Boolean(
    lesson.videoPending && (!lesson.videoUrl || videoType === "demo")
  );
  const isDemoVideo = videoType === "demo" && !pendingWithoutVideo;
  const fileVideoUrl =
    videoType === "file" ? lesson.videoUrl?.trim() : undefined;
  const embedVideoUrl =
    videoType === "embed" ? safeEmbedUrl(lesson.videoUrl) : null;
  const showsSampleBadge = course.isSample !== false || isDemoVideo;
  const courseLink = isAdminPreview
    ? `/admin/preview/${course.id}`
    : `/courses/${course.id}`;
  const lessonLink = (targetId: string) =>
    isAdminPreview
      ? `/admin/preview/${course.id}/lesson/${targetId}`
      : `/learn/${course.id}/${targetId}`;
  const moveTo = (targetId: string) => navigate(lessonLink(targetId));
  const startVideo = () => {
    setControlsVisible(true);
    void videoRef.current?.play().catch(() => undefined);
  };

  return (
    <div className="lp-page lp-lesson-page">
      {isAdminPreview && (
        <div className="lp-demo-badge">
          Aperçu administrateur · ce cours n’est pas nécessairement publié
        </div>
      )}
      <nav className="lp-breadcrumb" aria-label="Fil d’Ariane">
        {isAdminPreview ? (
          <Link href="/admin">Administration</Link>
        ) : (
          <Link href="/courses">Bibliothèque de cours</Link>
        )}
        <ChevronRight size={14} />
        <Link href={courseLink}>{course.title}</Link>
        <ChevronRight size={14} />
        <span>{lesson.title}</span>
      </nav>
      <div className="lp-lesson-heading">
        <div>
          {showsSampleBadge && (
            <div className="lp-demo-badge">LEÇON D’EXEMPLE</div>
          )}
          <p className="eyebrow">{course.eyebrow}</p>
          <h1 className="page-title">{lesson.title}</h1>
        </div>
        {!isAdminPreview && (
          <div className="lp-lesson-heading-actions">
            <button
              type="button"
              className={`btn secondary lp-save-button ${isSaved ? "is-saved" : ""}`}
              onClick={() => toggleSaved(lesson.id)}
            >
              <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} />{" "}
              {isSaved ? "Enregistrée" : "Enregistrer la leçon"}
            </button>
            <button
              type="button"
              className={`btn ${isCompleted ? "secondary" : "primary"}`}
              onClick={() => toggleComplete(lesson.id)}
            >
              <Check size={16} />{" "}
              {isCompleted ? "Leçon terminée" : "Terminer la leçon"}
            </button>
          </div>
        )}
      </div>
      <section className="lp-player-layout">
        <div className="lp-video-column">
          <div className="lp-video-shell panel">
            {pendingWithoutVideo ? (
              <div className="lp-resource-tab lp-video-state" role="status">
                <LoaderCircle size={24} />
                <h3>La vidéo est en cours de préparation</h3>
                <p>Elle sera disponible ici après sa conversion.</p>
              </div>
            ) : isDemoVideo ? (
              <>
                <video
                  key={`${lesson.id}:demo:${lesson.videoUrl || "default"}`}
                  ref={videoRef}
                  className="lp-demo-video"
                  controls={controlsVisible}
                  poster={course.image}
                  preload="metadata"
                  playsInline
                  onPlay={() => setControlsVisible(true)}
                >
                  <source
                    src={lesson.videoUrl?.trim() || "/media/player-demo-fr.mp4"}
                    type="video/mp4"
                  />
                  Ton navigateur ne prend pas en charge la lecture vidéo.
                </video>
                {!controlsVisible && (
                  <button
                    className="lp-play-overlay"
                    type="button"
                    onClick={startVideo}
                    aria-label="Lire la vidéo d’exemple"
                  >
                    <span>
                      <Play size={24} fill="currentColor" />
                    </span>
                    <strong>Lire la démo</strong>
                  </button>
                )}
                <div className="lp-demo-video-label">
                  <Sparkles size={13} /> Démo d’interface de 12 secondes · pas
                  une leçon de coaching
                </div>
              </>
            ) : fileVideoUrl ? (
              <>
                <video
                  key={`${lesson.id}:file:${fileVideoUrl}`}
                  ref={videoRef}
                  className="lp-demo-video"
                  controls={controlsVisible}
                  poster={lesson.videoPosterUrl || course.image}
                  preload="metadata"
                  playsInline
                  onPlay={() => setControlsVisible(true)}
                  onError={() => setVideoError(true)}
                >
                  <source src={fileVideoUrl} />
                  Ton navigateur ne prend pas en charge la lecture vidéo.
                </video>
                {!controlsVisible && !videoError && (
                  <button
                    className="lp-play-overlay"
                    type="button"
                    onClick={startVideo}
                    aria-label={`Lire la leçon : ${lesson.title}`}
                  >
                    <span>
                      <Play size={24} fill="currentColor" />
                    </span>
                    <strong>Lire la leçon</strong>
                  </button>
                )}
                {videoError && (
                  <div className="lp-resource-tab lp-video-state" role="alert">
                    <p>
                      La vidéo n’a pas pu être chargée. Vérifie ta connexion et
                      réessaie.
                    </p>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => {
                        setVideoError(false);
                        setControlsVisible(false);
                        videoRef.current?.load();
                      }}
                    >
                      Réessayer la lecture
                    </button>
                  </div>
                )}
              </>
            ) : embedVideoUrl ? (
              <iframe
                key={`${lesson.id}:embed:${embedVideoUrl}`}
                className="lp-demo-video"
                src={embedVideoUrl}
                title={`Vidéo : ${lesson.title}`}
                allow="accelerometer; encrypted-media; picture-in-picture"
                allowFullScreen
                referrerPolicy="strict-origin-when-cross-origin"
              />
            ) : (
              <div className="lp-resource-tab">
                <FileText size={22} />
                <h3>La vidéo sera ajoutée bientôt</h3>
                <p>Cette leçon n’a pas encore de vidéo disponible.</p>
              </div>
            )}
          </div>
          <div
            className="lp-lesson-tabs"
            role="tablist"
            aria-label="Information sur la leçon"
          >
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "overview"}
              className={activeTab === "overview" ? "is-active" : ""}
              onClick={() => setActiveTab("overview")}
            >
              Aperçu
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "notes"}
              className={activeTab === "notes" ? "is-active" : ""}
              onClick={() => setActiveTab("notes")}
            >
              Notes
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "resources"}
              className={activeTab === "resources" ? "is-active" : ""}
              onClick={() => setActiveTab("resources")}
            >
              Ressources
            </button>
          </div>
          <div className="lp-lesson-tab-panel panel">
            {activeTab === "overview" && (
              <div className="lp-overview-tab">
                <div>
                  <p className="eyebrow">APERÇU DE LA LEÇON</p>
                  <p className="lp-lead">{lesson.description}</p>
                </div>
                <div className="lp-takeaway-block">
                  <h3>Points à retenir</h3>
                  <ul>
                    {lesson.takeaways.map(takeaway => (
                      <li key={takeaway}>
                        <Check size={16} />
                        {takeaway}
                      </li>
                    ))}
                  </ul>
                </div>
                <p className="lp-disclaimer">
                  <LockKeyhole size={14} />{" "}
                  {showsSampleBadge
                    ? "Il s’agit de contenu éducatif d’exemple. Les plans et conseils personnalisés relèvent de ta conversation de coaching ou de soins de santé."
                    : "Ce contenu est éducatif. Les conseils personnalisés relèvent de ta conversation de coaching ou de soins de santé."}
                </p>
              </div>
            )}
            {activeTab === "notes" && (
              <div className="lp-notes-tab">
                <div className="lp-tab-title">
                  <div>
                    <p className="eyebrow">TA RÉFLEXION</p>
                    <h3>Garde une note pour plus tard.</h3>
                  </div>
                  <span>Dans ce navigateur</span>
                </div>
                <textarea
                  value={notes}
                  onChange={event => setNotes(event.target.value)}
                  placeholder="Qu’aimerais-tu retenir ou demander à ton coach?"
                  aria-label="Notes personnelles de la leçon"
                />
                <p>
                  <Save size={14} /> S’enregistre seulement dans ce navigateur.
                </p>
              </div>
            )}
            {activeTab === "resources" && (
              <div className="lp-resource-tab">
                <FileText size={22} />
                <h3>
                  {lesson.resources?.length
                    ? "Documents liés à cette leçon"
                    : "Aucun document lié pour le moment"}
                </h3>
                <p>
                  {lesson.resources?.length
                    ? "Ouvre un document dans un nouvel onglet pour le consulter ou le télécharger."
                    : "Les documents ajoutés par le coaching apparaîtront ici."}
                </p>
                {lesson.resources?.map(resource => (
                  <a
                    key={resource.id}
                    href={resource.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="btn secondary"
                  >
                    <FileText size={16} /> {resource.title}
                    {resource.filename ? ` · ${resource.filename}` : ""}
                  </a>
                ))}
                <Link href="/resources" className="btn secondary">
                  Voir les fiches d’exemple <ChevronRight size={16} />
                </Link>
              </div>
            )}
          </div>
          <div className="lp-lesson-navigation">
            <button
              type="button"
              className="btn secondary"
              disabled={!previousLesson}
              onClick={() => previousLesson && moveTo(previousLesson.id)}
            >
              <ChevronLeft size={17} /> Précédente
            </button>
            <span>
              {lessonIndex + 1} sur {course.lessons.length}
            </span>
            <button
              type="button"
              className="btn primary"
              disabled={!nextLesson}
              onClick={() => nextLesson && moveTo(nextLesson.id)}
            >
              Leçon suivante <ChevronRight size={17} />
            </button>
          </div>
        </div>
        <aside className="lp-player-sidebar panel">
          <div className="lp-player-sidebar-title">
            <div>
              <p className="eyebrow">À SUIVRE</p>
              <h2>{course.title}</h2>
            </div>
            <ListVideo size={19} />
          </div>
          <div className="lp-mini-progress">
            <div>
              <span>Progression dans ce navigateur</span>
              <strong>{progress} %</strong>
            </div>
            <div className="progress-track">
              <span
                className="progress-fill"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
          <div className="lp-player-lesson-list">
            {course.lessons.map((item, index) => {
              const itemDone = completed.includes(item.id);
              const current = item.id === lesson.id;
              return (
                <Link
                  key={item.id}
                  href={lessonLink(item.id)}
                  className={`lp-player-lesson ${current ? "is-current" : ""}`}
                >
                  <span
                    className={`lp-player-number ${itemDone ? "is-done" : ""}`}
                  >
                    {itemDone ? <Check size={13} /> : index + 1}
                  </span>
                  <span>
                    <strong>{item.title}</strong>
                    <small>{item.duration}</small>
                  </span>
                  {current && <Pause size={15} fill="currentColor" />}
                </Link>
              );
            })}
          </div>
        </aside>
      </section>
    </div>
  );
}
