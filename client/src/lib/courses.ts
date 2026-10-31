export type Lesson = {
  id: string;
  title: string;
  duration: string;
  description: string;
  takeaways: string[];
};

export type Course = {
  id: string;
  title: string;
  category: string;
  eyebrow: string;
  description: string;
  color: string;
  image?: string;
  icon: 'nutrition' | 'training' | 'mindset' | 'deficit' | 'surplus' | 'equipment' | 'supplements';
  lessons: Lesson[];
};

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
    id: 'nutrition', title: 'Nutrition Fundamentals', category: 'Nutrition', eyebrow: 'UNDERSTAND YOUR NUTRITION',
    description: 'Make sense of calories, macros, and food tracking—one practical lesson at a time.',
    color: '#a997ff', image: courseImages.nutrition, icon: 'nutrition',
    lessons: [
      lesson('nutrition', 1, 'Start with the basics', '06:24', 'An introduction to the nutrition concepts you will explore with EJ Coaching.', ['Understand what this course covers.', 'Connect your learning to your personal coaching goals.', 'Build a foundation before changing your routine.']),
      lesson('nutrition', 2, 'Understanding calories & macros', '08:12', 'Explore the language of nutrition so you can follow your coach’s guidance with confidence.', ['Learn the roles of calories and macronutrients.', 'Understand why context matters.', 'Bring your individual questions to your coach.']),
      lesson('nutrition', 3, 'How to track your food', '10:36', 'A sample lesson outline for using a food diary and keeping your tracking routine practical.', ['Explore food diary tools.', 'Learn how to record portions consistently.', 'Use tracking as information, not a judgment.']),
      lesson('nutrition', 4, 'Food scales & portion sizes', '07:48', 'Get familiar with the tools that make understanding portions easier.', ['Explore a food scale demonstration.', 'Distinguish entries for raw and cooked foods.', 'Aim for a routine you can maintain.']),
      lesson('nutrition', 5, 'Reading a nutrition label', '05:52', 'An overview of serving sizes and the information on food packaging.', ['Locate the serving size.', 'Explore the information on a label.', 'Compare portions thoughtfully.']),
      lesson('nutrition', 6, 'Making tracking sustainable', '09:10', 'Bring the foundations together and discuss a flexible routine with your coach.', ['Keep your routine manageable.', 'Review what you have learned.', 'Ask for support when tracking feels stressful.']),
    ],
  },
  {
    id: 'training', title: 'Training Essentials', category: 'Training', eyebrow: 'TRAIN WITH INTENTION',
    description: 'Understand your workouts, improve your technique, and approach every session with purpose.',
    color: '#7d9cff', image: courseImages.training, icon: 'training',
    lessons: [
      lesson('training', 1, 'Understanding your workout', '07:18', 'Learn the language behind the workout your coach has designed for you.', ['Read exercise names and instructions.', 'Understand sets, repetitions, and rest.', 'Ask your coach about unfamiliar movements.']),
      lesson('training', 2, 'Technique before intensity', '09:42', 'A sample introduction to movement quality and useful technique cues.', ['Prioritize controlled movement.', 'Use appropriate loads for your experience.', 'Stop and seek guidance when a movement causes pain.']),
      lesson('training', 3, 'Progressive overload explained', '08:06', 'Explore how training progression fits within a consistent routine.', ['Understand progression as a long-term process.', 'Record useful training information.', 'Follow the progression your coach recommends.']),
      lesson('training', 4, 'Recovery & rest days', '06:54', 'Learn why your training routine includes recovery as well as effort.', ['Recognize recovery as part of training.', 'Discuss fatigue with your coach.', 'Make space for a sustainable routine.']),
      lesson('training', 5, 'Logging your sessions', '05:36', 'Use simple records to reflect on your sessions and support coaching conversations.', ['Record your sets and repetitions.', 'Note how movements felt.', 'Use your log to discuss progress.']),
    ],
  },
  {
    id: 'mindset', title: 'Mindset & Consistency', category: 'Mindset', eyebrow: 'SHOW UP FOR YOURSELF',
    description: 'Create realistic habits and find your rhythm—even when motivation is low.',
    color: '#e6b79b', image: courseImages.mindset, icon: 'mindset',
    lessons: [
      lesson('mindset', 1, 'Your reason for starting', '06:12', 'Reflect on what you want your fitness journey to add to your life.', ['Define what matters to you.', 'Choose realistic process goals.', 'Revisit your reasons as your journey changes.']),
      lesson('mindset', 2, 'Habits over motivation', '08:24', 'Explore ways to make your routine easier to repeat.', ['Start with manageable actions.', 'Notice what supports your routine.', 'Build habits around your real schedule.']),
      lesson('mindset', 3, 'Moving past all-or-nothing', '07:46', 'A sample discussion of flexibility and returning to your routine after a difficult week.', ['Avoid treating one day as the whole journey.', 'Choose a practical next step.', 'Ask for support when you need it.']),
      lesson('mindset', 4, 'Recognizing your progress', '05:58', 'Reflect on learning, confidence, and consistency—not only physical outcomes.', ['Notice new skills and confidence.', 'Review your routine with your coach.', 'Celebrate meaningful personal progress.']),
    ],
  },
  {
    id: 'deficit', title: 'Understanding a Caloric Deficit', category: 'Nutrition', eyebrow: 'UNDERSTAND THE PROCESS',
    description: 'Learn the principles behind a deficit and how to discuss a sustainable approach with your coach.',
    color: '#71c9bb', icon: 'deficit',
    lessons: [
      lesson('deficit', 1, 'What is a caloric deficit?', '07:22', 'A conceptual introduction to energy balance, without prescribing an individual calorie target.', ['Learn the meaning of an energy deficit.', 'Understand that individual needs vary.', 'Discuss your approach with your coach.']),
      lesson('deficit', 2, 'Setting realistic expectations', '06:48', 'Explore why a fitness journey needs context, patience, and individualized guidance.', ['Avoid comparing your timeline to others.', 'Ask about realistic expectations.', 'Choose measures of progress with your coach.']),
      lesson('deficit', 3, 'Tracking trends, not single days', '08:08', 'A sample outline for discussing changes over time without overreacting to one measurement.', ['Look at the broader context.', 'Consider how you feel and perform.', 'Review patterns with your coach.']),
      lesson('deficit', 4, 'When to ask for an adjustment', '05:42', 'Learn how to communicate concerns and questions about your nutrition approach.', ['Share changes in energy and wellbeing.', 'Avoid making extreme changes alone.', 'Seek qualified support when appropriate.']),
    ],
  },
  {
    id: 'surplus', title: 'Fueling Muscle Growth', category: 'Nutrition', eyebrow: 'BUILD WITH CONFIDENCE',
    description: 'Understand a caloric surplus and the relationship between nutrition, training, and recovery.',
    color: '#d3b0ff', icon: 'surplus',
    lessons: [
      lesson('surplus', 1, 'What is a caloric surplus?', '06:46', 'A conceptual overview of a surplus and how your coach may use it in an individual plan.', ['Learn the language of energy balance.', 'Understand the purpose of your plan.', 'Discuss individual targets with your coach.']),
      lesson('surplus', 2, 'Nutrition meets training', '08:18', 'Explore how your eating routine and strength training fit together.', ['Understand the role of consistency.', 'Connect your nutrition and training goals.', 'Follow individualized coaching guidance.']),
      lesson('surplus', 3, 'Monitoring your progress', '07:04', 'An introduction to using feedback when reviewing your routine.', ['Record useful feedback.', 'Consider performance and wellbeing.', 'Review adjustments with your coach.']),
      lesson('surplus', 4, 'Patience in the building phase', '05:52', 'Discuss realistic expectations and staying consistent during a building phase.', ['Focus on repeatable habits.', 'Avoid promises of rapid results.', 'Stay in communication with your coach.']),
    ],
  },
  {
    id: 'equipment', title: 'Gym Confidence', category: 'Training', eyebrow: 'KNOW YOUR WAY AROUND',
    description: 'Get comfortable with gym equipment, setup, and the tools in your training routine.',
    color: '#93c8eb', image: courseImages.equipment, icon: 'equipment',
    lessons: [
      lesson('equipment', 1, 'Finding your way around the gym', '06:38', 'Learn how to approach unfamiliar equipment and ask for help.', ['Identify common equipment areas.', 'Ask gym staff about safe setup.', 'Start with equipment you understand.']),
      lesson('equipment', 2, 'Cable machines & attachments', '09:16', 'A sample walkthrough of cable machine components and setup considerations.', ['Recognize different attachments.', 'Check setup with a qualified trainer.', 'Follow the guidance for your exercises.']),
      lesson('equipment', 3, 'Free weights vs. machines', '07:34', 'Explore the equipment choices you may see in a training plan.', ['Understand common equipment differences.', 'Choose according to your program.', 'Ask for a demonstration when needed.']),
      lesson('equipment', 4, 'A simple gym checklist', '04:56', 'Prepare for a session without adding unnecessary complexity.', ['Review your program before training.', 'Bring the essentials you need.', 'Leave equipment ready for the next person.']),
    ],
  },
  {
    id: 'supplements', title: 'Supplementation, Simplified', category: 'Wellness', eyebrow: 'CUT THROUGH THE NOISE',
    description: 'Learn how to ask better questions about supplements and separate essentials from marketing.',
    color: '#b0b9db', image: courseImages.supplements, icon: 'supplements',
    lessons: [
      lesson('supplements', 1, 'Start with the foundations', '06:08', 'A sample introduction to discussing supplements in the context of your overall routine.', ['Review your underlying routine first.', 'Avoid treating marketing as individual advice.', 'Discuss questions with a qualified professional.']),
      lesson('supplements', 2, 'Understanding supplement labels', '08:32', 'Learn what information to look for and what questions to raise.', ['Read ingredient and serving information.', 'Ask about quality and evidence.', 'Check suitability before use.']),
      lesson('supplements', 3, 'Questions to ask before buying', '07:12', 'Create a thoughtful checklist rather than following a one-size-fits-all supplement stack.', ['Consider your actual needs.', 'Ask about interactions and contraindications.', 'Consult a clinician or pharmacist about safety.']),
      lesson('supplements', 4, 'Keeping it simple', '05:26', 'Review your learning and discuss appropriate next steps with your coach and healthcare team.', ['Avoid unnecessary complexity.', 'No supplement is prescribed in this sample.', 'Use qualified individualized advice.']),
    ],
  },
];

export const allLessons = courses.flatMap(course => course.lessons);
export const getCourse = (id: string) => courses.find(course => course.id === id);
export const totalMinutes = (course: Course) => Math.round(course.lessons.reduce((sum, item) => sum + Number(item.duration.split(':')[0]) + Number(item.duration.split(':')[1]) / 60, 0));
