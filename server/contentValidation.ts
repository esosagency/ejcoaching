import { isIP } from "node:net";
import { z } from "zod";
import type {
  CourseInput,
  LessonInput,
  LessonResource,
} from "../shared/content";
import { parseVimeoUrl } from "../shared/vimeo";

const MAX_URL_LENGTH = 2048;
const MAX_RESOURCE_COUNT = 30;
const MAX_TAKEAWAY_COUNT = 30;
const ONE_MIB = 1024 * 1024;

export const COURSE_ICONS = [
  "nutrition",
  "training",
  "mindset",
  "deficit",
  "surplus",
  "equipment",
  "supplements",
] as const;

const stableStorageKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,511}$/;
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;
const resourceIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

function isPublicIpAddress(hostname: string): boolean {
  if (isIP(hostname) === 4) {
    const octets = hostname.split(".").map(Number);
    const [a, b] = octets;
    if (a === 0 || a === 10 || a === 127 || a! >= 224) return false;
    if (a === 100 && b! >= 64 && b! <= 127) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b! >= 16 && b! <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 192 && b === 0) return false;
    if (a === 198 && (b === 18 || b === 19)) return false;
    return true;
  }

  if (isIP(hostname) === 6) {
    const normalized = hostname.toLowerCase();
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      normalized.startsWith("fe80:")
    );
  }

  const normalizedHost = hostname.toLowerCase();
  return !(
    normalizedHost === "localhost" ||
    normalizedHost.endsWith(".localhost") ||
    normalizedHost.endsWith(".local") ||
    normalizedHost.endsWith(".internal")
  );
}

/** Accepts only stable Manus storage paths or public HTTPS URLs without credentials. */
export function isSafeContentUrl(value: string): boolean {
  if (value.startsWith("/manus-storage/")) {
    const key = value.slice("/manus-storage/".length);
    return (
      stableStorageKeyPattern.test(key) &&
      !key.split("/").some(part => part === "." || part === "..")
    );
  }

  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      url.username === "" &&
      url.password === "" &&
      (url.port === "" || url.port === "443") &&
      isPublicIpAddress(url.hostname)
    );
  } catch {
    return false;
  }
}

/** True only for a stable internal storage reference, never a signed URL. */
export function isManagedStorageUrl(value: string): boolean {
  return value.startsWith("/manus-storage/") && isSafeContentUrl(value);
}

/** Limits embeds to browser-safe, known video provider URL forms. */
export function isRecognizedVideoEmbed(value: string): boolean {
  if (!isSafeContentUrl(value) || value.startsWith("/")) return false;

  const url = new URL(value);
  const host = url.hostname.toLowerCase();
  const parts = url.pathname.split("/").filter(Boolean);
  const videoId = /^[A-Za-z0-9_-]{6,128}$/;

  if (host === "youtu.be") return parts.length === 1 && videoId.test(parts[0]!);
  if (
    host === "youtube.com" ||
    host === "www.youtube.com" ||
    host === "m.youtube.com"
  ) {
    if (parts[0] === "watch")
      return videoId.test(url.searchParams.get("v") ?? "");
    return (
      (parts[0] === "embed" || parts[0] === "shorts") &&
      parts.length === 2 &&
      videoId.test(parts[1]!)
    );
  }
  if (
    (host === "youtube-nocookie.com" || host === "www.youtube-nocookie.com") &&
    parts[0] === "embed"
  ) {
    return parts.length === 2 && videoId.test(parts[1]!);
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
      /^[A-Za-z0-9_-]{5,128}$/.test(parts[2]!)
    );
  }
  if (host === "wistia.com" || host === "www.wistia.com") {
    return (
      parts.length === 2 &&
      parts[0] === "medias" &&
      /^[A-Za-z0-9_-]{5,128}$/.test(parts[1]!)
    );
  }

  return false;
}

const requiredText = (label: string, max: number) =>
  z
    .string()
    .trim()
    .min(1, `${label} est requis.`)
    .max(max, `${label} est trop long.`);

const optionalContentUrl = z
  .string()
  .trim()
  .min(1, "L’URL ne peut pas être vide.")
  .max(MAX_URL_LENGTH, "L’URL est trop longue.")
  .refine(
    isSafeContentUrl,
    "L’URL doit être HTTPS publique ou une clé /manus-storage valide."
  )
  .optional();

const resourceSchema = z
  .object({
    id: z
      .string()
      .trim()
      .min(1, "L’identifiant de ressource est requis.")
      .max(128, "L’identifiant de ressource est trop long.")
      .regex(
        resourceIdentifierPattern,
        "L’identifiant de ressource est invalide."
      ),
    title: requiredText("Le titre de la ressource", 180),
    url: z
      .string()
      .trim()
      .max(MAX_URL_LENGTH, "L’URL est trop longue.")
      .refine(isSafeContentUrl, "L’URL de ressource est invalide."),
    filename: z
      .string()
      .trim()
      .min(1, "Le nom de fichier ne peut pas être vide.")
      .max(255, "Le nom de fichier est trop long.")
      .refine(
        value => !/[\u0000-\u001f]/.test(value),
        "Le nom de fichier est invalide."
      )
      .optional(),
  })
  .strict();

export const courseInputSchema = z
  .object({
    title: requiredText("Le titre", 180),
    category: requiredText("La catégorie", 100),
    eyebrow: requiredText("Le sous-titre", 160),
    description: requiredText("La description", 10_000),
    color: z
      .string()
      .trim()
      .regex(
        /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/,
        "La couleur doit être un code hexadécimal."
      ),
    image: optionalContentUrl,
    icon: z.enum(COURSE_ICONS),
    status: z.enum(["draft", "published"]),
    isSample: z.boolean(),
  })
  .strict();

export const lessonInputSchema = z
  .object({
    title: requiredText("Le titre", 180),
    duration: z
      .string()
      .trim()
      .regex(/^\d{1,3}:[0-5]\d$/, "La durée doit utiliser le format mm:ss.")
      .max(32),
    description: requiredText("La description", 10_000),
    takeaways: z
      .array(requiredText("Un point clé", 500))
      .max(MAX_TAKEAWAY_COUNT, "Il y a trop de points clés."),
    videoUrl: optionalContentUrl,
    videoType: z.enum(["demo", "file", "embed"]),
    resources: z
      .array(resourceSchema)
      .max(MAX_RESOURCE_COUNT, "Il y a trop de ressources."),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.videoType === "embed") {
      if (!value.videoUrl || !isRecognizedVideoEmbed(value.videoUrl)) {
        ctx.addIssue({
          code: "custom",
          path: ["videoUrl"],
          message:
            "Une URL YouTube, Vimeo ou Wistia valide est requise pour une vidéo intégrée.",
        });
      }
    }

    if (value.videoType === "file" && !value.videoUrl) {
      ctx.addIssue({
        code: "custom",
        path: ["videoUrl"],
        message: "Une vidéo prête à la lecture est requise.",
      });
    }

    const resourceIds = new Set<string>();
    for (const [index, resource] of value.resources.entries()) {
      if (resourceIds.has(resource.id)) {
        ctx.addIssue({
          code: "custom",
          path: ["resources", index, "id"],
          message: "Chaque ressource doit avoir un identifiant unique.",
        });
      }
      resourceIds.add(resource.id);
    }
  });

export const idSchema = z
  .string()
  .trim()
  .min(1, "L’identifiant est requis.")
  .max(128, "L’identifiant est trop long.")
  .regex(identifierPattern, "L’identifiant est invalide.");

export const revisionSchema = z.number().int().min(1).max(2_147_483_647);

/** Rejects duplicate, missing, or foreign lesson ids before a reorder can write. */
export function assertExactLessonPermutation(
  actualIds: string[],
  requestedIds: string[]
): void {
  if (
    requestedIds.length !== actualIds.length ||
    new Set(requestedIds).size !== requestedIds.length
  ) {
    throw new Error(
      "L’ordre des leçons doit contenir chaque leçon active exactement une fois."
    );
  }
  const expected = new Set(actualIds);
  if (requestedIds.some(id => !expected.has(id))) {
    throw new Error(
      "L’ordre des leçons contient une leçon qui n’appartient pas à ce cours."
    );
  }
}

export const uploadRules = {
  "video/mp4": { kind: "video", maxSize: 250 * ONE_MIB, extension: "mp4" },
  "application/pdf": {
    kind: "document",
    maxSize: 25 * ONE_MIB,
    extension: "pdf",
  },
  "image/jpeg": { kind: "image", maxSize: 10 * ONE_MIB, extension: "jpg" },
  "image/png": { kind: "image", maxSize: 10 * ONE_MIB, extension: "png" },
  "image/webp": { kind: "image", maxSize: 10 * ONE_MIB, extension: "webp" },
} as const;

export type UploadContentType = keyof typeof uploadRules;
export type UploadKind = (typeof uploadRules)[UploadContentType]["kind"];

export function getUploadRule(contentType: string) {
  return uploadRules[contentType as UploadContentType];
}

export const uploadInputSchema = z
  .object({
    filename: z
      .string()
      .trim()
      .min(1, "Le nom de fichier est requis.")
      .max(255, "Le nom de fichier est trop long.")
      .refine(
        value => !/[\u0000-\u001f]/.test(value),
        "Le nom de fichier est invalide."
      ),
    contentType: z.string().trim().toLowerCase().max(128),
    size: z
      .number()
      .int()
      .positive("La taille doit être positive.")
      .max(250 * ONE_MIB),
    kind: z.enum(["video", "image", "document"]),
  })
  .strict()
  .superRefine((value, ctx) => {
    const rule = getUploadRule(value.contentType);
    if (!rule || rule.kind !== value.kind) {
      ctx.addIssue({
        code: "custom",
        path: ["contentType"],
        message: "Ce type de fichier n’est pas autorisé.",
      });
      return;
    }
    if (value.size > rule.maxSize) {
      ctx.addIssue({
        code: "custom",
        path: ["size"],
        message: "Le fichier dépasse la limite autorisée.",
      });
    }
  });

/**
 * Generic uploads remain available for documents and images. Video originals
 * must use the fenced video router and never become directly playable here.
 */
export const genericUploadInputSchema = uploadInputSchema.superRefine(
  (value, ctx) => {
    if (value.kind === "video") {
      ctx.addIssue({
        code: "custom",
        path: ["kind"],
        message:
          "Les vidéos doivent être téléversées avec le traitement vidéo sécurisé.",
      });
    }
  }
);

export type ValidCourseInput = z.infer<typeof courseInputSchema> & CourseInput;
export type ValidLessonInput = z.infer<typeof lessonInputSchema> & LessonInput;
export type ValidLessonResource = z.infer<typeof resourceSchema> &
  LessonResource;
export type ValidUploadInput = z.infer<typeof uploadInputSchema>;
