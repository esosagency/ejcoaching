import fs from "node:fs/promises";
import mysql from "mysql2/promise";

const backupPath = "/tmp/ej-learning-test-backup.json";
const technicalId = "REQPv6QEJAm4MKdgj2ZfL";
const expectedRevision = Number(process.argv[2]);
if (!Number.isSafeInteger(expectedRevision) || expectedRevision < 1) {
  throw new Error("Provide the final technical-client revision from the verified test.");
}
const backup = JSON.parse(await fs.readFile(backupPath, "utf8"));
const original = backup.client;
if (original.id !== technicalId || original.name !== "Client test EJ" || original.status !== "revoked") {
  throw new Error("Backup is not the designated inactive technical client.");
}
const connection = await mysql.createConnection(process.env.DATABASE_URL!);
try {
  await connection.beginTransaction();
  const [rows] = await connection.query<mysql.RowDataPacket[]>(
    "SELECT id,name,revision FROM coachingClients WHERE id = ? FOR UPDATE",
    [technicalId],
  );
  const current = rows[0];
  if (!current || current.name !== "Client test EJ" || current.revision !== expectedRevision) {
    throw new Error("Technical client changed outside the test; cleanup refused to overwrite it.");
  }
  const now = new Date();
  const [result] = await connection.execute<mysql.ResultSetHeader>(
    "UPDATE coachingClients SET status = 'revoked', codeLookupHash = ?, codeVerifier = ?, codeIssuedAt = ?, lastCodeLoginAt = ?, codeVersion = codeVersion + 1, revision = revision + 1, updatedAt = ? WHERE id = ? AND revision = ?",
    [
      original.codeLookupHash ?? null,
      original.codeVerifier ?? null,
      original.codeIssuedAt ? new Date(original.codeIssuedAt) : null,
      original.lastCodeLoginAt ? new Date(original.lastCodeLoginAt) : null,
      now,
      technicalId,
      expectedRevision,
    ],
  );
  if (result.affectedRows !== 1) throw new Error("Technical-client cleanup conflict.");
  await connection.execute(
    "UPDATE clientCodeSessions SET revokedAt = ? WHERE clientId = ? AND revokedAt IS NULL",
    [now, technicalId],
  );
  // These tables are newly introduced in this task; the actual test requires
  // confirming this client's rows are empty before making any learning writes.
  await connection.execute("DELETE FROM clientLessonProgress WHERE clientId = ?", [technicalId]);
  await connection.execute("DELETE FROM clientLearningState WHERE clientId = ?", [technicalId]);
  await connection.commit();
  console.log({
    restoredOriginalTechnicalCodeSettings: true,
    technicalClientRevoked: true,
    temporaryClientSessionsRevoked: true,
    technicalLearningRowsRemoved: true,
    otherClientRecordsTouched: false,
  });
  await fs.rm(backupPath);
} catch (error) {
  await connection.rollback();
  throw error;
} finally {
  await connection.end();
}
