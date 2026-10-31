import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import {
  PRIVATE_CHUNK_SIZE,
  PRIVATE_TAG_SIZE,
  assertPrivateDescriptor,
  privateAad,
  privateNonce,
  privatePlainChunkSize,
  type PrivateMediaDescriptor,
} from "../shared/privateMedia";

export function newPrivateDescriptor(
  id: string,
  plainSize: number,
  contentType: string
): PrivateMediaDescriptor {
  const media = {
    id,
    plainSize,
    contentType,
    chunkSize: PRIVATE_CHUNK_SIZE,
    keyBase64: randomBytes(32).toString("base64"),
    nonceBase64: randomBytes(8).toString("base64"),
  };
  assertPrivateDescriptor(media);
  return media;
}
export function encryptPrivateChunk(
  plain: Buffer,
  media: PrivateMediaDescriptor,
  index: number
) {
  assertPrivateDescriptor(media);
  if (plain.length !== privatePlainChunkSize(media, index))
    throw new Error("Taille de partie invalide.");
  const cipher = createCipheriv(
    "aes-256-gcm",
    Buffer.from(media.keyBase64, "base64"),
    privateNonce(media, index)
  );
  cipher.setAAD(privateAad(media, index));
  return Buffer.concat([
    cipher.update(plain),
    cipher.final(),
    cipher.getAuthTag(),
  ]);
}
export function decryptPrivateChunk(
  encrypted: Buffer,
  media: PrivateMediaDescriptor,
  index: number
) {
  assertPrivateDescriptor(media);
  if (
    encrypted.length !==
    privatePlainChunkSize(media, index) + PRIVATE_TAG_SIZE
  )
    throw new Error("Le fichier protégé est incomplet.");
  const decipher = createDecipheriv(
    "aes-256-gcm",
    Buffer.from(media.keyBase64, "base64"),
    privateNonce(media, index)
  );
  decipher.setAAD(privateAad(media, index));
  decipher.setAuthTag(encrypted.subarray(encrypted.length - PRIVATE_TAG_SIZE));
  return Buffer.concat([
    decipher.update(encrypted.subarray(0, -PRIVATE_TAG_SIZE)),
    decipher.final(),
  ]);
}
export type PlainRange = { start: number; end: number; partial: boolean };
export function parsePrivateRange(
  header: string | undefined,
  size: number
): PlainRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null;
  if (!header) return { start: 0, end: size - 1, partial: false };
  if (header.length > 128) return null;
  const match = /^bytes=(\d*)-(\d*)$/.exec(header);
  if (!match || (!match[1] && !match[2])) return null;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return null;
    return { start: Math.max(0, size - suffix), end: size - 1, partial: true };
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 0 ||
    start >= size ||
    end < start
  )
    return null;
  return { start, end: Math.min(end, size - 1), partial: true };
}
export function privateCipherRange(
  media: PrivateMediaDescriptor,
  range: PlainRange
) {
  const first = Math.floor(range.start / media.chunkSize);
  const last = Math.floor(range.end / media.chunkSize);
  return {
    first,
    last,
    start: first * (media.chunkSize + PRIVATE_TAG_SIZE),
    end:
      last * (media.chunkSize + PRIVATE_TAG_SIZE) +
      privatePlainChunkSize(media, last) +
      PRIVATE_TAG_SIZE -
      1,
  };
}
