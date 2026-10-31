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
import {
  ClientCodeConflictError,
  ClientCodeDatabaseUnavailableError,
  ClientCodeNotFoundError,
  ClientCodeValidationError,
  clearClientSessionCookie,
  disableClientCode,
  getClientAttemptFingerprint,
  issueClientCode,
  loginWithClientCode,
  logoutClientRequest,
  setClientSessionCookie,
} from "./clientCodes";
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
  .min(1, "Le nom du client est requis.")
  .max(180, "Le nom du client doit contenir au plus 180 caractères.");

const optionalContactEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(320, "L’adresse courriel est trop longue.")
  .refine(
    value => value.length === 0 || isValidClientEmail(value),
    "L’adresse courriel est invalide."
  )
  .transform(value => value || null)
  .nullable();

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
  .object({
    email: optionalContactEmailSchema.optional().default(null),
    name: nameSchema,
    courseIds: courseIdsSchema,
  })
  .strict();

const updateInputSchema = z
  .object({
    id: clientIdSchema,
    revision: revisionSchema,
    name: nameSchema,
    courseIds: courseIdsSchema,
    email: optionalContactEmailSchema.optional(),
  })
  .strict();

const setStatusInputSchema = z
  .object({
    id: clientIdSchema,
    revision: revisionSchema,
    status: z.enum(["active", "revoked"], "Le statut du client est invalide."),
  })
  .strict();

const codeManagementInputSchema = z
  .object({ id: clientIdSchema, revision: revisionSchema })
  .strict();

// The code is intentionally not format-validated by Zod: every malformed or
// excessive value reaches the generic login outcome without revealing state.
const loginInputSchema = z.object({ code: z.string() }).strict();

function toTrpcError(error: unknown): never {
  if (error instanceof TRPCError) throw error;
  if (
    error instanceof ClientAccessNotFoundError ||
    error instanceof ClientCodeNotFoundError
  ) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (
    error instanceof ClientAccessConflictError ||
    error instanceof ClientCodeConflictError
  ) {
    throw new TRPCError({ code: "CONFLICT", message: error.message });
  }
  if (
    error instanceof ClientAccessValidationError ||
    error instanceof ClientCodeValidationError
  ) {
    throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
  }
  if (
    error instanceof ClientAccessDatabaseUnavailableError ||
    error instanceof ClientCodeDatabaseUnavailableError
  ) {
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

/** Client-management and personal-code routes, composed under `clients`. */
export const clientRouter = router({
  me: publicProcedure.query(({ ctx }) =>
    executeClientAccess(() => getAccessForUser(ctx.user, ctx.client))
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

  issueCode: adminProcedure
    .input(codeManagementInputSchema)
    .mutation(({ input }) => executeClientAccess(() => issueClientCode(input))),

  disableCode: adminProcedure
    .input(codeManagementInputSchema)
    .mutation(({ input }) =>
      executeClientAccess(() => disableClientCode(input))
    ),

  login: publicProcedure
    .input(loginInputSchema)
    .mutation(async ({ ctx, input }) => {
      const token = await executeClientAccess(() =>
        loginWithClientCode(input.code, getClientAttemptFingerprint(ctx.req))
      );
      if (!token) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "Code invalide ou accès indisponible. Vérifie ton code ou réessaie dans quelques minutes.",
        });
      }
      setClientSessionCookie(ctx.req, ctx.res, token);
      return { success: true } as const;
    }),

  logout: publicProcedure.mutation(async ({ ctx }) => {
    try {
      await logoutClientRequest(ctx.req);
    } catch {
      // Always remove the browser's client-mode cookie; no session detail is exposed.
    }
    clearClientSessionCookie(ctx.req, ctx.res);
    return { success: true } as const;
  }),
});
