export type CourseIcon =
  | "nutrition"
  | "training"
  | "mindset"
  | "deficit"
  | "surplus"
  | "equipment"
  | "supplements";
export type LessonResource = {
  id: string;
  title: string;
  url: string;
  filename?: string;
};
export type Lesson = {
  id: string;
  title: string;
  duration: string;
  description: string;
  takeaways: string[];
  videoUrl?: string;
  videoType?: "demo" | "file" | "embed";
  /** Current native conversion job; present only in administrator serializations. */
  videoJobId?: string;
  /** Stable URL for the generated JPEG poster, never a source-upload URL. */
  videoPosterUrl?: string;
  /** Public-safe indication that a replacement video is being converted. */
  videoPending?: boolean;
  resources?: LessonResource[];
  position?: number;
  revision?: number;
};
export type Course = {
  id: string;
  title: string;
  category: string;
  eyebrow: string;
  description: string;
  color: string;
  image?: string;
  icon: CourseIcon;
  lessons: Lesson[];
  status?: "draft" | "published";
  isSample?: boolean;
  position?: number;
  revision?: number;
  updatedAt?: string;
};
export type CourseInput = {
  title: string;
  category: string;
  eyebrow: string;
  description: string;
  color: string;
  image?: string;
  icon: CourseIcon;
  status: "draft" | "published";
  isSample: boolean;
};
export type LessonInput = {
  title: string;
  duration: string;
  description: string;
  takeaways: string[];
  videoUrl?: string;
  videoType: "demo" | "file" | "embed";
  resources: LessonResource[];
};
