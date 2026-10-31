import { ArrowDownToLine, BookOpenText, ClipboardList, FileText, MessageCircleQuestion, ShieldCheck } from "lucide-react";
import "./LearningPages.css";

type Resource = {
  title: string;
  description: string;
  filename: string;
  icon: typeof FileText;
  content: string;
  category: string;
};

const resources: Resource[] = [
  {
    title: "Réflexion hebdomadaire sur ta routine",
    description: "Une courte série de questions pour remarquer ce qui a soutenu ta routine cette semaine.",
    filename: "ej-exemple-reflexion-hebdomadaire.md",
    icon: ClipboardList,
    category: "Motivation",
    content: "# EJ Coaching — Exemple de réflexion hebdomadaire sur ta routine\n\n> PLAN D’EXEMPLE — questions éducatives seulement. Ceci n’est ni une prescription, ni une évaluation, ni un dossier de coaching.\n\n## Remarque\n- Qu’est-ce qui a été plus facile à répéter cette semaine?\n- Qu’est-ce qui a rendu ta routine plus difficile à protéger?\n- Quelle petite prochaine étape pourrais-tu discuter avec ton coach?\n\n## À apporter à ta conversation\n- Une réussite à reconnaître\n- Une question au sujet de ton plan\n- Toute préoccupation concernant ton bien-être ou ta récupération qui nécessite l’avis d’une personne qualifiée\n",
  },
  {
    title: "Notes de séance d’entraînement",
    description: "Un simple plan d’exemple pour réfléchir à la qualité des mouvements, à la préparation et aux questions pour ton coach.",
    filename: "ej-exemple-notes-seance-entrainement.md",
    icon: BookOpenText,
    category: "Entraînement",
    content: "# EJ Coaching — Exemple de notes de séance d’entraînement\n\n> PLAN D’EXEMPLE — cette fiche ne remplace pas une programmation personnalisée ni les directives d’une personne qualifiée.\n\n## Réfléchis\n- Quel mouvement t’a semblé le plus familier aujourd’hui?\n- Quelle question sur la préparation ou la technique aimerais-tu clarifier?\n- Est-ce que quelque chose t’a semblé inconfortable ou inattendu? Si oui, arrête et cherche l’accompagnement approprié.\n\n## À discuter avec ton coach\n- Les questions sur la préparation aux exercices\n- Ton ressenti global pendant la séance\n- Le soutien qui t’aiderait à aborder la prochaine séance avec plus d’assurance\n",
  },
  {
    title: "Questions pour discuter de ton journal alimentaire",
    description: "Utilise ces questions non prescriptives pour apporter des observations utiles à une conversation sur la nutrition.",
    filename: "ej-exemple-questions-journal-alimentaire.md",
    icon: FileText,
    category: "Nutrition",
    content: "# EJ Coaching — Exemple de questions pour discuter de ton journal alimentaire\n\n> PLAN D’EXEMPLE — aucune recommandation concernant les calories, les portions ou les dosages n’est incluse. Les conseils nutritionnels personnalisés devraient venir d’un professionnel qualifié.\n\n## Observe\n- Quelles tendances as-tu remarquées dans ton horaire?\n- Qu’est-ce qui a rendu le suivi alimentaire pratique ou difficile?\n- Quelle question aimerais-tu explorer avec ton coach?\n\n## À retenir\nUtilise tes observations comme information, non comme jugement. Discute de tes besoins individuels, de tes préoccupations médicales ou de changements alimentaires avec un professionnel qualifié approprié.\n",
  },
  {
    title: "Questions à aborder avec ton coach",
    description: "Une fiche de questions réutilisable pour transformer ta curiosité en une conversation de coaching plus utile.",
    filename: "ej-exemple-questions-coaching.md",
    icon: MessageCircleQuestion,
    category: "Bien-être",
    content: "# EJ Coaching — Exemple de questions à aborder avec ton coach\n\n> PLAN D’EXEMPLE — pour l’éducation et la préparation de conversations seulement.\n\n- Quelle est l’intention derrière cette partie de mon plan?\n- Sur quoi devrais-je m’exercer en premier?\n- Quel contexte te serait utile à connaître?\n- Quand devrais-je demander un soutien additionnel d’un professionnel de la santé qualifié?\n\nCe modèle ne contient aucune recommandation personnalisée.\n",
  },
];

function downloadResource(resource: Resource) {
  const blob = new Blob([resource.content], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = resource.filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

export default function Resources() {
  return (
    <div className="lp-page">
      <section className="lp-resource-hero panel">
        <div className="lp-resource-hero-icon"><FileText size={25} /></div>
        <div>
          <div className="lp-kicker">Outils EJ Coaching <span className="lp-demo-badge">EXEMPLE</span></div>
          <p className="eyebrow">RÉFLÉCHIS · PRÉPARE-TOI · POSE TES QUESTIONS</p>
          <h1 className="page-title">Des ressources pour une pratique réfléchie.</h1>
          <p className="lp-lead">Télécharge de simples plans d’exemple modifiables pour soutenir une conversation de coaching. Ce ne sont ni des dossiers clients, ni des outils de suivi, ni des directives personnalisées.</p>
        </div>
      </section>

      <section className="lp-resource-intro">
        <div><p className="eyebrow">TÉLÉCHARGEMENTS D’EXEMPLE</p><h2>Garde les questions utiles à portée de main.</h2></div>
        <div className="lp-resource-disclosure"><ShieldCheck size={17} /><span>Les téléchargements contiennent seulement des questions éducatives — aucun conseil sur les dosages, les calories ou la santé.</span></div>
      </section>

      <section className="lp-resource-grid">
        {resources.map((resource) => {
          const Icon = resource.icon;
          return (
            <article className="panel lp-resource-card" key={resource.title}>
              <div className="lp-resource-card-top"><span className="lp-resource-icon"><Icon size={20} /></span><span className="lp-resource-category">{resource.category}</span></div>
              <h3>{resource.title}</h3>
              <p>{resource.description}</p>
              <button type="button" className="btn secondary" onClick={() => downloadResource(resource)}><ArrowDownToLine size={16} /> Télécharger le fichier .md</button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
