import type { ChangeEvent, DragEvent, FormEvent } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertCircle,
  Archive,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  CheckCircle2,
  ChevronRight,
  CirclePlus,
  FileText,
  GripVertical,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Upload,
  Video,
  X,
} from "lucide-react";
import { Link, useLocation, useParams } from "wouter";
import type {
  Course,
  CourseIcon,
  CourseInput,
  Lesson,
  LessonInput,
  LessonResource,
} from "@shared/content";
import { parseVimeoUrl } from "@shared/vimeo";
import AdminGate from "@/components/AdminGate";
import { trpc } from "@/lib/trpc";
import "./Admin.css";

const MAX_VIDEO_BYTES = 250 * 1024 * 1024;
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const MAX_DOCUMENT_BYTES = 25 * 1024 * 1024;

const iconOptions: Array<{ value: CourseIcon; label: string }> = [
  { value: "nutrition", label: "Nutrition" },
  { value: "training", label: "Entraînement" },
  { value: "mindset", label: "Mentalité" },
  { value: "deficit", label: "Déficit" },
  { value: "surplus", label: "Surplus" },
  { value: "equipment", label: "Équipement" },
  { value: "supplements", label: "Suppléments" },
];

type UploadTarget = "cover" | "video" | "documents";
type UploadState = { target: UploadTarget; progress: number; label: string };

function emptyCourseInput(): CourseInput {
  return {
    title: "",
    category: "Nutrition",
    eyebrow: "ACADÉMIE EJ COACHING",
    description: "",
    color: "#8a66ef",
    image: undefined,
    icon: "nutrition",
    status: "draft",
    isSample: false,
  };
}

function emptyLessonInput(): LessonInput {
  return {
    title: "",
    duration: "",
    description: "",
    takeaways: [],
    videoType: "demo",
    videoUrl: undefined,
    resources: [],
  };
}

function asCourseInput(course: Course): CourseInput {
  return {
    title: course.title,
    category: course.category,
    eyebrow: course.eyebrow,
    description: course.description,
    color: course.color,
    image: course.image,
    icon: course.icon,
    status: course.status === "published" ? "published" : "draft",
    isSample: Boolean(course.isSample),
  };
}

function asLessonInput(lesson: Lesson): LessonInput {
  return {
    title: lesson.title,
    duration: lesson.duration,
    description: lesson.description,
    takeaways: [...lesson.takeaways],
    videoUrl: lesson.videoUrl,
    videoType: lesson.videoType ?? "demo",
    resources: (lesson.resources ?? []).map(resource => ({ ...resource })),
  };
}

function hasSameInput(
  left: CourseInput | LessonInput,
  right: CourseInput | LessonInput
) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function isDuration(value: string) {
  return /^\d{1,3}:[0-5]\d$/.test(value.trim());
}

function isHttpsUrl(value: string) {
  try {
    return new URL(value).protocol === "https:";
  } catch {
    return false;
  }
}

export function isAllowedVideoUrl(value: string) {
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password)
      return false;
    if (parsed.pathname.toLowerCase().endsWith(".mp4")) return true;

    const host = parsed.hostname.toLowerCase();
    const parts = parsed.pathname.split("/").filter(Boolean);
    const videoId = /^[A-Za-z0-9_-]{6,128}$/;
    if (host === "youtu.be")
      return parts.length === 1 && videoId.test(parts[0] ?? "");
    if (
      host === "youtube.com" ||
      host === "www.youtube.com" ||
      host === "m.youtube.com"
    ) {
      if (parts[0] === "watch")
        return videoId.test(parsed.searchParams.get("v") ?? "");
      return (
        (parts[0] === "embed" || parts[0] === "shorts") &&
        parts.length === 2 &&
        videoId.test(parts[1] ?? "")
      );
    }
    if (
      (host === "youtube-nocookie.com" ||
        host === "www.youtube-nocookie.com") &&
      parts[0] === "embed"
    ) {
      return parts.length === 2 && videoId.test(parts[1] ?? "");
    }
    if (parseVimeoUrl(value)) return true;
    if (
      host === "fast.wistia.com" ||
      host === "fast.wistia.net" ||
      host === "embed.wistia.com"
    ) {
      return (
        parts.length === 3 &&
        parts[0] === "embed" &&
        parts[1] === "medias" &&
        /^[A-Za-z0-9_-]{5,128}$/.test(parts[2] ?? "")
      );
    }
    return (
      (host === "wistia.com" || host === "www.wistia.com") &&
      parts.length === 2 &&
      parts[0] === "medias" &&
      /^[A-Za-z0-9_-]{5,128}$/.test(parts[1] ?? "")
    );
  } catch {
    return false;
  }
}

function isHttpsMp4Url(value: string) {
  try {
    const parsed = new URL(value);
    return (
      parsed.protocol === "https:" &&
      parsed.pathname.toLowerCase().endsWith(".mp4")
    );
  } catch {
    return false;
  }
}

function isMp4(file: File) {
  return file.type === "video/mp4" || file.name.toLowerCase().endsWith(".mp4");
}

function isImage(file: File) {
  return ["image/jpeg", "image/png", "image/webp"].includes(file.type);
}

function isPdf(file: File) {
  return (
    file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf")
  );
}

function toFriendlyError(error: unknown, fallback: string) {
  return error instanceof Error && error.message ? error.message : fallback;
}

function putFile(
  uploadUrl: string,
  file: File,
  contentType: string,
  onProgress: (progress: number) => void
): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", uploadUrl);
    request.setRequestHeader("Content-Type", contentType);
    request.upload.onprogress = event => {
      if (event.lengthComputable) {
        onProgress(Math.round((event.loaded / event.total) * 100));
      }
    };
    request.onerror = () =>
      reject(new Error("Le téléversement vers le stockage a échoué."));
    request.onabort = () =>
      reject(new Error("Le téléversement a été interrompu."));
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve();
      } else {
        reject(new Error("Le stockage a refusé le téléversement."));
      }
    };
    request.send(file);
  });
}

function isLesson(value: Lesson | undefined): value is Lesson {
  return Boolean(value);
}

function EditorContent() {
  const { id } = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const utils = trpc.useUtils();
  const courseQuery = trpc.content.adminGet.useQuery(
    { id: id ?? "" },
    { enabled: Boolean(id), refetchOnWindowFocus: false }
  );
  const updateCourse = trpc.content.updateCourse.useMutation();
  const archiveCourse = trpc.content.archiveCourse.useMutation();
  const createLesson = trpc.content.createLesson.useMutation();
  const updateLesson = trpc.content.updateLesson.useMutation();
  const archiveLesson = trpc.content.archiveLesson.useMutation();
  const reorderLessons = trpc.content.reorderLessons.useMutation();
  const prepareUpload = trpc.content.prepareUpload.useMutation();
  const finishUpload = trpc.content.finishUpload.useMutation();

  const loadedCourseId = useRef<string | null>(null);
  const [courseForm, setCourseForm] = useState<CourseInput>(emptyCourseInput);
  const [selectedLessonId, setSelectedLessonId] = useState<string | null>(null);
  const [lessonForm, setLessonForm] = useState<LessonInput>(emptyLessonInput);
  const [lessonOrder, setLessonOrder] = useState<string[]>([]);
  const [draggedLessonId, setDraggedLessonId] = useState<string | null>(null);
  const [courseFeedback, setCourseFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [lessonFeedback, setLessonFeedback] = useState<{
    type: "error" | "success";
    message: string;
  } | null>(null);
  const [uploadState, setUploadState] = useState<UploadState | null>(null);
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceUrl, setResourceUrl] = useState("");
  const [documentTitle, setDocumentTitle] = useState("");

  useEffect(() => {
    if (id !== loadedCourseId.current) {
      loadedCourseId.current = null;
      setCourseForm(emptyCourseInput());
      setSelectedLessonId(null);
      setLessonForm(emptyLessonInput());
      setLessonOrder([]);
      setCourseFeedback(null);
      setLessonFeedback(null);
    }
  }, [id]);

  useEffect(() => {
    const course = courseQuery.data;
    if (!course || course.id !== id || loadedCourseId.current === course.id)
      return;

    loadedCourseId.current = course.id;
    setCourseForm(asCourseInput(course));
    setLessonOrder(course.lessons.map(lesson => lesson.id));
    const firstLesson = course.lessons[0];
    if (firstLesson) {
      setSelectedLessonId(firstLesson.id);
      setLessonForm(asLessonInput(firstLesson));
    } else {
      setSelectedLessonId(null);
      setLessonForm(emptyLessonInput());
    }
  }, [courseQuery.data, id]);

  const course = courseQuery.data?.id === id ? courseQuery.data : undefined;
  const selectedLesson = course?.lessons.find(
    lesson => lesson.id === selectedLessonId
  );
  const orderedLessons = useMemo(() => {
    if (!course) return [];
    const byId = new Map(course.lessons.map(lesson => [lesson.id, lesson]));
    return lessonOrder.map(lessonId => byId.get(lessonId)).filter(isLesson);
  }, [course, lessonOrder]);
  const courseDirty = course
    ? !hasSameInput(courseForm, asCourseInput(course))
    : false;
  const lessonDirty = selectedLesson
    ? !hasSameInput(lessonForm, asLessonInput(selectedLesson))
    : !hasSameInput(lessonForm, emptyLessonInput());

  useEffect(() => {
    if (!courseDirty && !lessonDirty) return;
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const beforeLink = (event: MouseEvent) => {
      const element = event.target instanceof Element ? event.target : null;
      const anchor = element?.closest<HTMLAnchorElement>("a[href]");
      if (
        !anchor ||
        anchor.target === "_blank" ||
        anchor.hasAttribute("download")
      )
        return;
      if (
        event.ctrlKey ||
        event.metaKey ||
        event.shiftKey ||
        event.altKey ||
        event.button !== 0
      )
        return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.href === window.location.href) return;
      if (
        !window.confirm(
          "Tu as des modifications non enregistrées. Veux-tu vraiment quitter cet éditeur?"
        )
      ) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    };
    window.addEventListener("beforeunload", beforeUnload);
    document.addEventListener("click", beforeLink, true);
    return () => {
      window.removeEventListener("beforeunload", beforeUnload);
      document.removeEventListener("click", beforeLink, true);
    };
  }, [courseDirty, lessonDirty]);

  const invalidateContent = useCallback(async () => {
    await Promise.all([
      utils.content.catalog.invalidate(),
      utils.content.adminList.invalidate(),
      utils.content.adminGet.invalidate(),
    ]);
  }, [utils]);

  const refreshCourse = useCallback(async () => {
    await invalidateContent();
    const result = await courseQuery.refetch();
    if (result.data?.id === id) {
      setLessonOrder(result.data.lessons.map(lesson => lesson.id));
      return result.data;
    }
    return undefined;
  }, [courseQuery, id, invalidateContent]);

  const updateCourseField = <Key extends keyof CourseInput>(
    key: Key,
    value: CourseInput[Key]
  ) => {
    setCourseForm(current => ({ ...current, [key]: value }));
    setCourseFeedback(null);
  };

  const updateLessonField = <Key extends keyof LessonInput>(
    key: Key,
    value: LessonInput[Key]
  ) => {
    setLessonForm(current => ({ ...current, [key]: value }));
    setLessonFeedback(null);
  };

  const loadLesson = (next: Lesson | undefined) => {
    if (next) {
      setSelectedLessonId(next.id);
      setLessonForm(asLessonInput(next));
    } else {
      setSelectedLessonId(null);
      setLessonForm(emptyLessonInput());
    }
    setLessonFeedback(null);
  };

  const requestLessonChange = (next: Lesson | undefined) => {
    if (next?.id === selectedLessonId) return;
    if (
      lessonDirty &&
      !window.confirm(
        "Tu as des modifications de leçon non enregistrées. Veux-tu les abandonner?"
      )
    )
      return;
    loadLesson(next);
  };

  const upload = async (
    file: File,
    kind: "video" | "image" | "document",
    target: UploadTarget
  ) => {
    setUploadState({ target, progress: 0, label: file.name });
    try {
      const contentType =
        file.type ||
        (kind === "video"
          ? "video/mp4"
          : kind === "image"
            ? "image/jpeg"
            : "application/pdf");
      const prepared = await prepareUpload.mutateAsync({
        filename: file.name,
        contentType,
        size: file.size,
        kind,
      });
      await putFile(prepared.uploadUrl, file, contentType, progress =>
        setUploadState({ target, progress, label: file.name })
      );
      setUploadState({ target, progress: 100, label: file.name });
      return await finishUpload.mutateAsync({ id: prepared.id });
    } finally {
      setUploadState(null);
    }
  };

  const saveCourse = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!course) return;
    if (!courseForm.title.trim()) {
      setCourseFeedback({
        type: "error",
        message: "Le titre du cours est requis.",
      });
      return;
    }
    if (!courseForm.category.trim()) {
      setCourseFeedback({
        type: "error",
        message: "La catégorie du cours est requise.",
      });
      return;
    }
    if (!courseForm.description.trim()) {
      setCourseFeedback({
        type: "error",
        message: "La description du cours est requise.",
      });
      return;
    }

    try {
      setCourseFeedback(null);
      await updateCourse.mutateAsync({
        id: course.id,
        revision: course.revision ?? 0,
        data: {
          ...courseForm,
          title: courseForm.title.trim(),
          category: courseForm.category.trim(),
          eyebrow: courseForm.eyebrow.trim(),
          description: courseForm.description.trim(),
          image: courseForm.image?.trim() || undefined,
        },
      });
      const refreshed = await refreshCourse();
      if (refreshed) setCourseForm(asCourseInput(refreshed));
      setCourseFeedback({
        type: "success",
        message: "Les réglages du cours ont été enregistrés.",
      });
    } catch (error) {
      setCourseFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "La mise à jour du cours a échoué. Réessaie."
        ),
      });
    }
  };

  const archiveCurrentCourse = async () => {
    if (!course) return;
    const confirmed = window.confirm(
      "Archiver ce cours? Il sera retiré des listes sans supprimer les fichiers liés."
    );
    if (!confirmed) return;

    try {
      setCourseFeedback(null);
      await archiveCourse.mutateAsync({
        id: course.id,
        revision: course.revision ?? 0,
      });
      await invalidateContent();
      setLocation("/admin");
    } catch (error) {
      setCourseFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "L’archivage du cours a échoué. Réessaie."
        ),
      });
    }
  };

  const onCoverUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file) return;
    if (!isImage(file)) {
      setCourseFeedback({
        type: "error",
        message: "La couverture doit être une image JPG, PNG ou WebP.",
      });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setCourseFeedback({
        type: "error",
        message: "La couverture ne peut pas dépasser 10 Mio.",
      });
      return;
    }

    try {
      const uploaded = await upload(file, "image", "cover");
      setCourseForm(current => ({ ...current, image: uploaded.url }));
      setCourseFeedback({
        type: "success",
        message:
          "La couverture a été téléversée. Enregistre le cours pour la conserver.",
      });
    } catch (error) {
      setCourseFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "Le téléversement de la couverture a échoué."
        ),
      });
    }
  };

  const onVideoUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const [file] = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!file) return;
    if (!isMp4(file)) {
      setLessonFeedback({
        type: "error",
        message: "La vidéo doit être un fichier MP4.",
      });
      return;
    }
    if (file.size > MAX_VIDEO_BYTES) {
      setLessonFeedback({
        type: "error",
        message: "La vidéo ne peut pas dépasser 250 Mio.",
      });
      return;
    }

    try {
      const uploaded = await upload(file, "video", "video");
      setLessonForm(current => ({
        ...current,
        videoType: "file",
        videoUrl: uploaded.url,
      }));
      setLessonFeedback({
        type: "success",
        message:
          "La vidéo est prête. Enregistre la leçon pour l’associer au cours.",
      });
    } catch (error) {
      setLessonFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "Le téléversement de la vidéo a échoué."
        ),
      });
    }
  };

  const onDocumentUpload = async (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length) return;
    const invalid = files.find(
      file => !isPdf(file) || file.size > MAX_DOCUMENT_BYTES
    );
    if (invalid) {
      setLessonFeedback({
        type: "error",
        message: !isPdf(invalid)
          ? "Les documents doivent être des PDF."
          : "Un document ne peut pas dépasser 25 Mio.",
      });
      return;
    }

    try {
      for (const file of files) {
        const uploaded = await upload(file, "document", "documents");
        setLessonForm(current => ({
          ...current,
          resources: [
            ...current.resources,
            {
              id: uploaded.id,
              title: documentTitle.trim() || uploaded.filename || file.name,
              url: uploaded.url,
              filename: uploaded.filename || file.name,
            },
          ],
        }));
      }
      setDocumentTitle("");
      setLessonFeedback({
        type: "success",
        message:
          files.length === 1
            ? "Le document est prêt. Enregistre la leçon pour l’associer."
            : "Les documents sont prêts. Enregistre la leçon pour les associer.",
      });
    } catch (error) {
      setLessonFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "Le téléversement d’un document a échoué. Les documents déjà terminés restent listés."
        ),
      });
    }
  };

  const addResourceLink = () => {
    if (!resourceTitle.trim()) {
      setLessonFeedback({
        type: "error",
        message: "Donne un titre au lien de ressource.",
      });
      return;
    }
    if (!isHttpsUrl(resourceUrl.trim())) {
      setLessonFeedback({
        type: "error",
        message: "Le lien de ressource doit commencer par https://.",
      });
      return;
    }
    const resource: LessonResource = {
      id: crypto.randomUUID(),
      title: resourceTitle.trim(),
      url: resourceUrl.trim(),
    };
    setLessonForm(current => ({
      ...current,
      resources: [...current.resources, resource],
    }));
    setResourceTitle("");
    setResourceUrl("");
    setLessonFeedback(null);
  };

  const removeResource = (resourceId: string) => {
    setLessonForm(current => ({
      ...current,
      resources: current.resources.filter(
        resource => resource.id !== resourceId
      ),
    }));
    setLessonFeedback(null);
  };

  const saveLesson = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!course) return;
    const duration = lessonForm.duration.trim();
    const videoUrl = lessonForm.videoUrl?.trim();

    if (!lessonForm.title.trim()) {
      setLessonFeedback({
        type: "error",
        message: "Le titre de la leçon est requis.",
      });
      return;
    }
    if (!lessonForm.description.trim()) {
      setLessonFeedback({
        type: "error",
        message: "La description de la leçon est requise.",
      });
      return;
    }
    if (!isDuration(duration)) {
      setLessonFeedback({
        type: "error",
        message: "Indique une durée au format mm:ss, par exemple 08:30.",
      });
      return;
    }
    if (lessonForm.videoType === "file" && !videoUrl) {
      setLessonFeedback({
        type: "error",
        message:
          "Téléverse un MP4 avant d’enregistrer une leçon avec fichier vidéo.",
      });
      return;
    }
    if (
      lessonForm.videoType === "embed" &&
      (!videoUrl || !isAllowedVideoUrl(videoUrl))
    ) {
      setLessonFeedback({
        type: "error",
        message:
          "Utilise une URL HTTPS vers un MP4, une URL YouTube /embed/ ou une URL player.vimeo.com/video/.",
      });
      return;
    }

    const resolvedVideoType =
      lessonForm.videoType === "embed" && videoUrl && isHttpsMp4Url(videoUrl)
        ? "file"
        : lessonForm.videoType;
    const data: LessonInput = {
      title: lessonForm.title.trim(),
      duration,
      description: lessonForm.description.trim(),
      takeaways: lessonForm.takeaways.map(item => item.trim()).filter(Boolean),
      videoType: resolvedVideoType,
      videoUrl: resolvedVideoType === "demo" ? undefined : videoUrl,
      resources: lessonForm.resources.map(resource => ({
        ...resource,
        title: resource.title.trim(),
        url: resource.url.trim(),
      })),
    };

    try {
      setLessonFeedback(null);
      let savedId: string;
      if (selectedLesson) {
        const result = await updateLesson.mutateAsync({
          courseId: course.id,
          id: selectedLesson.id,
          revision: selectedLesson.revision ?? 0,
          data: { ...data, videoUrl: data.videoUrl },
        });
        savedId = result.id;
      } else {
        const result = await createLesson.mutateAsync({
          courseId: course.id,
          data: { ...data, videoUrl: data.videoUrl },
        });
        savedId = result.id;
      }
      const refreshed = await refreshCourse();
      const savedLesson = refreshed?.lessons.find(
        lesson => lesson.id === savedId
      );
      if (savedLesson) loadLesson(savedLesson);
      setLessonFeedback({
        type: "success",
        message: selectedLesson
          ? "La leçon a été enregistrée."
          : "La leçon a été ajoutée au cours.",
      });
    } catch (error) {
      setLessonFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "L’enregistrement de la leçon a échoué. Réessaie."
        ),
      });
    }
  };

  const archiveCurrentLesson = async () => {
    if (!course || !selectedLesson) return;
    const confirmed = window.confirm(
      "Archiver cette leçon? Elle sera retirée du cours sans supprimer les fichiers liés."
    );
    if (!confirmed) return;

    try {
      setLessonFeedback(null);
      await archiveLesson.mutateAsync({
        courseId: course.id,
        id: selectedLesson.id,
        revision: selectedLesson.revision ?? 0,
      });
      const refreshed = await refreshCourse();
      loadLesson(refreshed?.lessons[0]);
      setLessonFeedback({
        type: "success",
        message: "La leçon a été archivée.",
      });
    } catch (error) {
      setLessonFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "L’archivage de la leçon a échoué. Réessaie."
        ),
      });
    }
  };

  const persistOrder = async (nextOrder: string[], previousOrder: string[]) => {
    if (!course || reorderLessons.isPending) return;
    setLessonOrder(nextOrder);
    try {
      setLessonFeedback(null);
      await reorderLessons.mutateAsync({ courseId: course.id, ids: nextOrder });
      const refreshed = await refreshCourse();
      if (refreshed) setLessonOrder(refreshed.lessons.map(lesson => lesson.id));
    } catch (error) {
      setLessonOrder(previousOrder);
      setLessonFeedback({
        type: "error",
        message: toFriendlyError(
          error,
          "La réorganisation des leçons a échoué. L’ordre précédent a été rétabli."
        ),
      });
    }
  };

  const moveLesson = (lessonId: string, direction: -1 | 1) => {
    const from = lessonOrder.indexOf(lessonId);
    const to = from + direction;
    if (from < 0 || to < 0 || to >= lessonOrder.length) return;
    const next = [...lessonOrder];
    [next[from], next[to]] = [next[to], next[from]];
    void persistOrder(next, lessonOrder);
  };

  const onDropLesson = (
    event: DragEvent<HTMLLIElement>,
    destinationId: string
  ) => {
    event.preventDefault();
    const sourceId = draggedLessonId;
    setDraggedLessonId(null);
    if (!sourceId || sourceId === destinationId || reorderLessons.isPending)
      return;
    const from = lessonOrder.indexOf(sourceId);
    const to = lessonOrder.indexOf(destinationId);
    if (from < 0 || to < 0) return;
    const next = [...lessonOrder];
    next.splice(from, 1);
    next.splice(to, 0, sourceId);
    void persistOrder(next, lessonOrder);
  };

  if (courseQuery.isLoading) {
    return (
      <div className="admin-page">
        <div className="panel admin-loading" aria-live="polite">
          <LoaderCircle size={25} className="admin-spin-icon" /> Chargement du
          cours…
        </div>
      </div>
    );
  }

  if (courseQuery.isError || !course) {
    return (
      <div className="admin-page">
        <Link href="/admin" className="admin-breadcrumb">
          <ArrowLeft size={14} /> Retour aux cours
        </Link>
        <section className="panel admin-query-error" role="alert">
          <AlertCircle size={28} />
          <h2>Impossible de trouver ce cours</h2>
          <p>
            Le cours peut avoir été archivé ou ton accès a peut-être changé.
            Aucun contenu n’a été modifié.
          </p>
          <button
            type="button"
            className="btn secondary"
            onClick={() => {
              void courseQuery.refetch();
            }}
          >
            Réessayer
          </button>
        </section>
      </div>
    );
  }

  const isCoursePublished = course.status === "published";
  const isLessonSaving =
    createLesson.isPending || updateLesson.isPending || archiveLesson.isPending;

  return (
    <div className="admin-page">
      <Link href="/admin" className="admin-breadcrumb">
        <ArrowLeft size={14} /> Retour à mes cours
      </Link>
      <header className="admin-heading admin-editor-heading">
        <div>
          <p className="eyebrow">
            <span className="eyebrow-line" /> ÉDITEUR DE COURS
          </p>
          <h1 className="page-title">{course.title || "Cours sans titre"}</h1>
          <p className="admin-lead">
            Modifie les réglages du cours, puis prépare ses leçons dans l’ordre
            souhaité.
          </p>
        </div>
        <div className="admin-heading-actions">
          <Link className="btn secondary" href={`/admin/preview/${course.id}`}>
            <ChevronRight size={16} /> Voir comme un client
          </Link>
          {isCoursePublished && (
            <Link className="btn secondary" href={`/courses/${course.id}`}>
              <ChevronRight size={16} /> Voir publié
            </Link>
          )}
        </div>
      </header>

      <div className="admin-editor-grid">
        <div className="admin-editor-main">
          <form className="panel" onSubmit={saveCourse}>
            <header className="admin-panel-heading">
              <div>
                <p className="eyebrow">
                  <span className="eyebrow-line" /> RÉGLAGES
                </p>
                <h2>Informations du cours</h2>
                <p>
                  Choisis ce qui est visible dans la bibliothèque lorsque le
                  cours est publié.
                </p>
              </div>
              <span
                className={`admin-status ${isCoursePublished ? "is-published" : ""}`}
              >
                {isCoursePublished ? "Publié" : "Brouillon"}
              </span>
            </header>
            <fieldset
              className="admin-form-fieldset"
              disabled={
                updateCourse.isPending ||
                archiveCourse.isPending ||
                Boolean(uploadState)
              }
            >
              <div className="admin-form-grid">
                <label className="admin-field is-full">
                  <span>Titre du cours</span>
                  <input
                    value={courseForm.title}
                    onChange={event =>
                      updateCourseField("title", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="admin-field">
                  <span>Catégorie</span>
                  <input
                    value={courseForm.category}
                    onChange={event =>
                      updateCourseField("category", event.target.value)
                    }
                    required
                  />
                </label>
                <label className="admin-field">
                  <span>Étiquette</span>
                  <input
                    value={courseForm.eyebrow}
                    onChange={event =>
                      updateCourseField("eyebrow", event.target.value)
                    }
                    placeholder="ACADÉMIE EJ COACHING"
                  />
                </label>
                <label className="admin-field is-full">
                  <span>Description</span>
                  <textarea
                    value={courseForm.description}
                    onChange={event =>
                      updateCourseField("description", event.target.value)
                    }
                    placeholder="Explique l’intention du cours."
                  />
                </label>
                <label className="admin-field">
                  <span>Icône</span>
                  <select
                    value={courseForm.icon}
                    onChange={event =>
                      updateCourseField(
                        "icon",
                        event.target.value as CourseIcon
                      )
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
                      value={courseForm.color}
                      onChange={event =>
                        updateCourseField("color", event.target.value)
                      }
                    />
                    <input
                      value={courseForm.color}
                      onChange={event =>
                        updateCourseField("color", event.target.value)
                      }
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
                    value={courseForm.image ?? ""}
                    onChange={event =>
                      updateCourseField("image", event.target.value)
                    }
                    placeholder="https://…"
                  />
                </label>
                <div className="admin-field is-full">
                  <span>Téléverser une couverture</span>
                  <div className="admin-upload-box">
                    <div className="admin-upload-box-copy">
                      <strong>JPG, PNG ou WebP, jusqu’à 10 Mio</strong>
                      <span>
                        Le fichier est envoyé directement au stockage durable.
                      </span>
                    </div>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={event => {
                        void onCoverUpload(event);
                      }}
                      disabled={Boolean(uploadState)}
                    />
                  </div>
                  {uploadState?.target === "cover" && (
                    <UploadProgress state={uploadState} />
                  )}
                </div>
                <fieldset className="admin-field is-full">
                  <span>État de publication</span>
                  <div className="admin-choice-row">
                    <label className="admin-choice">
                      <input
                        type="radio"
                        name="course-status"
                        checked={courseForm.status === "draft"}
                        onChange={() => updateCourseField("status", "draft")}
                      />{" "}
                      Brouillon
                    </label>
                    <label className="admin-choice">
                      <input
                        type="radio"
                        name="course-status"
                        checked={courseForm.status === "published"}
                        onChange={() =>
                          updateCourseField("status", "published")
                        }
                      />{" "}
                      Publié
                    </label>
                  </div>
                </fieldset>
                <label className="admin-switch is-full">
                  <input
                    type="checkbox"
                    checked={courseForm.isSample}
                    onChange={event =>
                      updateCourseField("isSample", event.target.checked)
                    }
                  />
                  Marquer comme cours d’exemple
                </label>
              </div>
            </fieldset>
            {courseFeedback && <Feedback feedback={courseFeedback} />}
            <footer className="admin-save-row">
              <span
                className={`admin-save-state ${courseDirty ? "is-dirty" : ""}`}
              >
                {courseDirty
                  ? "Modifications non enregistrées"
                  : "Tout est enregistré"}
              </span>
              <button
                type="submit"
                className="btn primary"
                disabled={
                  !courseDirty ||
                  updateCourse.isPending ||
                  archiveCourse.isPending ||
                  Boolean(uploadState)
                }
              >
                {updateCourse.isPending ? (
                  <LoaderCircle size={16} className="admin-spin-icon" />
                ) : (
                  <Save size={16} />
                )}
                {updateCourse.isPending
                  ? "Enregistrement…"
                  : "Enregistrer le cours"}
              </button>
            </footer>
          </form>

          <form className="admin-lesson-editor" onSubmit={saveLesson}>
            <section className="panel">
              <header className="admin-lesson-editor-head">
                <div>
                  <p className="eyebrow">
                    <span className="eyebrow-line" />{" "}
                    {selectedLesson ? "LEÇON" : "NOUVELLE LEÇON"}
                  </p>
                  <h2>
                    {selectedLesson ? "Modifier la leçon" : "Ajouter une leçon"}
                  </h2>
                </div>
                {selectedLesson && (
                  <button
                    type="button"
                    className="icon-button"
                    onClick={() => requestLessonChange(undefined)}
                    aria-label="Créer une nouvelle leçon"
                    disabled={isLessonSaving}
                  >
                    <Plus size={19} />
                  </button>
                )}
              </header>
              <fieldset
                className="admin-form-fieldset"
                disabled={isLessonSaving || Boolean(uploadState)}
              >
                <div className="admin-form-grid">
                  <label className="admin-field is-full">
                    <span>Titre de la leçon</span>
                    <input
                      value={lessonForm.title}
                      onChange={event =>
                        updateLessonField("title", event.target.value)
                      }
                      placeholder="Ex. Une assiette qui te soutient"
                      required
                    />
                  </label>
                  <label className="admin-field">
                    <span>Durée</span>
                    <input
                      value={lessonForm.duration}
                      onChange={event =>
                        updateLessonField("duration", event.target.value)
                      }
                      inputMode="numeric"
                      placeholder="08:30"
                      aria-describedby="duration-help"
                      required
                    />
                    <small id="duration-help">
                      Format mm:ss, par exemple 08:30.
                    </small>
                  </label>
                  <div className="admin-field">
                    <span>Type de vidéo</span>
                    <div className="admin-choice-row">
                      <label className="admin-choice">
                        <input
                          type="radio"
                          name="video-type"
                          checked={lessonForm.videoType === "demo"}
                          onChange={() =>
                            updateLessonField("videoType", "demo")
                          }
                        />{" "}
                        Démo
                      </label>
                      <label className="admin-choice">
                        <input
                          type="radio"
                          name="video-type"
                          checked={lessonForm.videoType === "file"}
                          onChange={() =>
                            updateLessonField("videoType", "file")
                          }
                        />{" "}
                        Fichier
                      </label>
                      <label className="admin-choice">
                        <input
                          type="radio"
                          name="video-type"
                          checked={lessonForm.videoType === "embed"}
                          onChange={() =>
                            updateLessonField("videoType", "embed")
                          }
                        />{" "}
                        URL / intégration
                      </label>
                    </div>
                  </div>
                  <label className="admin-field is-full">
                    <span>Description</span>
                    <textarea
                      value={lessonForm.description}
                      onChange={event =>
                        updateLessonField("description", event.target.value)
                      }
                      placeholder="Explique ce qui est couvert dans cette leçon."
                    />
                  </label>
                  <label className="admin-field is-full">
                    <span>À retenir</span>
                    <textarea
                      value={lessonForm.takeaways.join("\n")}
                      onChange={event =>
                        updateLessonField(
                          "takeaways",
                          event.target.value.split("\n")
                        )
                      }
                      placeholder={
                        "Une idée par ligne\nUn geste concret\nUne question à retenir"
                      }
                    />
                    <small>
                      Une idée par ligne; les lignes vides sont ignorées.
                    </small>
                  </label>
                </div>
              </fieldset>

              <div className="admin-video-options">
                <h3>
                  <Video size={15} /> Vidéo de la leçon
                </h3>
                {lessonForm.videoType === "demo" && (
                  <p className="admin-save-state">
                    La personne verra la démonstration d’interface existante.
                    Aucune vidéo externe n’est associée.
                  </p>
                )}
                {lessonForm.videoType === "file" && (
                  <>
                    <div className="admin-upload-box">
                      <div className="admin-upload-box-copy">
                        <strong>MP4, jusqu’à 250 Mio</strong>
                        <span>
                          Attends la confirmation avant d’enregistrer la leçon.
                        </span>
                      </div>
                      <input
                        type="file"
                        accept="video/mp4,.mp4"
                        onChange={event => {
                          void onVideoUpload(event);
                        }}
                        disabled={Boolean(uploadState) || isLessonSaving}
                      />
                    </div>
                    {lessonForm.videoUrl && (
                      <p className="admin-save-state">
                        Fichier prêt : {lessonForm.videoUrl}
                      </p>
                    )}
                    {uploadState?.target === "video" && (
                      <UploadProgress state={uploadState} />
                    )}
                  </>
                )}
                {lessonForm.videoType === "embed" && (
                  <label className="admin-field">
                    <span>URL vidéo</span>
                    <input
                      type="url"
                      value={lessonForm.videoUrl ?? ""}
                      onChange={event =>
                        updateLessonField("videoUrl", event.target.value)
                      }
                      placeholder="https://player.vimeo.com/video/…"
                    />
                    <small>
                      Accepte un MP4 HTTPS ou un lien YouTube, Vimeo ou Wistia
                      reconnu. Une URL MP4 est enregistrée comme fichier vidéo;
                      les liens de partage ordinaires ne sont pas acceptés.
                      Colle le lien Vimeo complet, y compris la partie privée ou
                      le paramètre h, si présent.
                    </small>
                  </label>
                )}
              </div>

              <div className="admin-resources">
                <h3>
                  <FileText size={15} /> Documents et liens
                </h3>
                <div className="admin-upload-box">
                  <div className="admin-upload-box-copy">
                    <strong>Ajouter des PDF</strong>
                    <span>
                      Tu peux sélectionner plusieurs PDF de 25 Mio maximum. Le
                      nom du fichier est utilisé comme titre si aucun titre
                      n’est fourni.
                    </span>
                  </div>
                  <input
                    type="file"
                    accept="application/pdf,.pdf"
                    multiple
                    onChange={event => {
                      void onDocumentUpload(event);
                    }}
                    disabled={Boolean(uploadState) || isLessonSaving}
                  />
                </div>
                <label className="admin-field">
                  <span>
                    Titre pour les documents téléversés{" "}
                    <small>(facultatif)</small>
                  </span>
                  <input
                    value={documentTitle}
                    onChange={event => setDocumentTitle(event.target.value)}
                    placeholder="Ex. Guide de préparation"
                    disabled={Boolean(uploadState) || isLessonSaving}
                  />
                </label>
                {uploadState?.target === "documents" && (
                  <UploadProgress state={uploadState} />
                )}
                <div className="admin-resource-add">
                  <input
                    className="admin-resource-url"
                    value={resourceTitle}
                    onChange={event => setResourceTitle(event.target.value)}
                    placeholder="Titre du lien"
                    disabled={isLessonSaving || Boolean(uploadState)}
                  />
                  <input
                    className="admin-resource-url"
                    type="url"
                    value={resourceUrl}
                    onChange={event => setResourceUrl(event.target.value)}
                    placeholder="https://…"
                    disabled={isLessonSaving || Boolean(uploadState)}
                  />
                  <button
                    type="button"
                    className="btn secondary"
                    onClick={addResourceLink}
                    disabled={isLessonSaving || Boolean(uploadState)}
                  >
                    <Plus size={15} /> Ajouter
                  </button>
                </div>
                {lessonForm.resources.length > 0 && (
                  <ul
                    className="admin-resource-list"
                    aria-label="Ressources jointes"
                  >
                    {lessonForm.resources.map(resource => (
                      <li className="admin-resource-row" key={resource.id}>
                        <FileText size={15} />
                        <a href={resource.url} target="_blank" rel="noreferrer">
                          <strong>{resource.title}</strong>
                          <span>{resource.filename ?? resource.url}</span>
                        </a>
                        <button
                          type="button"
                          className="icon-button"
                          aria-label={`Retirer ${resource.title}`}
                          onClick={() => removeResource(resource.id)}
                          disabled={isLessonSaving}
                        >
                          <Trash2 size={16} />
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {lessonFeedback && <Feedback feedback={lessonFeedback} />}
              <footer className="admin-save-row">
                <span
                  className={`admin-save-state ${lessonDirty ? "is-dirty" : ""}`}
                >
                  {lessonDirty
                    ? "Modifications non enregistrées"
                    : selectedLesson
                      ? "Tout est enregistré"
                      : "Prépare les détails de ta nouvelle leçon"}
                </span>
                <button
                  type="submit"
                  className="btn primary"
                  disabled={
                    !lessonDirty || isLessonSaving || Boolean(uploadState)
                  }
                >
                  {isLessonSaving ? (
                    <LoaderCircle size={16} className="admin-spin-icon" />
                  ) : selectedLesson ? (
                    <Save size={16} />
                  ) : (
                    <CirclePlus size={16} />
                  )}
                  {isLessonSaving
                    ? "Enregistrement…"
                    : selectedLesson
                      ? "Enregistrer la leçon"
                      : "Ajouter la leçon"}
                </button>
              </footer>
              {selectedLesson && (
                <div className="admin-danger-zone">
                  <div>
                    <strong>Archiver cette leçon</strong>
                    <p>
                      Elle disparaît du cours, mais aucun fichier lié n’est
                      supprimé.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="btn admin-danger-button"
                    onClick={() => {
                      void archiveCurrentLesson();
                    }}
                    disabled={isLessonSaving}
                  >
                    <Archive size={15} /> Archiver
                  </button>
                </div>
              )}
            </section>
          </form>

          <section className="admin-danger-zone">
            <div>
              <strong>Archiver ce cours</strong>
              <p>
                Le cours et ses leçons ne seront plus disponibles dans les
                listes. Les fichiers liés restent conservés.
              </p>
            </div>
            <button
              type="button"
              className="btn admin-danger-button"
              onClick={() => {
                void archiveCurrentCourse();
              }}
              disabled={archiveCourse.isPending || updateCourse.isPending}
            >
              <Archive size={15} /> Archiver le cours
            </button>
          </section>
        </div>

        <aside
          className="admin-editor-aside panel"
          aria-label="Organisation des leçons"
        >
          <header className="admin-lesson-list-heading">
            <div>
              <p className="eyebrow">
                <span className="eyebrow-line" /> PLAN DU COURS
              </p>
              <h2>
                {orderedLessons.length} leçon
                {orderedLessons.length === 1 ? "" : "s"}
              </h2>
            </div>
            <button
              type="button"
              className="btn secondary"
              onClick={() => requestLessonChange(undefined)}
              disabled={isLessonSaving}
            >
              <Plus size={14} /> Ajouter
            </button>
          </header>
          {orderedLessons.length ? (
            <ol className="admin-lesson-list">
              {orderedLessons.map((lesson, index) => (
                <li
                  key={lesson.id}
                  className={`admin-lesson-list-item ${selectedLessonId === lesson.id ? "is-selected" : ""} ${draggedLessonId === lesson.id ? "is-dragging" : ""}`}
                  draggable={!reorderLessons.isPending}
                  onDragStart={() => setDraggedLessonId(lesson.id)}
                  onDragEnd={() => setDraggedLessonId(null)}
                  onDragOver={event => event.preventDefault()}
                  onDrop={event => onDropLesson(event, lesson.id)}
                >
                  <GripVertical
                    className="admin-drag-handle"
                    size={16}
                    aria-hidden="true"
                  />
                  <button
                    type="button"
                    className="admin-lesson-select"
                    onClick={() => requestLessonChange(lesson)}
                    aria-pressed={selectedLessonId === lesson.id}
                  >
                    <strong>
                      {index + 1}. {lesson.title || "Leçon sans titre"}
                    </strong>
                    <small>{lesson.duration || "Durée à définir"}</small>
                  </button>
                  <span
                    className="admin-lesson-order-actions"
                    aria-label={`Déplacer ${lesson.title}`}
                  >
                    <button
                      type="button"
                      onClick={() => moveLesson(lesson.id, -1)}
                      disabled={index === 0 || reorderLessons.isPending}
                      aria-label={`Monter ${lesson.title}`}
                    >
                      <ArrowUp size={13} />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveLesson(lesson.id, 1)}
                      disabled={
                        index === orderedLessons.length - 1 ||
                        reorderLessons.isPending
                      }
                      aria-label={`Descendre ${lesson.title}`}
                    >
                      <ArrowDown size={13} />
                    </button>
                  </span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="admin-aside-empty">
              Ajoute une première leçon. Tu pourras ensuite la déplacer par
              glisser-déposer ou avec les boutons d’ordre.
            </p>
          )}
          <footer className="admin-aside-footer">
            Le nouvel ordre est enregistré immédiatement. Le glisser-déposer est
            complété par les boutons Monter et Descendre.
          </footer>
        </aside>
      </div>
    </div>
  );
}

function UploadProgress({ state }: { state: UploadState }) {
  return (
    <div className="admin-upload-progress" aria-live="polite">
      <Upload size={14} /> Téléversement de {state.label} : {state.progress} %
      <span className="progress-track">
        <span
          className="progress-fill"
          style={{ width: `${state.progress}%` }}
        />
      </span>
    </div>
  );
}

function Feedback({
  feedback,
}: {
  feedback: { type: "error" | "success"; message: string };
}) {
  return feedback.type === "success" ? (
    <p className="admin-form-notice" role="status">
      <CheckCircle2 size={15} /> {feedback.message}
    </p>
  ) : (
    <p className="admin-form-error" role="alert">
      <AlertCircle size={15} /> {feedback.message}
    </p>
  );
}

export default function AdminEditor() {
  return (
    <AdminGate>
      <EditorContent />
    </AdminGate>
  );
}
