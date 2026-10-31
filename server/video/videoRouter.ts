import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_PHONE_VIDEO_BYTES,
  getPhoneVideoContentType,
} from "../../shared/phoneVideo";
import { adminProcedure, router } from "../_core/trpc";
import { idSchema, revisionSchema } from "../contentValidation";
import { prepareStoredPut, verifyStoredSource } from "./mediaStorage";
import {
  VideoJobConflictError,
  VideoJobDatabaseUnavailableError,
  VideoJobNotFoundError,
  VideoJobValidationError,
  abandonVideoPreparation,
  cancelVideoJob,
  createPhoneVideoJob,
  getOwnedVideoJobInfo,
  getOwnedVideoJobSource,
  queueVerifiedVideoJob,
  retryFailedVideoJob,
} from "./videoDb";
import { kickVideoWorker } from "./videoWorker";

function toTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof VideoJobNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof VideoJobConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof VideoJobValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof VideoJobDatabaseUnavailableError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Une erreur est survenue lors du traitement de la vidéo.",
  });
}

async function executeVideo<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return toTrpcError(error);
  }
}

const filenameSchema = z
  .string()
  .trim()
  .min(1, "Le nom de fichier est requis.")
  .max(255, "Le nom de fichier est trop long.")
  .refine(
    value => !/[\u0000-\u001f\\/]/.test(value),
    "Le nom de fichier est invalide."
  );

const videoPrepareSchema = z
  .object({
    lessonId: idSchema,
    revision: revisionSchema,
    filename: filenameSchema,
    contentType: z.string().trim().max(128).optional(),
    size: z
      .number()
      .int()
      .positive("La taille doit être positive.")
      .max(
        MAX_PHONE_VIDEO_BYTES,
        "La vidéo dépasse la limite de 1 Go autorisée."
      ),
  })
  .strict();

export const videoRouter = router({
  prepare: adminProcedure
    .input(videoPrepareSchema)
    .mutation(async ({ ctx, input }) => {
      const contentType = getPhoneVideoContentType(
        input.filename,
        input.contentType
      );
      if (!contentType) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Ce format vidéo n’est pas pris en charge. Utilisez MOV, MP4, M4V, WebM, 3GP ou 3G2.",
        });
      }

      const prepared = await executeVideo(() =>
        createPhoneVideoJob(ctx.user.id, { ...input, contentType })
      );
      try {
        const uploadUrl = await prepareStoredPut(prepared.sourceObjectKey);
        return {
          jobId: prepared.jobId,
          uploadUrl,
          contentType,
          lessonRevision: prepared.lessonRevision,
        };
      } catch (error) {
        // The client never received this id, so fence it and release its lesson pointer.
        await abandonVideoPreparation(prepared.jobId, ctx.user.id).catch(() => {
          // Do not replace the user-safe presign error with cleanup failure details.
        });
        return toTrpcError(error);
      }
    }),

  finish: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const source = await executeVideo(() =>
        getOwnedVideoJobSource(input.id, ctx.user.id)
      );

      if (source.status === "uploading") {
        await executeVideo(() =>
          verifyStoredSource({
            objectKey: source.sourceObjectKey,
            size: source.sourceSize,
            contentType: source.sourceContentType,
          })
        );
        await executeVideo(() => queueVerifiedVideoJob(input.id, ctx.user.id));
      }

      const result = await executeVideo(() =>
        getOwnedVideoJobInfo(input.id, ctx.user.id)
      );
      kickVideoWorker();
      return result;
    }),

  get: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .query(async ({ ctx, input }) => {
      const result = await executeVideo(() =>
        getOwnedVideoJobInfo(input.id, ctx.user.id)
      );
      // A normal poll also prompts bounded lease recovery after a process restart.
      kickVideoWorker();
      return result;
    }),

  retry: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const result = await executeVideo(() =>
        retryFailedVideoJob(input.id, ctx.user.id)
      );
      kickVideoWorker();
      return result;
    }),

  cancel: adminProcedure
    .input(z.object({ id: idSchema }).strict())
    .mutation(async ({ ctx, input }) =>
      executeVideo(() => cancelVideoJob(input.id, ctx.user.id))
    ),
});
