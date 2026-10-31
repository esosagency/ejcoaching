import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { nanoid } from "nanoid";
import { getDb } from "../server/db";
import {
  adminAccess,
  users,
  contentUploads,
  privateMedia,
} from "../drizzle/schema";
import {
  preparePrivateMedia,
  preparePrivatePart,
  verifyPrivateStoredMedia,
  downloadPrivateSource,
  uploadPrivateLocalFile,
  getPrivateMedia,
  readPrivateMediaRange,
} from "../server/privateMediaStorage";
import {
  encryptPrivateFileChunk,
  privateChunkCount,
} from "../shared/privateMedia";
import { convertPhoneVideo } from "../server/video/mediaProcessor";

const manifest = "/tmp/ej-client-private-check.json";
async function main() {
  const db = await getDb();
  if (!db) throw new Error("Database unavailable");
  if (process.argv[2] === "cleanup") {
    const data = JSON.parse(await readFile(manifest, "utf8")) as {
      keys: string[];
      uploadIds: string[];
    };
    if (
      !data.keys.every(key =>
        /^ej-private-check\/[A-Za-z0-9_-]{16,64}\/(source|output|poster)\.(mp4|jpg)$/.test(
          key
        )
      ) ||
      data.uploadIds.some(id => !id.startsWith("private-check-"))
    )
      throw new Error("Invalid diagnostic manifest");
    await db.transaction(async tx => {
      await tx
        .delete(contentUploads)
        .where(inArray(contentUploads.id, data.uploadIds));
      await tx
        .delete(privateMedia)
        .where(inArray(privateMedia.objectKey, data.keys));
    });
    await rm(manifest, { force: true });
    console.log(
      "Temporary diagnostic indexes removed; no courses, jobs or approvals changed."
    );
    return;
  }
  const [owner] = await db
    .select({ id: users.id })
    .from(users)
    .innerJoin(adminAccess, eq(users.email, adminAccess.email))
    .where(eq(users.role, "admin"))
    .limit(1);
  if (!owner) throw new Error("No actual authorized owner");
  const id = nanoid(24);
  const prefix = `ej-private-check/${id}`;
  const sourceKey = `${prefix}/source.mp4`,
    outputKey = `${prefix}/output.mp4`,
    posterKey = `${prefix}/poster.jpg`;
  const directory = await mkdtemp(join(tmpdir(), "ej-private-check-"));
  try {
    const bytes = await readFile("client/public/media/player-demo-fr.mp4");
    const descriptor = await preparePrivateMedia(
      sourceKey,
      bytes.length,
      "video/mp4",
      "parts"
    );
    const file = new Blob([new Uint8Array(bytes)]);
    for (let index = 0; index < privateChunkCount(descriptor); index++) {
      const part = await encryptPrivateFileChunk(file, descriptor, index);
      const url = await preparePrivatePart(sourceKey, index);
      const response = await fetch(url, {
        method: "PUT",
        headers: { "Content-Type": "application/octet-stream" },
        body: part,
      });
      if (!response.ok) throw new Error("Encrypted part upload failed");
    }
    await verifyPrivateStoredMedia(sourceKey, bytes.length, "video/mp4");
    const restored = join(directory, "restored.mp4");
    await downloadPrivateSource(sourceKey, restored, bytes.length);
    const restoredBytes = await readFile(restored);
    const equal =
      createHash("sha256").update(bytes).digest("hex") ===
      createHash("sha256").update(restoredBytes).digest("hex");
    if (!equal) throw new Error("Source reconstruction mismatch");
    const converted = await convertPhoneVideo({
      inputPath: restored,
      outputDirectory: join(directory, "converted"),
    });
    const video = await uploadPrivateLocalFile(
      outputKey,
      converted.videoPath,
      "video/mp4"
    );
    const poster = await uploadPrivateLocalFile(
      posterKey,
      converted.posterPath,
      "image/jpeg"
    );
    const meta = await getPrivateMedia(outputKey);
    const actual = await readFile(converted.videoPath);
    const ranged: Buffer[] = [];
    for await (const chunk of readPrivateMediaRange(meta, {
      start: 5,
      end: 31,
      partial: true,
    }))
      ranged.push(chunk);
    if (!Buffer.concat(ranged).equals(actual.subarray(5, 32)))
      throw new Error("Range mismatch");
    const videoId = `private-check-${nanoid(24)}`,
      posterId = `private-check-${nanoid(24)}`;
    await db.insert(contentUploads).values([
      {
        id: videoId,
        ownerUserId: owner.id,
        objectKey: outputKey,
        filename: "EJ technical encryption check.mp4",
        contentType: "video/mp4",
        size: video.size,
        kind: "video",
        status: "ready",
        readyAt: new Date(),
      },
      {
        id: posterId,
        ownerUserId: owner.id,
        objectKey: posterKey,
        filename: "EJ technical encryption check.jpg",
        contentType: "image/jpeg",
        size: poster.size,
        kind: "image",
        status: "ready",
        readyAt: new Date(),
      },
    ]);
    await writeFile(
      manifest,
      JSON.stringify({
        keys: [sourceKey, outputKey, posterKey],
        uploadIds: [videoId, posterId],
        outputKey,
        posterKey,
        first32Hex: actual.subarray(0, 32).toString("hex"),
      }),
      { mode: 0o600 }
    );
    console.log(
      JSON.stringify({
        sourceReconstructed: true,
        conversion: "H264/AAC compatible MP4",
        privateRangeExact: true,
        posterEncrypted: true,
        ownerOnlyHttpCheckPrepared: true,
      })
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
main()
  .then(() => process.exit(0))
  .catch(() => {
    console.error(
      "Private-media diagnostic failed; no tokens or encryption keys are logged."
    );
    process.exit(1);
  });
