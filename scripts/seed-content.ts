import "dotenv/config";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { courses } from "../client/src/lib/courses";
import {
  contentCourses,
  contentLessons,
  contentSetup,
} from "../drizzle/schema";
import { CONTENT_SEED_MARKER } from "../server/contentDb";

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl)
    throw new Error(
      "DATABASE_URL est requis pour importer le contenu initial."
    );

  const connection = await mysql.createConnection(databaseUrl);
  try {
    const db = drizzle({ client: connection });
    const imported = await db.transaction(async tx => {
      const [marker] = await tx
        .select({ marker: contentSetup.marker })
        .from(contentSetup)
        .where(eq(contentSetup.marker, CONTENT_SEED_MARKER))
        .limit(1);
      if (marker) return false;

      for (const [coursePosition, course] of courses.entries()) {
        await tx
          .insert(contentCourses)
          .values({
            id: course.id,
            title: course.title,
            category: course.category,
            eyebrow: course.eyebrow,
            description: course.description,
            color: course.color,
            image: course.image ?? null,
            icon: course.icon,
            status: "published",
            isSample: true,
            position: coursePosition,
            revision: 1,
            createdAt: new Date(),
            updatedAt: new Date(),
          })
          // A missing marker must never be an excuse to overwrite admin edits.
          .onDuplicateKeyUpdate({ set: { id: sql`id` } });

        for (const [lessonPosition, lesson] of course.lessons.entries()) {
          await tx
            .insert(contentLessons)
            .values({
              id: lesson.id,
              courseId: course.id,
              title: lesson.title,
              duration: lesson.duration,
              description: lesson.description,
              takeaways: lesson.takeaways,
              videoUrl: null,
              videoType: "demo",
              resources: [],
              position: lessonPosition,
              revision: 1,
              createdAt: new Date(),
              updatedAt: new Date(),
            })
            .onDuplicateKeyUpdate({ set: { id: sql`id` } });
        }
      }

      await tx
        .insert(contentSetup)
        .values({ marker: CONTENT_SEED_MARKER, completedAt: new Date() })
        .onDuplicateKeyUpdate({ set: { marker: sql`marker` } });
      return true;
    });

    console.log(
      imported
        ? "Contenu d’exemple importé."
        : "Contenu d’exemple déjà importé."
    );
  } finally {
    await connection.end();
  }
}

main().catch((error: unknown) => {
  console.error(
    error instanceof Error ? error.message : "Échec de l’import du contenu."
  );
  process.exitCode = 1;
});
