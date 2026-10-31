import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/mysql2';
import { adminAccess, type InsertUser, users } from '../drizzle/schema';

let _db: ReturnType<typeof drizzle> | null = null;
export async function getDb() {
  if (!_db && process.env.DATABASE_URL) _db = drizzle(process.env.DATABASE_URL);
  return _db;
}

export async function upsertUser(user: Omit<InsertUser, 'role'>): Promise<void> {
  if (!user.openId) throw new Error('Identifiant de connexion manquant.');
  const db = await getDb();
  if (!db) throw new Error('La base de données n’est pas disponible.');
  const [existing] = await db.select().from(users).where(eq(users.openId, user.openId)).limit(1);
  // Email comes only from the validated OAuth identity, never from an application form.
  const email = (user.email !== undefined ? user.email : existing?.email)?.trim().toLowerCase() || null;
  const [authorization] = email ? await db.select().from(adminAccess).where(eq(adminAccess.email, email)).limit(1) : [];
  const role = authorization ? 'admin' : 'user';
  const values: InsertUser = { openId: user.openId, role, lastSignedIn: user.lastSignedIn ?? new Date() };
  const updates: Record<string, unknown> = { role, lastSignedIn: values.lastSignedIn };
  for (const field of ['name', 'email', 'loginMethod'] as const) {
    if (user[field] !== undefined) {
      const value = field === 'email' ? email : user[field] ?? null;
      values[field] = value;
      updates[field] = value;
    }
  }
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updates });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const [user] = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return user;
}
