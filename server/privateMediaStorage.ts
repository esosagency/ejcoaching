import { createReadStream, createWriteStream } from "node:fs";
import { lstat, rm } from "node:fs/promises";
import { once } from "node:events";
import { Readable } from "node:stream";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";
import { and, eq } from "drizzle-orm";
import { nanoid } from "nanoid";
import { privateMedia } from "../drizzle/schema";
import { getDb } from "./db";
import { storageGetSignedUrl } from "./storage";
import { prepareStoredPut } from "./video/mediaStorage";
import {
  decryptPrivateChunk,
  encryptPrivateChunk,
  newPrivateDescriptor,
  privateCipherRange,
  type PlainRange,
} from "./privateMediaCrypto";
import {
  PRIVATE_MAX_BYTES,
  PRIVATE_TAG_SIZE,
  assertPrivateDescriptor,
  privateChunkCount,
  privateCipherSize,
  privatePlainChunkSize,
  type PrivateMediaDescriptor,
} from "../shared/privateMedia";

export class PrivateMediaError extends Error {
  constructor(
    message = "Le fichier protégé n’est pas disponible pour le moment."
  ) {
    super(message);
    this.name = "PrivateMediaError";
  }
}
async function database() {
  const db = await getDb();
  if (!db) throw new PrivateMediaError();
  return db;
}
export async function getPrivateMedia(objectKey: string) {
  const db = await database();
  const [media] = await db
    .select()
    .from(privateMedia)
    .where(eq(privateMedia.objectKey, objectKey))
    .limit(1);
  if (!media) throw new PrivateMediaError();
  assertPrivateDescriptor(media);
  return media;
}
export async function preparePrivateMedia(
  objectKey: string,
  plainSize: number,
  contentType: string,
  layout: "single" | "parts"
): Promise<PrivateMediaDescriptor> {
  if (
    !/^[A-Za-z0-9][A-Za-z0-9._/-]{1,511}$/.test(objectKey) ||
    objectKey.split("/").some(part => part === ".." || part === "." || !part)
  )
    throw new PrivateMediaError();
  const media = newPrivateDescriptor(nanoid(32), plainSize, contentType);
  await (await database())
    .insert(privateMedia)
    .values({
      ...media,
      objectKey,
      layout,
      status: "pending",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
  return media;
}
export function privatePartKey(objectKey: string, index: number) {
  return `${objectKey}.part-${String(index).padStart(4, "0")}`;
}
export async function preparePrivatePart(objectKey: string, index: number) {
  const media = await getPrivateMedia(objectKey);
  if (media.layout !== "parts" || media.status !== "pending")
    throw new PrivateMediaError(
      "Ce téléversement ne peut plus recevoir de parties."
    );
  privatePlainChunkSize(media, index);
  return prepareStoredPut(privatePartKey(objectKey, index));
}
async function getObject(
  key: string,
  init: RequestInit = {},
  signal?: AbortSignal
) {
  const signed = await storageGetSignedUrl(key);
  const timeout = AbortSignal.timeout(30 * 60_000);
  const scoped = signal ? AbortSignal.any([signal, timeout]) : timeout;
  try {
    return await fetch(signed, {
      ...init,
      redirect: "error",
      signal: scoped,
      headers: { "Accept-Encoding": "identity", ...(init.headers ?? {}) },
    });
  } catch {
    throw new PrivateMediaError();
  }
}
function checkObject(response: Response, size: number) {
  if (
    !response.ok ||
    Number(response.headers.get("content-length")) !== size ||
    response.headers.get("content-type")?.split(";")[0].trim() !==
      "application/octet-stream"
  )
    throw new PrivateMediaError(
      "Le fichier chiffré est incomplet ou invalide."
    );
}
export async function verifyPrivateStoredMedia(
  objectKey: string,
  size: number,
  contentType: string
) {
  const media = await getPrivateMedia(objectKey);
  if (media.plainSize !== size || media.contentType !== contentType)
    throw new PrivateMediaError();
  if (media.layout === "single")
    checkObject(
      await getObject(objectKey, { method: "HEAD" }),
      privateCipherSize(media)
    );
  else {
    // Bounded parallel verification; metadata alone never makes an upload ready.
    for (let start = 0; start < privateChunkCount(media); start += 4) {
      await Promise.all(
        Array.from(
          { length: Math.min(4, privateChunkCount(media) - start) },
          async (_, offset) => {
            const index = start + offset;
            checkObject(
              await getObject(privatePartKey(objectKey, index), {
                method: "HEAD",
              }),
              privatePlainChunkSize(media, index) + PRIVATE_TAG_SIZE
            );
          }
        )
      );
    }
  }
  await (
    await database()
  )
    .update(privateMedia)
    .set({ status: "ready", updatedAt: new Date() })
    .where(
      and(eq(privateMedia.objectKey, objectKey), eq(privateMedia.id, media.id))
    );
}
class ByteReader {
  private pending = Buffer.alloc(0);
  private iterator: AsyncIterator<unknown>;
  constructor(private source: Readable) {
    this.iterator = source[Symbol.asyncIterator]();
  }
  async exact(size: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (!this.pending.length) {
        const next = await this.iterator.next();
        if (next.done) throw new PrivateMediaError();
        this.pending = Buffer.from(next.value as Uint8Array);
      }
      const take = Math.min(remaining, this.pending.length);
      parts.push(this.pending.subarray(0, take));
      this.pending = this.pending.subarray(take);
      remaining -= take;
    }
    return Buffer.concat(parts, size);
  }
  async discard(size: number) {
    while (size > 0) {
      const take = Math.min(size, 1024 * 1024);
      await this.exact(take);
      size -= take;
    }
  }
  close() {
    this.source.destroy();
  }
}
function responseReader(response: Response) {
  if (!response.body) throw new PrivateMediaError();
  return new ByteReader(
    Readable.fromWeb(response.body as unknown as NodeReadableStream)
  );
}
export async function* readPrivateMediaRange(
  media: Awaited<ReturnType<typeof getPrivateMedia>>,
  range: PlainRange,
  signal?: AbortSignal
): AsyncGenerator<Buffer> {
  if (media.status !== "ready" || media.layout !== "single")
    throw new PrivateMediaError();
  const cipher = privateCipherRange(media, range);
  const response = await getObject(
    media.objectKey,
    { headers: { Range: `bytes=${cipher.start}-${cipher.end}` } },
    signal
  );
  if (response.status === 206) {
    checkObject(response, cipher.end - cipher.start + 1);
    if (
      response.headers.get("content-range") !==
      `bytes ${cipher.start}-${cipher.end}/${privateCipherSize(media)}`
    )
      throw new PrivateMediaError();
  } else if (response.status === 200)
    checkObject(response, privateCipherSize(media));
  else throw new PrivateMediaError();
  const reader = responseReader(response);
  try {
    if (response.status === 200 && cipher.start)
      await reader.discard(cipher.start);
    for (let index = cipher.first; index <= cipher.last; index++) {
      const encrypted = await reader.exact(
        privatePlainChunkSize(media, index) + PRIVATE_TAG_SIZE
      );
      let plain: Buffer;
      try {
        plain = decryptPrivateChunk(encrypted, media, index);
      } catch {
        throw new PrivateMediaError();
      }
      const start = Math.max(0, range.start - index * media.chunkSize);
      const end = Math.min(
        plain.length,
        range.end - index * media.chunkSize + 1
      );
      yield plain.subarray(start, end);
    }
  } finally {
    reader.close();
  }
}
export async function downloadPrivateSource(
  objectKey: string,
  destination: string,
  expectedSize: number,
  signal?: AbortSignal
) {
  const media = await getPrivateMedia(objectKey);
  if (
    media.status !== "ready" ||
    media.layout !== "parts" ||
    media.plainSize !== expectedSize
  )
    throw new PrivateMediaError();
  const output = createWriteStream(destination, { mode: 0o600 });
  let outputError: Error | undefined;
  output.on("error", error => {
    outputError = error;
  });
  let completed = false;
  try {
    for (let index = 0; index < privateChunkCount(media); index++) {
      if (signal?.aborted)
        throw new PrivateMediaError("Le transfert a été annulé.");
      const length = privatePlainChunkSize(media, index) + PRIVATE_TAG_SIZE;
      const response = await getObject(
        privatePartKey(objectKey, index),
        {},
        signal
      );
      checkObject(response, length);
      const reader = responseReader(response);
      let bytes: Buffer;
      try {
        bytes = await reader.exact(length);
      } finally {
        reader.close();
      }
      let plain: Buffer;
      try {
        plain = decryptPrivateChunk(bytes, media, index);
      } catch {
        throw new PrivateMediaError("Le fichier source protégé est invalide.");
      }
      if (outputError) throw new PrivateMediaError();
      if (!output.write(plain)) await once(output, "drain");
    }
    if (outputError) throw new PrivateMediaError();
    output.end();
    await once(output, "finish");
    completed = true;
  } finally {
    output.destroy();
    if (!completed)
      await rm(destination, { force: true }).catch(() => undefined);
  }
}
export async function uploadPrivateLocalFile(
  objectKey: string,
  filePath: string,
  contentType: string,
  signal?: AbortSignal
) {
  const file = await lstat(filePath);
  if (
    !file.isFile() ||
    file.isSymbolicLink() ||
    file.size <= 0 ||
    file.size > PRIVATE_MAX_BYTES
  )
    throw new PrivateMediaError();
  const media = await preparePrivateMedia(
    objectKey,
    file.size,
    contentType,
    "single"
  );
  const source = new ByteReader(
    createReadStream(filePath, { highWaterMark: 256 * 1024 })
  );
  const encrypted = async function* () {
    try {
      for (let index = 0; index < privateChunkCount(media); index++) {
        if (signal?.aborted) throw new PrivateMediaError();
        yield encryptPrivateChunk(
          await source.exact(privatePlainChunkSize(media, index)),
          media,
          index
        );
      }
    } finally {
      source.close();
    }
  };
  const body = Readable.from(encrypted());
  try {
    const signed = await prepareStoredPut(objectKey);
    const timeout = AbortSignal.timeout(30 * 60_000);
    const response = await fetch(signed, {
      method: "PUT",
      redirect: "error",
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(privateCipherSize(media)),
      },
      body: Readable.toWeb(body) as unknown as BodyInit,
      duplex: "half",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    } as RequestInit & { duplex: "half" });
    if (!response.ok) throw new PrivateMediaError();
    await verifyPrivateStoredMedia(objectKey, file.size, contentType);
    return {
      key: objectKey,
      url: `/manus-storage/${objectKey}`,
      size: file.size,
    };
  } catch {
    throw new PrivateMediaError("Le fichier converti n’a pas pu être protégé.");
  } finally {
    body.destroy();
    source.close();
  }
}
