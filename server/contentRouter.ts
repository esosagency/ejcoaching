import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { storageGet, storageGetSignedUrl } from "./storage";
import { ENV } from "./_core/env";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";
import {
  ContentConflictError,
  ContentDatabaseUnavailableError,
  ContentNotFoundError,
  ContentValidationError,
  archiveCourse,
  archiveLesson,
  createCourse,
  createLesson,
  createPendingUpload,
  getAdminCourse,
  getOwnedUpload,
  listAdminCourses,
  listPublicCourses,
  markUploadReady,
  reorderLessons,
  updateCourse,
  updateLesson,
} from "./contentDb";
import {
  courseInputSchema,
  genericUploadInputSchema,
  getUploadRule,
  idSchema,
  lessonInputSchema,
  revisionSchema,
  uploadInputSchema,
} from "./contentValidation";

function toTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ContentNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ContentConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof ContentValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof ContentDatabaseUnavailableError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Une erreur est survenue lors de la gestion du contenu.",
  });
}

async function executeContent<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return toTrpcError(error);
  }
}

async function createPutUploadUrl(objectKey: string): Promise<string> {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new ContentValidationError(
      "Le service de téléversement n’est pas configuré."
    );
  }

  const presignUrl = new URL(
    "v1/storage/presign/put",
    `${forgeUrl.replace(/\/+$/, "")}/`
  );
  presignUrl.searchParams.set("path", objectKey);

  let response: Response;
  try {
    response = await fetch(presignUrl, {
      headers: { Authorization: `Bearer ${forgeKey}` },
    });
  } catch {
    throw new ContentValidationError(
      "Impossible de préparer le téléversement pour le moment."
    );
  }
  if (!response.ok) {
    throw new ContentValidationError(
      "Impossible de préparer le téléversement pour le moment."
    );
  }

  const payload = (await response.json().catch(() => null)) as {
    url?: unknown;
  } | null;
  if (!payload || typeof payload.url !== "string" || payload.url.length === 0) {
    throw new ContentValidationError(
      "Le service de téléversement a retourné une réponse invalide."
    );
  }
  return payload.url;
}

async function verifyUploadedObject(upload: {
  objectKey: string;
  contentType: string;
  size: number;
}): Promise<void> {
  const rule = getUploadRule(upload.contentType);
  if (!rule || upload.size > rule.maxSize) {
    throw new ContentValidationError(
      "Les métadonnées du fichier ne sont pas valides."
    );
  }

  let signedUrl: string;
  try {
    signedUrl = await storageGetSignedUrl(upload.objectKey);
  } catch {
    throw new ContentValidationError(
      "Impossible de vérifier le fichier téléversé."
    );
  }

  let response: Response;
  try {
    response = await fetch(signedUrl, { method: "HEAD", redirect: "error" });
  } catch {
    // A storage service that cannot verify HEAD fails closed: no ready record or URL is issued.
    throw new ContentValidationError(
      "Le stockage ne permet pas de vérifier ce fichier. Réessayez le téléversement."
    );
  }
  if (!response.ok) {
    throw new ContentValidationError(
      "Le fichier téléversé est introuvable ou ne peut pas être vérifié."
    );
  }

  const actualSize = Number(response.headers.get("content-length"));
  const actualContentType = response.headers
    .get("content-type")
    ?.split(";", 1)[0]
    ?.trim()
    .toLowerCase();
  if (
    !Number.isSafeInteger(actualSize) ||
    actualSize !== upload.size ||
    actualSize > rule.maxSize ||
    actualContentType !== upload.contentType
  ) {
    throw new ContentValidationError(
      "La taille ou le type du fichier téléversé ne correspond pas aux métadonnées annoncées."
    );
  }
}

export const contentRouter = router({
  catalog: publicProcedure.query(() =>
    executeContent(() => listPublicCourses())
  ),

  adminList: adminProcedure.query(() =>
    executeContent(() => listAdminCourses())
  ),

  adminGet: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .query(({ input }) => executeContent(() => getAdminCourse(input.id))),

  createCourse: adminProcedure
    .input(courseInputSchema)
    .mutation(async ({ input }) => ({
      id: await executeContent(() => createCourse(input)),
    })),

  updateCourse: adminProcedure
    .input(
      z
        .object({
          id: idSchema,
          revision: revisionSchema,
          data: courseInputSchema,
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      await executeContent(() =>
        updateCourse(input.id, input.revision, input.data)
      );
      return { id: input.id };
    }),

  archiveCourse: adminProcedure
    .input(z.object({ id: idSchema, revision: revisionSchema }).strict())
    .mutation(async ({ input }) => {
      await executeContent(() => archiveCourse(input.id, input.revision));
      return { ok: true as const };
    }),

  createLesson: adminProcedure
    .input(z.object({ courseId: idSchema, data: lessonInputSchema }).strict())
    .mutation(async ({ input }) => ({
      id: await executeContent(() => createLesson(input.courseId, input.data)),
    })),

  updateLesson: adminProcedure
    .input(
      z
        .object({
          courseId: idSchema,
          id: idSchema,
          revision: revisionSchema,
          data: lessonInputSchema,
        })
        .strict()
    )
    .mutation(async ({ input }) => {
      await executeContent(() =>
        updateLesson(input.courseId, input.id, input.revision, input.data)
      );
      return { id: input.id };
    }),

  archiveLesson: adminProcedure
    .input(
      z
        .object({ courseId: idSchema, id: idSchema, revision: revisionSchema })
        .strict()
    )
    .mutation(async ({ input }) => {
      await executeContent(() =>
        archiveLesson(input.courseId, input.id, input.revision)
      );
      return { ok: true as const };
    }),

  reorderLessons: adminProcedure
    .input(
      z.object({ courseId: idSchema, ids: z.array(idSchema).max(200) }).strict()
    )
    .mutation(async ({ input }) => {
      await executeContent(() => reorderLessons(input.courseId, input.ids));
      return { ok: true as const };
    }),

  prepareUpload: adminProcedure
    .input(genericUploadInputSchema)
    .mutation(async ({ ctx, input }) => {
      const upload = await executeContent(() =>
        createPendingUpload(ctx.user.id, input)
      );
      const uploadUrl = await executeContent(() =>
        createPutUploadUrl(upload.objectKey)
      );
      return { id: upload.id, uploadUrl };
    }),

  finishUpload: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const upload = await executeContent(() =>
        getOwnedUpload(input.id, ctx.user.id)
      );
      if (upload.kind === "video") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Les vidéos doivent être confirmées par le traitement vidéo sécurisé.",
        });
      }
      const stable = await storageGet(upload.objectKey);

      if (upload.status === "ready") {
        return { id: upload.id, filename: upload.filename, url: stable.url };
      }

      await executeContent(() => verifyUploadedObject(upload));
      const markedReady = await executeContent(() =>
        markUploadReady(upload.id, ctx.user.id)
      );
      if (!markedReady) {
        const current = await executeContent(() =>
          getOwnedUpload(upload.id, ctx.user.id)
        );
        if (current.status === "ready") {
          return {
            id: current.id,
            filename: current.filename,
            url: stable.url,
          };
        }
        throw new TRPCError({
          code: "CONFLICT",
          message: "Le fichier a changé d’état; réessayez la confirmation.",
        });
      }

      return { id: upload.id, filename: upload.filename, url: stable.url };
    }),
});
