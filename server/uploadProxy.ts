import express, { type Express, type Request, type Response } from "express";
import { authenticateApplicationRequest } from "./applicationAuth";
import { getOwnedUpload } from "./contentDb";
import { getPrivateMedia, privatePartKey } from "./privateMediaStorage";
import { prepareStoredPut } from "./video/mediaStorage";
import { getOwnedVideoJobSource, touchUploadingVideoJob } from "./video/videoDb";
import {
  PRIVATE_TAG_SIZE,
  privateChunkCount,
  privateCipherSize,
  privatePlainChunkSize,
} from "../shared/privateMedia";

/**
 * Same-origin fallback for direct-to-storage uploads. Some browsers/hosts block
 * the cross-origin PUT to the presigned URL (CORS, content blockers). The browser
 * then sends the (already encrypted, for videos and PDFs) bytes here and the
 * server forwards them. The destination is always re-derived from the database
 * for the signed-in administrator; no URL is ever accepted from the request.
 */
const MAX_PROXY_BYTES = 32 * 1024 * 1024; // one 8 MiB part, or a PDF/image (<=25 MiB + tags)

class ProxyError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message);
  }
}

async function resolveTarget(
  req: Request,
  userId: number,
  bodyLength: number
): Promise<{ objectKey: string; contentType: string }> {
  const kind = String(req.query.kind ?? "");
  const id = String(req.query.id ?? "");
  if (!id || id.length > 64) throw new ProxyError(400, "Requête invalide.");

  if (kind === "part") {
    const index = Number(req.query.index);
    if (!Number.isInteger(index) || index < 0 || index > 127)
      throw new ProxyError(400, "Partie invalide.");
    const source = await getOwnedVideoJobSource(id, userId);
    if (source.status !== "uploading")
      throw new ProxyError(409, "Ce téléversement ne peut plus recevoir de parties.");
    const media = await getPrivateMedia(source.sourceObjectKey);
    if (media.layout !== "parts" || media.status !== "pending")
      throw new ProxyError(409, "Ce téléversement ne peut plus recevoir de parties.");
    if (index >= privateChunkCount(media))
      throw new ProxyError(400, "Partie invalide.");
    if (bodyLength !== privatePlainChunkSize(media, index) + PRIVATE_TAG_SIZE)
      throw new ProxyError(400, "La taille de la partie est invalide.");
    if (!(await touchUploadingVideoJob(id, userId)))
      throw new ProxyError(409, "Le transfert a expiré ou a été annulé.");
    return {
      objectKey: privatePartKey(source.sourceObjectKey, index),
      contentType: "application/octet-stream",
    };
  }

  if (kind === "upload") {
    const upload = await getOwnedUpload(id, userId);
    if (upload.status !== "pending" || upload.kind === "video")
      throw new ProxyError(409, "Ce fichier ne peut plus être téléversé.");
    if (upload.kind === "document") {
      const media = await getPrivateMedia(upload.objectKey);
      if (media.layout !== "single" || media.status !== "pending")
        throw new ProxyError(409, "Ce fichier ne peut plus être téléversé.");
      if (bodyLength !== privateCipherSize(media))
        throw new ProxyError(400, "La taille du fichier est invalide.");
      return {
        objectKey: upload.objectKey,
        contentType: "application/octet-stream",
      };
    }
    if (bodyLength !== upload.size)
      throw new ProxyError(400, "La taille du fichier est invalide.");
    return { objectKey: upload.objectKey, contentType: upload.contentType };
  }

  throw new ProxyError(400, "Requête invalide.");
}

export function registerUploadProxyRoute(app: Express) {
  app.put(
    "/api/admin/upload-proxy",
    express.raw({ type: () => true, limit: MAX_PROXY_BYTES }),
    async (req: Request, res: Response) => {
      res.set("Cache-Control", "no-store");
      try {
        // A custom header cannot be sent cross-site without a CORS preflight,
        // which this server never grants: this blocks cross-site request forgery.
        if (req.get("x-ej-upload") !== "1")
          throw new ProxyError(403, "Requête refusée.");
        const { user, client, hasClientCookie } =
          await authenticateApplicationRequest(req);
        if (!user || user.role !== "admin" || client || hasClientCookie)
          throw new ProxyError(403, "Accès administrateur requis.");
        const body = req.body;
        if (!Buffer.isBuffer(body) || body.length === 0)
          throw new ProxyError(400, "Fichier vide.");

        const target = await resolveTarget(req, user.id, body.length);
        const url = await prepareStoredPut(target.objectKey);
        let upstream: globalThis.Response;
        try {
          upstream = await fetch(url, {
            method: "PUT",
            headers: { "Content-Type": target.contentType },
            body: new Uint8Array(body),
            redirect: "error",
            signal: AbortSignal.timeout(5 * 60_000),
          });
        } catch {
          throw new ProxyError(502, "Le stockage n’est pas joignable.");
        }
        if (!upstream.ok)
          throw new ProxyError(502, "Le stockage a refusé le téléversement.");
        res.status(204).end();
      } catch (error) {
        if (res.headersSent) return;
        if (error instanceof ProxyError) {
          res.status(error.status).json({ error: error.message });
        } else {
          res.status(500).json({ error: "Le téléversement n’a pas pu être transféré." });
        }
      }
    }
  );
}
