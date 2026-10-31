import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  ClientAccessConflictError,
  ClientAccessDatabaseUnavailableError,
  ClientAccessNotFoundError,
  ClientAccessValidationError,
  approveClient,
  getAccessForUser,
  isValidClientEmail,
  listClients,
  setClientStatus,
  updateClient,
} from "./clientAccess";
import { adminProcedure, publicProcedure, router } from "./_core/trpc";

const clientIdSchema = z
  .string()
  .trim()
  .min(1, "L’identifiant du client est requis.")
  .max(64, "L’identifiant du client est invalide.");

const revisionSchema = z
  .number()
  .int("La révision du client doit être un nombre entier.")
  .min(1, "La révision du client est invalide.");

const nameSchema = z
  .string()
  .trim()
  .max(180, "Le nom du client doit contenir au plus 180 caractères.");

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "L’adresse courriel est trop longue.")
  .refine(isValidClientEmail, "L’adresse courriel est invalide.");

const courseIdSchema = z
  .string()
  .trim()
  .min(1, "Un identifiant de cours est requis.")
  .max(128, "Un identifiant de cours est invalide.");

const courseIdsSchema = z
  .array(courseIdSchema)
  .max(200, "Sélectionnez au plus 200 cours pour un client.")
  .superRefine((courseIds, ctx) => {
    const seen = new Set<string>();
    for (const [index, courseId] of courseIds.entries()) {
      if (seen.has(courseId)) {
        ctx.addIssue({
          code: "custom",
          path: [index],
          message: "Un cours ne peut être sélectionné qu’une seule fois.",
        });
      }
      seen.add(courseId);
    }
  });

const approveInputSchema = z
  .object({ email: emailSchema, name: nameSchema, courseIds: courseIdsSchema })
  .strict();

const updateInputSchema = z
  .object({
    id: clientIdSchema,
    revision: revisionSchema,
    name: nameSchema,
    courseIds: courseIdsSchema,
  })
  .strict();

const setStatusInputSchema = z
  .object({
    id: clientIdSchema,
    revision: revisionSchema,
    status: z.enum(["active", "revoked"], "Le statut du client est invalide."),
  })
  .strict();

function toTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (error instanceof ClientAccessNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof ClientAccessConflictError) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (error instanceof ClientAccessValidationError) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (error instanceof ClientAccessDatabaseUnavailableError) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: error.message,
    });
  }
  throw new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: "Une erreur est survenue lors de la gestion des accès clients.",
  });
}

async function executeClientAccess<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    return toTrpcError(error);
  }
}

/**
 * Parent route composition registers this router as `clients`. It deliberately
 * contains no OAuth changes, outbound email, progress, payment, or media-key
 * endpoints.
 */
export const clientRouter = router({
  me: publicProcedure.query(({ ctx }) =>
    executeClientAccess(() => getAccessForUser(ctx.user))
  ),

  adminList: adminProcedure.query(() =>
    executeClientAccess(() => listClients())
  ),

  approve: adminProcedure
    .input(approveInputSchema)
    .mutation(async ({ ctx, input }) => ({
      id: await executeClientAccess(() => approveClient(ctx.user.id, input)),
    })),

  update: adminProcedure
    .input(updateInputSchema)
    .mutation(async ({ input }) => {
      await executeClientAccess(() => updateClient(input));
      return { id: input.id };
    }),

  setStatus: adminProcedure
    .input(setStatusInputSchema)
    .mutation(async ({ input }) => {
      await executeClientAccess(() => setClientStatus(input));
      return { id: input.id };
    }),
});
