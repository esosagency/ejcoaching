import { Bookmark, Check, ChevronLeft, ChevronRight, FileText, ListVideo, LockKeyhole, Pause, Play, Save, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useParams } from "wouter";
import { useLearning } from "@/contexts/LearningContext";
import { getCourse } from "@/lib/courses";
import NotFound from "@/pages/NotFound";
import "./LearningPages.css";

type LessonTab = "overview" | "notes" | "resources";

function readNotes(key: string) {
  try { return typeof window === "undefined" ? "" : localStorage.getItem(key) || ""; }
  catch { return ""; }
}

export default function Lesson() {
  const { courseId, lessonId } = useParams<{ courseId: string; lessonId: string }>();
  const course = getCourse(courseId);
  const lesson = course?.lessons.find((item) => item.id === lessonId);
  const [, navigate] = useLocation();
  const { completed, saved, toggleComplete, toggleSaved, visitLesson, courseProgress } = useLearning();
  const videoRef = useRef<HTMLVideoElement>(null);
  const [controlsVisible, setControlsVisible] = useState(false);
  const [activeTab, setActiveTab] = useState<LessonTab>("overview");
  const notesKey = `ej-demo-notes-${lessonId}`;
  const [notes, setNotes] = useState(() => readNotes(notesKey));

  useEffect(() => {
    if (lesson) visitLesson(lesson.id);
  }, [lesson?.id, visitLesson]);

  useEffect(() => {
    setNotes(readNotes(notesKey));
  }, [notesKey]);

  useEffect(() => {
    try { localStorage.setItem(notesKey, notes); }
    catch { /* Browser storage is optional for this prototype. */ }
  }, [notes, notesKey]);

  if (!course || !lesson) return <NotFound />;

  const lessonIndex = course.lessons.findIndex((item) => item.id === lesson.id);
  const previousLesson = course.lessons[lessonIndex - 1];
  const nextLesson = course.lessons[lessonIndex + 1];
  const isCompleted = completed.includes(lesson.id);
  const isSaved = saved.includes(lesson.id);
  const progress = courseProgress(course);

  const startDemo = () => {
    setControlsVisible(true);
    void videoRef.current?.play().catch(() => undefined);
  };

  const moveTo = (targetId: string) => navigate(`/learn/${course.id}/${targetId}`);

  return (
    <div className="lp-page lp-lesson-page">
      <nav className="lp-breadcrumb" aria-label="Fil d’Ariane">
        <Link href="/courses">Bibliothèque de cours</Link><ChevronRight size={14} />
        <Link href={`/courses/${course.id}`}>{course.title}</Link><ChevronRight size={14} />
        <span>{lesson.title}</span>
      </nav>

      <div className="lp-lesson-heading">
        <div>
          <div className="lp-demo-badge">LEÇON D’EXEMPLE</div>
          <p className="eyebrow">{course.eyebrow}</p>
          <h1 className="page-title">{lesson.title}</h1>
        </div>
        <div className="lp-lesson-heading-actions">
          <button type="button" className={`btn secondary lp-save-button ${isSaved ? "is-saved" : ""}`} onClick={() => toggleSaved(lesson.id)}>
            <Bookmark size={16} fill={isSaved ? "currentColor" : "none"} /> {isSaved ? "Enregistrée" : "Enregistrer la leçon"}
          </button>
          <button type="button" className={`btn ${isCompleted ? "secondary" : "primary"}`} onClick={() => toggleComplete(lesson.id)}>
            <Check size={16} /> {isCompleted ? "Leçon terminée" : "Terminer la leçon"}
          </button>
        </div>
      </div>

      <section className="lp-player-layout">
        <div className="lp-video-column">
          <div className="lp-video-shell panel">
            <video ref={videoRef} className="lp-demo-video" controls={controlsVisible} poster={course.image} onPlay={() => setControlsVisible(true)}>
              <source src="/media/player-demo-fr.mp4" type="video/mp4" />
              Ton navigateur ne prend pas en charge la lecture vidéo.
            </video>
            {!controlsVisible && (
              <button className="lp-play-overlay" type="button" onClick={startDemo} aria-label="Lire la démo">
                <span><Play size={24} fill="currentColor" /></span>
                <strong>Lire la démo</strong>
              </button>
            )}
            <div className="lp-demo-video-label"><Sparkles size={13} /> Démo d’interface de 12 secondes · pas une leçon de coaching</div>
          </div>

          <div className="lp-lesson-tabs" role="tablist" aria-label="Information sur la leçon">
            <button type="button" role="tab" aria-selected={activeTab === "overview"} className={activeTab === "overview" ? "is-active" : ""} onClick={() => setActiveTab("overview")}>Aperçu</button>
            <button type="button" role="tab" aria-selected={activeTab === "notes"} className={activeTab === "notes" ? "is-active" : ""} onClick={() => setActiveTab("notes")}>Notes</button>
            <button type="button" role="tab" aria-selected={activeTab === "resources"} className={activeTab === "resources" ? "is-active" : ""} onClick={() => setActiveTab("resources")}>Ressources</button>
          </div>

          <div className="lp-lesson-tab-panel panel">
            {activeTab === "overview" && (
              <div className="lp-overview-tab">
                <div><p className="eyebrow">APERÇU DE LA LEÇON</p><p className="lp-lead">{lesson.description}</p></div>
                <div className="lp-takeaway-block">
                  <h3>Points à retenir</h3>
                  <ul>{lesson.takeaways.map((takeaway) => <li key={takeaway}><Check size={16} />{takeaway}</li>)}</ul>
                </div>
                <p className="lp-disclaimer"><LockKeyhole size={14} /> Il s’agit de contenu éducatif d’exemple. Les plans et conseils personnalisés relèvent de ta conversation de coaching ou de soins de santé.</p>
              </div>
            )}
            {activeTab === "notes" && (
              <div className="lp-notes-tab">
                <div className="lp-tab-title"><div><p className="eyebrow">TA RÉFLEXION</p><h3>Garde une note pour plus tard.</h3></div><span>Dans ce navigateur</span></div>
                <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Qu’aimerais-tu retenir ou demander à ton coach?" aria-label="Notes personnelles de la leçon" />
                <p><Save size={14} /> S’enregistre seulement dans ce navigateur pour la démo.</p>
              </div>
            )}
            {activeTab === "resources" && (
              <div className="lp-resource-tab">
                <FileText size={22} />
                <h3>Plan d’exemple connexe</h3>
                <p>Utilise les questions de réflexion téléchargeables de la bibliothèque des ressources pour poursuivre ce sujet — ce prototype ne permet ni téléversement privé ni suivi.</p>
                <Link href="/resources" className="btn secondary">Parcourir les ressources d’exemple <ChevronRight size={16} /></Link>
              </div>
            )}
          </div>

          <div className="lp-lesson-navigation">
            <button type="button" className="btn secondary" disabled={!previousLesson} onClick={() => previousLesson && moveTo(previousLesson.id)}><ChevronLeft size={17} /> Précédente</button>
            <span>{lessonIndex + 1} sur {course.lessons.length}</span>
            <button type="button" className="btn primary" disabled={!nextLesson} onClick={() => nextLesson && moveTo(nextLesson.id)}>Leçon suivante <ChevronRight size={17} /></button>
          </div>
        </div>

        <aside className="lp-player-sidebar panel">
          <div className="lp-player-sidebar-title"><div><p className="eyebrow">À SUIVRE</p><h2>{course.title}</h2></div><ListVideo size={19} /></div>
          <div className="lp-mini-progress"><div><span>Progression de la démo</span><strong>{progress} %</strong></div><div className="progress-track"><span className="progress-fill" style={{ width: `${progress}%` }} /></div></div>
          <div className="lp-player-lesson-list">
            {course.lessons.map((item, index) => {
              const itemDone = completed.includes(item.id);
              const current = item.id === lesson.id;
              return (
                <Link key={item.id} href={`/learn/${course.id}/${item.id}`} className={`lp-player-lesson ${current ? "is-current" : ""}`}>
                  <span className={`lp-player-number ${itemDone ? "is-done" : ""}`}>{itemDone ? <Check size={13} /> : index + 1}</span>
                  <span><strong>{item.title}</strong><small>{item.duration} métadonnées d’exemple</small></span>
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
