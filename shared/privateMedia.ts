export const PRIVATE_CHUNK_SIZE = 8 * 1024 * 1024;
export const PRIVATE_TAG_SIZE = 16;
export const PRIVATE_MAX_BYTES = 1024 * 1024 * 1024;

/** Returned only to an authorized uploader, never in a course or membership DTO. */
export type PrivateMediaDescriptor = {
  id: string;
  keyBase64: string;
  nonceBase64: string;
  plainSize: number;
  chunkSize: number;
  contentType: string;
};

export function privateChunkCount(
  media: Pick<PrivateMediaDescriptor, "plainSize" | "chunkSize">
) {
  return Math.ceil(media.plainSize / media.chunkSize);
}
export function privatePlainChunkSize(
  media: Pick<PrivateMediaDescriptor, "plainSize" | "chunkSize">,
  index: number
) {
  if (
    !Number.isInteger(index) ||
    index < 0 ||
    index >= privateChunkCount(media)
  )
    throw new Error("Partie vidéo invalide.");
  return Math.min(media.chunkSize, media.plainSize - index * media.chunkSize);
}
export function privateCipherSize(
  media: Pick<PrivateMediaDescriptor, "plainSize" | "chunkSize">
) {
  return media.plainSize + PRIVATE_TAG_SIZE * privateChunkCount(media);
}
export function privateAad(media: PrivateMediaDescriptor, index: number) {
  return new TextEncoder().encode(
    JSON.stringify([media.id, index, media.plainSize, media.contentType])
  );
}
export function decodePrivateBase64(value: string) {
  const raw = atob(value);
  return Uint8Array.from(raw, character => character.charCodeAt(0));
}
export function privateNonce(media: PrivateMediaDescriptor, index: number) {
  const prefix = decodePrivateBase64(media.nonceBase64);
  if (
    prefix.length !== 8 ||
    index < 0 ||
    index > 0xffffffff ||
    !Number.isInteger(index)
  )
    throw new Error("Paramètres de protection invalides.");
  const nonce = new Uint8Array(12);
  nonce.set(prefix);
  new DataView(nonce.buffer).setUint32(8, index, false);
  return nonce;
}
export function assertPrivateDescriptor(media: PrivateMediaDescriptor) {
  if (
    !/^[A-Za-z0-9_-]{8,64}$/.test(media.id) ||
    decodePrivateBase64(media.keyBase64).length !== 32 ||
    decodePrivateBase64(media.nonceBase64).length !== 8 ||
    media.chunkSize !== PRIVATE_CHUNK_SIZE ||
    !Number.isSafeInteger(media.plainSize) ||
    media.plainSize <= 0 ||
    media.plainSize > PRIVATE_MAX_BYTES ||
    !/^[a-z0-9/+.-]+$/.test(media.contentType)
  )
    throw new Error("Paramètres de protection invalides.");
}
export async function encryptPrivateFileChunk(
  file: Blob,
  media: PrivateMediaDescriptor,
  index: number
): Promise<Blob> {
  assertPrivateDescriptor(media);
  if (file.size !== media.plainSize)
    throw new Error("La taille du fichier a changé.");
  const size = privatePlainChunkSize(media, index);
  const plain = await file
    .slice(index * media.chunkSize, index * media.chunkSize + size)
    .arrayBuffer();
  const key = await crypto.subtle.importKey(
    "raw",
    decodePrivateBase64(media.keyBase64),
    "AES-GCM",
    false,
    ["encrypt"]
  );
  const encrypted = await crypto.subtle.encrypt(
    {
      name: "AES-GCM",
      iv: privateNonce(media, index),
      additionalData: privateAad(media, index),
      tagLength: 128,
    },
    key,
    plain
  );
  return new Blob([encrypted], { type: "application/octet-stream" });
}
/** Small PDFs only. Large phone sources upload one encrypted chunk at a time. */
export async function encryptPrivateDocument(
  file: Blob,
  media: PrivateMediaDescriptor
): Promise<Blob> {
  if (file.size > 25 * 1024 * 1024)
    throw new Error("Le document dépasse la taille autorisée.");
  const parts: Blob[] = [];
  for (let index = 0; index < privateChunkCount(media); index++)
    parts.push(await encryptPrivateFileChunk(file, media, index));
  return new Blob(parts, { type: "application/octet-stream" });
}
export function courseMediaUrl(
  courseId: string,
  lessonId: string,
  kind: "video" | "poster" | "resource",
  resourceId?: string
) {
  const base = `/api/course-media/${encodeURIComponent(courseId)}/${encodeURIComponent(lessonId)}/${kind}`;
  return resourceId ? `${base}/${encodeURIComponent(resourceId)}` : base;
}
