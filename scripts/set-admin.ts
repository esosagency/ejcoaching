import "dotenv/config";
import { and, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { adminAccess, users } from "../drizzle/schema";

function normalizeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (
    email.length === 0 ||
    email.length > 320 ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Veuillez fournir une adresse courriel valide.");
  }
  return email;
}

function affectedRows(result: unknown): number {
  if (!Array.isArray(result) || !result[0] || typeof result[0] !== "object")
    return 0;
  const value = (result[0] as { affectedRows?: unknown }).affectedRows;
  return typeof value === "number" ? value : 0;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length !== 1) {
    throw new Error(
      "Usage : pnpm tsx scripts/set-admin.ts adresse@exemple.com"
    );
  }
  const email = normalizeEmail(args[0]!);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL est requis pour configurer l’accès administrateur."
    );

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const db = drizzle({ client: connection });
    await db
      .insert(adminAccess)
      .values({ email, createdAt: new Date() })
      .onDuplicateKeyUpdate({ set: { email: sql`email` } });

    // This only changes a pre-existing OAuth identity. It never inserts a users row.
    const result = await db
      .update(users)
      .set({ role: "admin" })
      .where(
        and(sql`lower(${users.email}) = ${email}`, sql`${users.openId} <> ''`)
      );

    console.log(
      `Autorisation enregistrée; ${affectedRows(result)} compte OAuth existant promu.`
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error
      ? error.message
      : "Échec de la configuration administrateur."
  );
  process.exitCode = 1;
});
