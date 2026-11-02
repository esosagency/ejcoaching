import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  MAX_LEARNING_NOTE_LENGTH,
  MAX_LEGACY_LEARNING_ITEMS,
  MAX_LEGACY_NOTE_TOTAL_LENGTH,
} from "../shared/learning";
import {
  LearningConflictError,
  LearningDatabaseUnavailableError,
  LearningPermissionError,
  LearningValidationError,
  importLocal,
  reset,
  saveNote,
  setCompleted,
  setSaved,
  snapshot,
  visit,
} from "./learningDb";
import { protectedProcedure, router } from "./_core/trpc";
import type { TrpcContext } from "./_core/context";

const MAX_LESSON_ID_LENGTH = 128;
const MAX_ACCOUNT_KEY_LENGTH = 71; // "client_" plus the 64-character client id.
const MAX_NOTE_REVISION = 2_147_483_646;

const accountKeySchema = z
  .string()
  .trim()
  .min(1, "La clé du compte est requise.")
  .max(MAX_ACCOUNT_KEY_LENGTH, "La clé du compte est invalide.")
  .regex(/^client_[A-Za-z0-9_-]+$/u, "La clé du compte est invalide.");

const lessonIdSchema = z
  .string()
  .trim()
  .min(1, "L’identifiant de leçon est requis.")
  .max(MAX_LESSON_ID_LENGTH, "L’identifiant de leçon est invalide.");

const noteSchema = z
  .string()
  .max(
    MAX_LEARNING_NOTE_LENGTH,
    `Une note peut contenir au plus ${MAX_LEARNING_NOTE_LENGTH.toLocaleString("fr-CA")} caractères.`
  );

const revisionSchema = z
  .number()
  .int("La révision de la note doit être un nombre entier.")
  .min(0, "La révision de la note est invalide.")
  .max(MAX_NOTE_REVISION, "La révision de la note est invalide.");

const accountInputSchema = z.object({ accountKey: accountKeySchema }).strict();
const lessonInputSchema = accountInputSchema
  .extend({ lessonId: lessonIdSchema })
  .strict();
const setCompletedInputSchema = lessonInputSchema
  .extend({ completed: z.boolean("La valeur de complétion est invalide.") })
  .strict();
const setSavedInputSchema = lessonInputSchema
  .extend({ saved: z.boolean("La valeur enregistrée est invalide.") })
  .strict();
const saveNoteInputSchema = lessonInputSchema
  .extend({ note: noteSchema, expectedRevision: revisionSchema })
  .strict();

const legacyImportInputSchema = accountInputSchema
  .extend({
    completedIds: z
      .array(lessonIdSchema)
      .max(MAX_LEGACY_LEARNING_ITEMS, "Trop de leçons terminées à importer."),
    savedIds: z
      .array(lessonIdSchema)
      .max(
        MAX_LEGACY_LEARNING_ITEMS,
        "Trop de leçons enregistrées à importer."
      ),
    notes: z
      .array(z.object({ lessonId: lessonIdSchema, note: noteSchema }).strict())
      .max(MAX_LEGACY_LEARNING_ITEMS, "Trop de notes à importer."),
    lastLessonId: lessonIdSchema.nullable().optional(),
  })
  .strict()
  .superRefine((input, context) => {
    const itemCount =
      input.completedIds.length + input.savedIds.length + input.notes.length;
    if (itemCount > MAX_LEGACY_LEARNING_ITEMS) {
      context.addIssue({
        code: "custom",
        path: [],
        message: `L’importation est limitée à ${MAX_LEGACY_LEARNING_ITEMS.toLocaleString("fr-CA")} éléments.`,
      });
    }
    const totalNoteLength = input.notes.reduce(
      (total, item) => total + item.note.length,
      0
    );
    if (totalNoteLength > MAX_LEGACY_NOTE_TOTAL_LENGTH) {
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Le total des notes à importer est trop long.",
      });
    }
  });

function toTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof LearningConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof LearningPermissionError) {
    throw new TRPCError({ code: "FORBIDDEN", message: error.message });
  }
  if (error instanceof LearningValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof LearningDatabaseUnavailableError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message:
      "Une erreur est survenue lors de l’enregistrement de ta progression.",
  });
}

async function executeLearning<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return toTrpcError(error);
  }
}

function currentCodeClient(ctx: TrpcContext) {
  if (!ctx.client) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "La progression synchronisée est réservée aux clients connectés avec leur code personnel.",
    });
  }
  return ctx.client;
}

/** `accountKey` only rejects stale browser requests; it never selects ownership. */
function requireCurrentAccountKey(ctx: TrpcContext, accountKey: string) {
  const client = currentCodeClient(ctx);
  if (accountKey !== `client_${client.id}`) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message:
        "Ton compte a changé. Actualise ta connexion avant de modifier ta progression.",
    });
  }
  return client;
}

/** Personal-code client learning routes, registered by the parent under `learning`. */
export const learningRouter = router({
  snapshot: protectedProcedure
    .input(accountInputSchema)
    .query(({ ctx, input }) =>
      executeLearning(() =>
        snapshot(requireCurrentAccountKey(ctx, input.accountKey))
      )
    ),

  setCompleted: protectedProcedure
    .input(setCompletedInputSchema)
    .mutation(({ ctx, input }) => {
      const client = requireCurrentAccountKey(ctx, input.accountKey);
      const { accountKey: _accountKey, ...data } = input;
      return executeLearning(() => setCompleted(client, data));
    }),

  setSaved: protectedProcedure
    .input(setSavedInputSchema)
    .mutation(({ ctx, input }) => {
      const client = requireCurrentAccountKey(ctx, input.accountKey);
      const { accountKey: _accountKey, ...data } = input;
      return executeLearning(() => setSaved(client, data));
    }),

  saveNote: protectedProcedure
    .input(saveNoteInputSchema)
    .mutation(({ ctx, input }) => {
      const client = requireCurrentAccountKey(ctx, input.accountKey);
      const { accountKey: _accountKey, ...data } = input;
      return executeLearning(() => saveNote(client, data));
    }),

  visit: protectedProcedure
    .input(lessonInputSchema)
    .mutation(({ ctx, input }) => {
      const client = requireCurrentAccountKey(ctx, input.accountKey);
      return executeLearning(() => visit(client, input.lessonId));
    }),

  importLocal: protectedProcedure
    .input(legacyImportInputSchema)
    .mutation(({ ctx, input }) => {
      const client = requireCurrentAccountKey(ctx, input.accountKey);
      const { accountKey: _accountKey, ...data } = input;
      return executeLearning(() => importLocal(client, data));
    }),

  reset: protectedProcedure
    .input(accountInputSchema)
    .mutation(({ ctx, input }) =>
      executeLearning(() =>
        reset(requireCurrentAccountKey(ctx, input.accountKey))
      )
    ),
});
