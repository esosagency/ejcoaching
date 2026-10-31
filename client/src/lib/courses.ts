import type { Course, Lesson } from '@shared/content';
export type { Course, Lesson } from '@shared/content';

const imageRoot = '/manus-storage/async-images/Cidmx6jXzCnndw1HXoG6Ui';
export const courseImages = {
  nutrition: `${imageRoot}/image-1.webp`,
  training: `${imageRoot}/image-2.webp`,
  mindset: `${imageRoot}/image-3.webp`,
  equipment: `${imageRoot}/image-4.webp`,
  supplements: `${imageRoot}/image-5.webp`,
};

function lesson(course: string, number: number, title: string, duration: string, description: string, takeaways: string[]): Lesson {
  return { id: `${course}-${number}`, title, duration, description, takeaways };
}

export const courses: Course[] = [
  {
    id: 'nutrition', title: 'Les bases de la nutrition', category: 'Nutrition', eyebrow: 'COMPRENDS TON ALIMENTATION',
    description: 'Démystifie les calories, les macronutriments et le suivi alimentaire — une leçon pratique à la fois.',
    color: '#a997ff', image: courseImages.nutrition, icon: 'nutrition',
    lessons: [
      lesson('nutrition', 1, 'Commence par les bases', '06:24', 'Une introduction aux concepts de nutrition que tu exploreras avec EJ Coaching.', ['Comprends ce que couvre ce cours.', 'Fais le lien entre tes apprentissages et tes objectifs de coaching personnels.', 'Établis une base avant de modifier ta routine.']),
      lesson('nutrition', 2, 'Comprendre les calories et les macros', '08:12', 'Explore le vocabulaire de la nutrition pour suivre les recommandations de ton coach avec confiance.', ['Apprends le rôle des calories et des macronutriments.', 'Comprends pourquoi le contexte compte.', 'Pose tes questions personnelles à ton coach.']),
      lesson('nutrition', 3, 'Comment suivre ton alimentation', '10:36', 'Un aperçu de l’utilisation d’un journal alimentaire pour que ton suivi demeure pratique.', ['Découvre des outils de journal alimentaire.', 'Apprends à noter les portions de façon constante.', 'Utilise le suivi comme une source d’information, pas comme un jugement.']),
      lesson('nutrition', 4, 'Balance alimentaire et portions', '07:48', 'Familiarise-toi avec les outils qui facilitent la compréhension des portions.', ['Découvre une démonstration de balance alimentaire.', 'Fais la distinction entre les aliments crus et cuits.', 'Vise une routine que tu peux maintenir.']),
      lesson('nutrition', 5, 'Lire une étiquette nutritionnelle', '05:52', 'Un survol de la taille des portions et des renseignements sur les emballages alimentaires.', ['Repère la taille d’une portion.', 'Explore les renseignements sur une étiquette.', 'Compare les portions avec discernement.']),
      lesson('nutrition', 6, 'Rendre le suivi durable', '09:10', 'Rassemble les bases et discute d’une routine souple avec ton coach.', ['Garde une routine facile à gérer.', 'Revois ce que tu as appris.', 'Demande du soutien lorsque le suivi devient stressant.']),
    ],
  },
  {
    id: 'training', title: 'Les bases de l’entraînement', category: 'Entraînement', eyebrow: 'ENTRAÎNE-TOI AVEC INTENTION',
    description: 'Comprends tes entraînements, améliore ta technique et aborde chaque séance avec intention.',
    color: '#7d9cff', image: courseImages.training, icon: 'training',
    lessons: [
      lesson('training', 1, 'Comprendre ton entraînement', '07:18', 'Découvre le vocabulaire de l’entraînement que ton coach a préparé pour toi.', ['Lis les noms et les consignes des exercices.', 'Comprends les séries, les répétitions et le repos.', 'Demande à ton coach de t’expliquer les mouvements que tu ne connais pas.']),
      lesson('training', 2, 'La technique avant l’intensité', '09:42', 'Une introduction aux mouvements bien exécutés et aux repères techniques utiles.', ['Privilégie des mouvements contrôlés.', 'Utilise des charges adaptées à ton expérience.', 'Arrête et demande conseil si un mouvement te fait mal.']),
      lesson('training', 3, 'La surcharge progressive expliquée', '08:06', 'Découvre comment la progression à l’entraînement s’intègre dans une routine constante.', ['Comprends que la progression est un processus à long terme.', 'Note les données utiles sur tes entraînements.', 'Suis la progression recommandée par ton coach.']),
      lesson('training', 4, 'Récupération et jours de repos', '06:54', 'Découvre pourquoi ta routine d’entraînement comprend autant la récupération que l’effort.', ['Reconnais que la récupération fait partie de l’entraînement.', 'Parle de ta fatigue avec ton coach.', 'Fais de la place à une routine durable.']),
      lesson('training', 5, 'Noter tes séances', '05:36', 'Utilise des notes simples pour réfléchir à tes séances et soutenir tes échanges avec ton coach.', ['Note tes séries et tes répétitions.', 'Note tes sensations pendant les mouvements.', 'Utilise tes notes pour discuter de tes progrès.']),
    ],
  },
  {
    id: 'mindset', title: 'Motivation et constance', category: 'Motivation', eyebrow: 'SOIS LÀ POUR TOI',
    description: 'Crée des habitudes réalistes et trouve ton rythme — même quand la motivation manque.',
    color: '#e6b79b', image: courseImages.mindset, icon: 'mindset',
    lessons: [
      lesson('mindset', 1, 'Ta raison de commencer', '06:12', 'Réfléchis à ce que tu veux que ton parcours de mise en forme apporte à ta vie.', ['Définis ce qui compte pour toi.', 'Choisis des objectifs réalistes axés sur tes habitudes.', 'Revois tes raisons au fil de ton parcours.']),
      lesson('mindset', 2, 'Les habitudes avant la motivation', '08:24', 'Découvre des façons de rendre ta routine plus facile à répéter.', ['Commence par des actions faciles à intégrer.', 'Repère ce qui soutient ta routine.', 'Bâtis des habitudes adaptées à ton vrai horaire.']),
      lesson('mindset', 3, 'Sortir du tout ou rien', '07:46', 'Une discussion type sur la souplesse et le retour à ta routine après une semaine difficile.', ['Évite de voir une seule journée comme l’ensemble du parcours.', 'Choisis une prochaine étape pratique.', 'Demande du soutien lorsque tu en as besoin.']),
      lesson('mindset', 4, 'Reconnaître tes progrès', '05:58', 'Réfléchis à tes apprentissages, à ta confiance et à ta constance — pas seulement aux résultats physiques.', ['Remarque tes nouvelles habiletés et ta confiance.', 'Revois ta routine avec ton coach.', 'Célèbre les progrès personnels qui comptent pour toi.']),
    ],
  },
  {
    id: 'deficit', title: 'Comprendre le déficit calorique', category: 'Nutrition', eyebrow: 'COMPRENDS LE PROCESSUS',
    description: 'Apprends les principes d’un déficit et comment discuter d’une approche durable avec ton coach.',
    color: '#71c9bb', icon: 'deficit',
    lessons: [
      lesson('deficit', 1, 'Qu’est-ce qu’un déficit calorique?', '07:22', 'Une introduction aux concepts d’équilibre énergétique, sans te prescrire de cible calorique individuelle.', ['Découvre ce que signifie un déficit énergétique.', 'Comprends que les besoins individuels varient.', 'Discute de ton approche avec ton coach.']),
      lesson('deficit', 2, 'Établir des attentes réalistes', '06:48', 'Découvre pourquoi un parcours de mise en forme demande du contexte, de la patience et un accompagnement personnalisé.', ['Évite de comparer ton rythme à celui des autres.', 'Pose des questions sur des attentes réalistes.', 'Choisis avec ton coach des façons de mesurer tes progrès.']),
      lesson('deficit', 3, 'Suivre les tendances, pas une seule journée', '08:08', 'Un aperçu pour discuter des changements dans le temps sans réagir de façon excessive à une seule mesure.', ['Regarde le contexte dans son ensemble.', 'Tiens compte de tes sensations et de tes performances.', 'Revois les tendances avec ton coach.']),
      lesson('deficit', 4, 'Quand demander un ajustement', '05:42', 'Apprends à communiquer tes préoccupations et tes questions sur ton approche alimentaire.', ['Fais part des changements dans ton énergie et ton bien-être.', 'Évite de faire seul des changements extrêmes.', 'Cherche du soutien qualifié au besoin.']),
    ],
  },
  {
    id: 'surplus', title: 'Manger pour gagner du muscle', category: 'Nutrition', eyebrow: 'CONSTRUIS AVEC CONFIANCE',
    description: 'Comprends le surplus calorique et le lien entre l’alimentation, l’entraînement et la récupération.',
    color: '#d3b0ff', icon: 'surplus',
    lessons: [
      lesson('surplus', 1, 'Qu’est-ce qu’un surplus calorique?', '06:46', 'Un survol conceptuel d’un surplus et de la façon dont ton coach peut l’utiliser dans un plan personnalisé.', ['Apprends le vocabulaire de l’équilibre énergétique.', 'Comprends l’objectif de ton plan.', 'Discute des cibles individuelles avec ton coach.']),
      lesson('surplus', 2, 'Quand l’alimentation rencontre l’entraînement', '08:18', 'Découvre comment ta routine alimentaire et ton entraînement de force vont de pair.', ['Comprends le rôle de la constance.', 'Fais le lien entre tes objectifs alimentaires et d’entraînement.', 'Suis les recommandations personnalisées de ton coach.']),
      lesson('surplus', 3, 'Suivre tes progrès', '07:04', 'Une introduction à l’utilisation de tes observations pour revoir ta routine.', ['Note les observations utiles.', 'Tiens compte de tes performances et de ton bien-être.', 'Revois les ajustements avec ton coach.']),
      lesson('surplus', 4, 'La patience durant une phase de développement musculaire', '05:52', 'Discute d’attentes réalistes et de constance pendant une phase de développement musculaire.', ['Mise sur des habitudes faciles à répéter.', 'Évite les promesses de résultats rapides.', 'Reste en communication avec ton coach.']),
    ],
  },
  {
    id: 'equipment', title: 'À l’aise au gym', category: 'Entraînement', eyebrow: 'TROUVE TES REPÈRES',
    description: 'Familiarise-toi avec l’équipement du gym, les réglages et les outils de ta routine d’entraînement.',
    color: '#93c8eb', image: courseImages.equipment, icon: 'equipment',
    lessons: [
      lesson('equipment', 1, 'Te repérer au gym', '06:38', 'Apprends à utiliser du matériel qui ne t’est pas familier et à demander de l’aide.', ['Repère les zones d’équipement courantes.', 'Demande au personnel du gym de t’aider à régler l’équipement de façon sécuritaire.', 'Commence avec de l’équipement que tu connais.']),
      lesson('equipment', 2, 'Les machines à câbles et leurs accessoires', '09:16', 'Un aperçu des composantes des machines à câbles et des points à considérer pour les régler.', ['Reconnais les différents accessoires.', 'Vérifie le réglage avec un entraîneur qualifié.', 'Suis les consignes pour tes exercices.']),
      lesson('equipment', 3, 'Poids libres ou machines', '07:34', 'Découvre les choix d’équipement que tu peux voir dans un programme d’entraînement.', ['Comprends les différences courantes entre les équipements.', 'Choisis selon ton programme.', 'Demande une démonstration au besoin.']),
      lesson('equipment', 4, 'Une liste de vérification simple pour le gym', '04:56', 'Prépare-toi pour une séance sans ajouter de complexité inutile.', ['Revois ton programme avant l’entraînement.', 'Apporte ce dont tu as besoin.', 'Range l’équipement pour la prochaine personne.']),
    ],
  },
  {
    id: 'supplements', title: 'Les suppléments, simplement', category: 'Bien-être', eyebrow: 'FAIS LE TRI DANS L’INFO',
    description: 'Apprends à poser de meilleures questions sur les suppléments et à distinguer l’essentiel du marketing.',
    color: '#b0b9db', image: courseImages.supplements, icon: 'supplements',
    lessons: [
      lesson('supplements', 1, 'Commence par les bases', '06:08', 'Une introduction type pour parler des suppléments dans le contexte de ta routine globale.', ['Passe d’abord en revue les fondements de ta routine.', 'Évite de considérer le marketing comme un conseil personnalisé.', 'Discute de tes questions avec un professionnel qualifié.']),
      lesson('supplements', 2, 'Comprendre les étiquettes de suppléments', '08:32', 'Apprends quels renseignements chercher et quelles questions poser.', ['Lis les ingrédients et les renseignements sur les portions.', 'Pose des questions sur la qualité et les données probantes.', 'Vérifie si un supplément te convient avant de l’utiliser.']),
      lesson('supplements', 3, 'Questions à poser avant d’acheter', '07:12', 'Crée une liste de vérification réfléchie plutôt que de suivre un ensemble de suppléments unique pour tout le monde.', ['Pense à tes besoins réels.', 'Renseigne-toi sur les interactions et les contre-indications.', 'Consulte un professionnel de la santé ou un pharmacien au sujet de la sécurité.']),
      lesson('supplements', 4, 'Garder ça simple', '05:26', 'Revois tes apprentissages et discute des prochaines étapes appropriées avec ton coach et ton équipe de soins.', ['Évite la complexité inutile.', 'Aucun supplément n’est prescrit dans cet exemple.', 'Fie-toi à des conseils personnalisés de professionnels qualifiés.']),
    ],
  },
];

export const allLessons = courses.flatMap(course => course.lessons);
export const getCourse = (id: string) => courses.find(course => course.id === id);
export const totalMinutes = (course: Course) => Math.round(course.lessons.reduce((sum, item) => sum + Number(item.duration.split(':')[0]) + Number(item.duration.split(':')[1]) / 60, 0));
