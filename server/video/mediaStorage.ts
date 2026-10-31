import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, rm, stat } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as NodeReadableStream } from "node:stream/web";

import { ENV } from "../_core/env";

/** The source and generated-video hard limit approved for the phone workflow. */
export const MAX_PHONE_VIDEO_BYTES = 1024 * 1024 * 1024;

const PRESIGN_TIMEOUT_MS = 30_000;
const TRANSFER_TIMEOUT_MS = 30 * 60_000;
const SOURCE_CONTENT_TYPES = new Set([
  "video/quicktime",
  "video/mp4",
  "video/webm",
  "video/3gpp",
  "video/3gpp2",
]);
const OUTPUT_CONTENT_TYPES = new Set(["video/mp4", "image/jpeg"]);

/**
 * Error messages from this module are deliberately safe for display in the
 * French UI. Do not append storage responses, paths, signed URLs, or secrets.
 */
export class MediaStorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaStorageError";
  }
}

function fail(message: string): never {
  throw new MediaStorageError(message);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function ensureNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) {
    fail("Le transfert vidéo a été annulé.");
  }
}

function assertObjectKey(objectKey: string): string {
  if (
    typeof objectKey !== "string" ||
    objectKey.length === 0 ||
    objectKey.length > 1024 ||
    objectKey.includes("\\") ||
    objectKey.includes("\0") ||
    !/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(objectKey)
  ) {
    fail("La référence du fichier vidéo est invalide.");
  }

  const parts = objectKey.split("/");
  if (parts.some(part => part.length === 0 || part === "." || part === "..")) {
    fail("La référence du fichier vidéo est invalide.");
  }
  return objectKey;
}

function assertSize(size: number, message: string): void {
  if (
    !Number.isSafeInteger(size) ||
    size <= 0 ||
    size > MAX_PHONE_VIDEO_BYTES
  ) {
    fail(message);
  }
}

function canonicalContentType(contentType: string | null): string | null {
  if (!contentType) return null;
  const value = contentType.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return value || null;
}

function getForgeConfig(): { forgeUrl: string; forgeKey: string } {
  const forgeUrl = ENV.forgeApiUrl.replace(/\/+$/, "");
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    fail("Le service de stockage vidéo n’est pas configuré.");
  }

  let parsed: URL;
  try {
    parsed = new URL(forgeUrl);
  } catch {
    fail("Le service de stockage vidéo n’est pas configuré.");
  }
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    fail("Le service de stockage vidéo n’est pas configuré.");
  }

  return { forgeUrl, forgeKey };
}

function assertPresignedUrl(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 16_384) {
    fail("Le service de stockage a retourné une réponse invalide.");
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    fail("Le service de stockage a retourné une réponse invalide.");
  }
  // Signed object URLs are never logged or exposed from this module.
  if (
    (parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
    parsed.username ||
    parsed.password
  ) {
    fail("Le service de stockage a retourné une réponse invalide.");
  }
  return parsed.toString();
}

function requestSignal(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  dispose: () => void;
} {
  const controller = new AbortController();
  const onAbort = () => controller.abort();
  if (signal) {
    if (signal.aborted) controller.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  timer.unref?.();

  return {
    signal: controller.signal,
    dispose: () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
    },
  };
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  signal: AbortSignal | undefined,
  timeoutMs: number,
  abortedMessage: string,
): Promise<Response> {
  ensureNotAborted(signal);
  const scoped = requestSignal(signal, timeoutMs);
  try {
    return await fetch(input, { ...init, signal: scoped.signal });
  } catch (error) {
    if (signal?.aborted || isAbort(error)) fail(abortedMessage);
    throw error;
  } finally {
    scoped.dispose();
  }
}

async function requestPresignedUrl(
  operation: "put" | "get",
  objectKey: string,
  signal?: AbortSignal,
): Promise<string> {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const endpoint = new URL(`v1/storage/presign/${operation}`, `${forgeUrl}/`);
  endpoint.searchParams.set("path", objectKey);

  let response: Response;
  try {
    response = await fetchWithTimeout(
      endpoint,
      {
        headers: { Authorization: `Bearer ${forgeKey}` },
        redirect: "error",
      },
      signal,
      PRESIGN_TIMEOUT_MS,
      "Le transfert vidéo a été annulé.",
    );
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    fail("Impossible de préparer le transfert vidéo pour le moment.");
  }
  if (!response.ok) {
    fail("Impossible de préparer le transfert vidéo pour le moment.");
  }

  let body: { url?: unknown } | null = null;
  try {
    body = (await response.json()) as { url?: unknown };
  } catch {
    fail("Le service de stockage a retourné une réponse invalide.");
  }
  return assertPresignedUrl(body?.url);
}

async function assertRegularLocalFile(filePath: string, fileMessage: string): Promise<{
  size: number;
}> {
  if (!path.isAbsolute(filePath) || filePath.includes("\0")) fail(fileMessage);
  let details;
  try {
    details = await lstat(filePath);
  } catch {
    fail(fileMessage);
  }
  if (!details.isFile() || details.isSymbolicLink()) fail(fileMessage);
  assertSize(details.size, fileMessage);
  return { size: details.size };
}

async function assertLocalDestination(destinationPath: string): Promise<void> {
  if (!path.isAbsolute(destinationPath) || destinationPath.includes("\0")) {
    fail("Le fichier temporaire vidéo est invalide.");
  }
  const directory = path.dirname(destinationPath);
  try {
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const info = await stat(directory);
    if (!info.isDirectory()) throw new Error("not a directory");
  } catch {
    fail("Impossible de préparer le fichier temporaire vidéo.");
  }
}

function storageProxyUrl(key: string): string {
  return `/manus-storage/${key}`;
}

/**
 * Obtains the direct PUT URL used by the protected `video.prepare` operation.
 * The caller is responsible for returning it only to an authorized uploader.
 */
export async function prepareStoredPut(objectKey: string): Promise<string> {
  return requestPresignedUrl("put", assertObjectKey(objectKey));
}

/**
 * Streams an object from protected storage into a local temporary file. The
 * expected byte count is enforced both from the response header and while
 * copying, so an unavailable or mismatched object fails closed.
 */
export async function downloadStoredVideo(
  objectKey: string,
  destinationPath: string,
  expectedSize: number,
  signal?: AbortSignal,
): Promise<void> {
  const key = assertObjectKey(objectKey);
  assertSize(expectedSize, "La taille du fichier vidéo est invalide.");
  await assertLocalDestination(destinationPath);
  ensureNotAborted(signal);

  let completed = false;
  try {
    const signedUrl = await requestPresignedUrl("get", key, signal);
    let response: Response;
    try {
      response = await fetchWithTimeout(
        signedUrl,
        { method: "GET", redirect: "error" },
        signal,
        TRANSFER_TIMEOUT_MS,
        "Le téléchargement vidéo a été annulé.",
      );
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      fail("Impossible de télécharger le fichier vidéo.");
    }
    if (!response.ok || !response.body) {
      fail("Le fichier vidéo est introuvable ou ne peut pas être téléchargé.");
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (!Number.isSafeInteger(contentLength) || contentLength !== expectedSize) {
      fail("La taille du fichier vidéo ne correspond pas à celle annoncée.");
    }

    let received = 0;
    const limiter = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        received += chunk.length;
        if (received > expectedSize || received > MAX_PHONE_VIDEO_BYTES) {
          callback(new MediaStorageError("La taille du fichier vidéo est invalide."));
          return;
        }
        callback(null, chunk);
      },
    });

    const transfer = requestSignal(signal, TRANSFER_TIMEOUT_MS);
    try {
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream),
        limiter,
        createWriteStream(destinationPath, { flags: "w", mode: 0o600 }),
        { signal: transfer.signal },
      );
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      if (signal?.aborted || isAbort(error)) {
        fail("Le téléchargement vidéo a été annulé.");
      }
      fail("Impossible de télécharger le fichier vidéo.");
    } finally {
      transfer.dispose();
    }

    if (received !== expectedSize) {
      fail("La taille du fichier vidéo ne correspond pas à celle annoncée.");
    }
    completed = true;
  } finally {
    if (!completed) {
      await rm(destinationPath, { force: true }).catch(() => undefined);
    }
  }
}

/**
 * Streams a generated local artifact to storage without changing the object
 * key selected by the worker. The public proxy path never contains a signed
 * URL.
 */
export async function uploadStoredFile(
  objectKey: string,
  filePath: string,
  contentType: string,
  signal?: AbortSignal,
): Promise<{ key: string; url: string; size: number }> {
  const key = assertObjectKey(objectKey);
  const type = canonicalContentType(contentType);
  if (!type || !OUTPUT_CONTENT_TYPES.has(type)) {
    fail("Le type du fichier converti est invalide.");
  }
  const file = await assertRegularLocalFile(
    filePath,
    "Le fichier converti est introuvable ou invalide.",
  );
  ensureNotAborted(signal);

  const signedUrl = await requestPresignedUrl("put", key, signal);
  const readStream = createReadStream(filePath, { highWaterMark: 256 * 1024 });
  try {
    let response: Response;
    try {
      response = await fetchWithTimeout(
        signedUrl,
        {
          method: "PUT",
          headers: {
            "Content-Type": type,
            "Content-Length": String(file.size),
          },
          body: Readable.toWeb(readStream) as unknown as BodyInit,
          // Node fetch requires this for a streaming request body.
          duplex: "half",
          redirect: "error",
        } as RequestInit & { duplex: "half" },
        signal,
        TRANSFER_TIMEOUT_MS,
        "Le téléversement vidéo a été annulé.",
      );
    } catch (error) {
      if (error instanceof MediaStorageError) throw error;
      fail("Impossible de téléverser le fichier converti.");
    }
    if (!response.ok) {
      fail("Impossible de téléverser le fichier converti.");
    }
  } finally {
    readStream.destroy();
  }

  return { key, url: storageProxyUrl(key), size: file.size };
}

/**
 * HEAD-verifies source metadata before the durable worker downloads it. A
 * canonical source media type and exact byte count are required; object-store
 * defaults such as application/octet-stream deliberately fail closed.
 */
export async function verifyStoredSource(input: {
  objectKey: string;
  size: number;
  contentType: string;
}): Promise<void> {
  const key = assertObjectKey(input.objectKey);
  assertSize(input.size, "La taille du fichier vidéo est invalide.");
  const expectedType = canonicalContentType(input.contentType);
  if (!expectedType || !SOURCE_CONTENT_TYPES.has(expectedType)) {
    fail("Le type du fichier vidéo est invalide.");
  }

  const signedUrl = await requestPresignedUrl("get", key);
  let response: Response;
  try {
    response = await fetchWithTimeout(
      signedUrl,
      { method: "HEAD", redirect: "error" },
      undefined,
      PRESIGN_TIMEOUT_MS,
      "La vérification du fichier vidéo a été annulée.",
    );
  } catch (error) {
    if (error instanceof MediaStorageError) throw error;
    fail("Impossible de vérifier le fichier vidéo téléversé.");
  }

  const actualSize = Number(response.headers.get("content-length"));
  const actualType = canonicalContentType(response.headers.get("content-type"));
  if (
    !response.ok ||
    !Number.isSafeInteger(actualSize) ||
    actualSize !== input.size ||
    actualSize > MAX_PHONE_VIDEO_BYTES ||
    actualType !== expectedType
  ) {
    fail("La taille ou le type du fichier vidéo ne correspond pas aux métadonnées annoncées.");
  }
}
