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
    title: "Weekly routine reflection",
    description: "A short set of prompts for noticing what supported your routine this week.",
    filename: "ej-sample-weekly-routine-reflection.md",
    icon: ClipboardList,
    category: "MINDSET",
    content: "# EJ Coaching — Sample weekly routine reflection\n\n> SAMPLE OUTLINE — educational prompts only. This is not a prescription, assessment, or coaching record.\n\n## Notice\n- What felt easier to repeat this week?\n- What made your routine harder to protect?\n- What is one small next step you could discuss with your coach?\n\n## Bring to your conversation\n- A win worth acknowledging\n- A question about your plan\n- Any wellbeing or recovery concerns that need qualified guidance\n",
  },
  {
    title: "Training session notes",
    description: "A simple sample outline for reflecting on movement quality, setup, and questions for your coach.",
    filename: "ej-sample-training-session-notes.md",
    icon: BookOpenText,
    category: "TRAINING",
    content: "# EJ Coaching — Sample training session notes\n\n> SAMPLE OUTLINE — this worksheet does not replace individualized programming or qualified instruction.\n\n## Reflect\n- Which movement felt most familiar today?\n- What setup or technique question would you like clarified?\n- Did anything feel uncomfortable or unexpected? If so, pause and seek appropriate guidance.\n\n## Discuss with your coach\n- Exercise setup questions\n- How the session felt overall\n- What support would make the next session feel more confident\n",
  },
  {
    title: "Food diary discussion prompts",
    description: "Use these non-prescriptive prompts to bring useful observations into a nutrition conversation.",
    filename: "ej-sample-food-diary-prompts.md",
    icon: FileText,
    category: "NUTRITION",
    content: "# EJ Coaching — Sample food diary discussion prompts\n\n> SAMPLE OUTLINE — no calorie, portion, or dosage recommendations are included. Personalized nutrition guidance should come from a qualified professional.\n\n## Observe\n- What patterns did you notice in your schedule?\n- What made food tracking feel practical or difficult?\n- What question would you like to explore with your coach?\n\n## Remember\nUse observations as information, not judgment. Discuss individual needs, medical concerns, or dietary changes with an appropriate qualified professional.\n",
  },
  {
    title: "Questions to bring to coaching",
    description: "A reusable prompt sheet for turning curiosity into a more useful coaching conversation.",
    filename: "ej-sample-coaching-questions.md",
    icon: MessageCircleQuestion,
    category: "COACHING",
    content: "# EJ Coaching — Sample questions to bring to coaching\n\n> SAMPLE OUTLINE — for education and conversation planning only.\n\n- What is the intention behind this part of my plan?\n- What should I focus on practicing first?\n- What context would be helpful for you to know?\n- When should I ask for additional or qualified healthcare support?\n\nThere are no individual recommendations in this template.\n",
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
          <div className="lp-kicker">EJ coaching tools <span className="lp-demo-badge">SAMPLE</span></div>
          <p className="eyebrow">REFLECT · PREPARE · ASK</p>
          <h1 className="page-title">Resources for thoughtful practice.</h1>
          <p className="lp-lead">Download simple, editable sample outlines to support a coaching conversation. They are not client files, trackers, or individualized instructions.</p>
        </div>
      </section>

      <section className="lp-resource-intro">
        <div><p className="eyebrow">SAMPLE DOWNLOADS</p><h2>Keep the useful questions close.</h2></div>
        <div className="lp-resource-disclosure"><ShieldCheck size={17} /><span>Downloads contain educational prompts only—no dosage, calorie, or medical guidance.</span></div>
      </section>

      <section className="lp-resource-grid">
        {resources.map((resource) => {
          const Icon = resource.icon;
          return (
            <article className="panel lp-resource-card" key={resource.title}>
              <div className="lp-resource-card-top"><span className="lp-resource-icon"><Icon size={20} /></span><span className="lp-resource-category">{resource.category}</span></div>
              <h3>{resource.title}</h3>
              <p>{resource.description}</p>
              <button type="button" className="btn secondary" onClick={() => downloadResource(resource)}><ArrowDownToLine size={16} /> Download .md</button>
            </article>
          );
        })}
      </section>
    </div>
  );
}
