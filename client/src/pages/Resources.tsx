import { ArrowDownToLine, BookOpenText, ClipboardList, FileText, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import { useMemo } from "react";
import { useCatalog } from "@/contexts/CatalogContext";
import type { Course, Lesson, LessonResource } from "@shared/content";
import "./LearningPages.css";

type SampleTemplate = {
  title: string;
  description: string;
  icon: typeof FileText;
  category: string;
};

type CatalogResource = LessonResource & { course: Course; lesson: Lesson };

const sampleTemplates: SampleTemplate[] = [
  { title: "Réflexion hebdomadaire sur ta routine", description: "Une courte série de questions pour remarquer ce qui a soutenu ta routine cette semaine.", icon: ClipboardList, category: "Motivation" },
  { title: "Notes de séance d’entraînement", description: "Un simple plan d’exemple pour réfléchir à la qualité des mouvements, à la préparation et aux questions pour ton coach.", icon: BookOpenText, category: "Entraînement" },
  { title: "Questions pour discuter de ton journal alimentaire", description: "Utilise ces questions non prescriptives pour apporter des observations utiles à une conversation sur la nutrition.", icon: FileText, category: "Nutrition" },
  { title: "Questions à aborder avec ton coach", description: "Une fiche de questions réutilisable pour transformer ta curiosité en une conversation de coaching plus utile.", icon: MessageCircleQuestion, category: "Bien-être" },
];

export default function Resources() {
  const { courses: catalogCourses, loading, error, retry, isAdminPreview } = useCatalog();
  const courses = useMemo(() => isAdminPreview ? catalogCourses : catalogCourses.filter((course) => course.status !== "draft"), [catalogCourses, isAdminPreview]);
  const resources = useMemo<CatalogResource[]>(() => courses.flatMap((course) => course.lessons.flatMap((lesson) => (lesson.resources || []).map((resource) => ({ ...resource, course, lesson })))), [courses]);

  if (loading) return <div className="lp-page"><section className="panel lp-empty-state"><FileText size={25} /><h2>Chargement des ressources</h2><p className="muted">Les documents associés aux cours sont en cours de chargement.</p></section></div>;
  if (error) return <div className="lp-page"><section className="panel lp-empty-state"><FileText size={25} /><h2>Les ressources sont momentanément indisponibles.</h2><p className="muted">Réessaie dans un instant.</p><button type="button" className="btn secondary" onClick={() => retry()}>Réessayer</button></section></div>;

  return (
    <div className="lp-page">
      <section className="lp-resource-hero panel">
        <div className="lp-resource-hero-icon"><FileText size={25} /></div>
        <div>
          <div className="lp-kicker">Outils EJ Coaching</div>
          <p className="eyebrow">RÉFLÉCHIS · PRÉPARE-TOI · POSE TES QUESTIONS</p>
          <h1 className="page-title">Des ressources pour une pratique réfléchie.</h1>
          <p className="lp-lead">Retrouve les documents ajoutés à tes leçons, ainsi que des fiches d’exemple pour préparer une conversation de coaching.</p>
        </div>
      </section>
      <section className="lp-resource-intro">
        <div><p className="eyebrow">DOCUMENTS DE TES COURS</p><h2>Garde les ressources utiles à portée de main.</h2></div>
        <div className="lp-resource-disclosure"><ShieldCheck size={17} /><span>Les documents sont fournis avec les leçons auxquelles ils se rapportent. Consulte un professionnel qualifié pour les conseils personnalisés de santé, de nutrition ou d’entraînement.</span></div>
      </section>
      {resources.length ? <section className="lp-resource-grid">
        {resources.map((resource) => (
          <article className="panel lp-resource-card" key={`${resource.course.id}:${resource.lesson.id}:${resource.id}`}>
            <div className="lp-resource-card-top"><span className="lp-resource-icon"><FileText size={20} /></span><span className="lp-resource-category">{resource.course.category}</span></div>
            <h3>{resource.title}</h3>
            <p>{resource.course.title} · {resource.lesson.title}{resource.filename ? ` · ${resource.filename}` : ""}</p>
            <a href={resource.url} target="_blank" rel="noopener noreferrer" className="btn secondary"><ArrowDownToLine size={16} /> Ouvrir le document</a>
          </article>
        ))}
      </section> : <section className="panel lp-empty-state"><FileText size={26} /><h3>Aucun document n’a encore été ajouté aux leçons.</h3><p className="muted">Les documents ajoutés aux cours publiés apparaîtront ici.</p></section>}
      <section id="exemples-de-fiches" className="lp-resource-intro">
        <div><p className="eyebrow">EXEMPLES DE FICHES</p><h2>Quatre amorces de réflexion.</h2></div>
        <div className="lp-resource-disclosure"><ShieldCheck size={17} /><span>Ces fiches sont des exemples éducatifs; elles ne constituent pas un plan personnalisé ni un dossier client.</span></div>
      </section>
      <section className="lp-resource-grid" aria-label="Exemples de fiches">
        {sampleTemplates.map((template) => {
          const Icon = template.icon;
          return <article className="panel lp-resource-card" key={template.title}><div className="lp-resource-card-top"><span className="lp-resource-icon"><Icon size={20} /></span><span className="lp-demo-badge">EXEMPLE DE FICHE</span></div><h3>{template.title}</h3><p>{template.description}</p><span className="lp-resource-category">{template.category} · Questions éducatives</span></article>;
        })}
      </section>
    </div>
  );
}
