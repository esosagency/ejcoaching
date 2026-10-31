import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  downloadStoredVideo,
  prepareStoredPut,
  uploadStoredFile,
  verifyStoredSource,
} from "./mediaStorage";

const originalFetch = globalThis.fetch;
const originalForgeUrl = process.env.MANUS_API_URL;
const originalForgeKey = process.env.MANUS_API_KEY;
const directories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "ej-media-storage-"));
  directories.push(directory);
  return directory;
}

function configureStorage(): void {
  process.env.MANUS_API_URL = "https://forge.example.test";
  process.env.MANUS_API_KEY = "test-key-not-a-real-secret";
}

function responseJson(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

afterEach(async () => {
  globalThis.fetch = originalFetch;
  if (originalForgeUrl === undefined) delete process.env.MANUS_API_URL;
  else process.env.MANUS_API_URL = originalForgeUrl;
  if (originalForgeKey === undefined) delete process.env.MANUS_API_KEY;
  else process.env.MANUS_API_KEY = originalForgeKey;
  await Promise.all(directories.splice(0).map(directory => rm(directory, { recursive: true, force: true })));
});

describe("stockage média protégé", () => {
  it("prépare un PUT sans modifier la clé contrôlée par le travailleur", async () => {
    configureStorage();
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/v1/storage/presign/put");
      expect(url.searchParams.get("path")).toBe("videos/output/worker-random.mp4");
      return responseJson({ url: "https://object.example.test/signed-put?opaque=1" });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(prepareStoredPut("videos/output/worker-random.mp4")).resolves.toBe(
      "https://object.example.test/signed-put?opaque=1",
    );
  });

  it("échoue fermement quand HEAD ne confirme pas la taille et le type source canoniques", async () => {
    configureStorage();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ url: "https://object.example.test/signed-get?opaque=1" }))
      .mockResolvedValueOnce(
        new Response(null, {
          status: 200,
          headers: {
            "content-length": "10",
            "content-type": "application/octet-stream",
          },
        }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      verifyStoredSource({
        objectKey: "videos/source/worker-random.mov",
        size: 10,
        contentType: "video/quicktime",
      }),
    ).rejects.toThrow("La taille ou le type du fichier vidéo ne correspond pas aux métadonnées annoncées.");
  });

  it("télécharge exactement le flux signé dans un fichier local sans tamponner la vidéo", async () => {
    configureStorage();
    const directory = await temporaryDirectory();
    const destination = path.join(directory, "source.mov");
    const bytes = new Uint8Array([1, 2, 3, 4, 5]);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(responseJson({ url: "https://object.example.test/signed-get?opaque=1" }))
      .mockResolvedValueOnce(
        new Response(bytes, {
          status: 200,
          headers: { "content-length": String(bytes.length) },
        }),
      );
    globalThis.fetch = fetchMock as typeof fetch;

    await downloadStoredVideo("videos/source/worker-random.mov", destination, bytes.length);

    expect(await readFile(destination)).toEqual(Buffer.from(bytes));
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ method: "GET", redirect: "error" });
  });

  it("téléverse l’artefact en flux PUT avec duplex half et conserve exactement la clé", async () => {
    configureStorage();
    const directory = await temporaryDirectory();
    const videoPath = path.join(directory, "video.mp4");
    const bytes = Buffer.from("small converted mp4 artifact");
    await writeFile(videoPath, bytes);

    const uploaded: Buffer[] = [];
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit & { duplex?: string }) => {
      const url = String(input);
      if (url.startsWith("https://forge.example.test/")) {
        return responseJson({ url: "https://object.example.test/signed-put?opaque=1" });
      }
      expect(init?.method).toBe("PUT");
      expect(init?.duplex).toBe("half");
      expect(init?.headers).toMatchObject({
        "Content-Type": "video/mp4",
        "Content-Length": String(bytes.length),
      });
      const reader = (init?.body as ReadableStream<Uint8Array>).getReader();
      for (;;) {
        const part = await reader.read();
        if (part.done) break;
        uploaded.push(Buffer.from(part.value));
      }
      return new Response(null, { status: 200 });
    });
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      uploadStoredFile("videos/output/worker-random.mp4", videoPath, "video/mp4"),
    ).resolves.toEqual({
      key: "videos/output/worker-random.mp4",
      url: "/manus-storage/videos/output/worker-random.mp4",
      size: bytes.length,
    });
    expect(Buffer.concat(uploaded)).toEqual(bytes);
  });
});
