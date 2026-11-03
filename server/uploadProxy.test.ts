import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const auth = vi.hoisted(() => ({ value: { user: { id: 1, role: "admin" }, client: null, hasClientCookie: false } as any }));
const puts = vi.hoisted(() => [] as { url: string; length: number }[]);

vi.mock("./applicationAuth", () => ({ authenticateApplicationRequest: async () => auth.value }));
vi.mock("./contentDb", () => ({
  getOwnedUpload: async () => ({ id: "u1", objectKey: "docs/x.pdf", contentType: "application/pdf", size: 100, kind: "document", status: "pending" }),
}));
vi.mock("./privateMediaStorage", () => ({
  getPrivateMedia: async (key: string) => ({ layout: key === "src.mov" ? "parts" : "single", status: "pending", plainSize: 100, chunkSize: 8 * 1024 * 1024 }),
  privatePartKey: (k: string, i: number) => `${k}.part-${i}`,
}));
vi.mock("./video/mediaStorage", () => ({ prepareStoredPut: async (k: string) => `https://storage.test/${k}` }));
vi.mock("./video/videoDb", () => ({
  getOwnedVideoJobSource: async () => ({ status: "uploading", sourceObjectKey: "src.mov" }),
  touchUploadingVideoJob: async () => true,
}));

import { registerUploadProxyRoute } from "./uploadProxy";

let server: Server;
let base = "";
const realFetch = globalThis.fetch;

beforeAll(async () => {
  const app = express();
  registerUploadProxyRoute(app);
  server = createServer(app);
  await new Promise<void>(r => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  globalThis.fetch = (async (input: any, init?: any) => {
    const url = String(input);
    if (url.startsWith("https://storage.test/")) {
      puts.push({ url, length: init.body.length });
      return new Response(null, { status: 200 });
    }
    return realFetch(input, init);
  }) as typeof fetch;
});
afterAll(() => { globalThis.fetch = realFetch; server.close(); });
beforeEach(() => {
  puts.length = 0;
  auth.value = { user: { id: 1, role: "admin" }, client: null, hasClientCookie: false };
});

const put = (qs: string, size: number, headers: Record<string, string> = { "x-ej-upload": "1" }) =>
  realFetch(`${base}/api/admin/upload-proxy?${qs}`, { method: "PUT", headers, body: new Uint8Array(size) });

describe("upload proxy", () => {
  it("requires the custom header", async () => {
    expect((await put("kind=upload&id=u1", 116, {})).status).toBe(403);
  });
  it("rejects non-admins and client cookies", async () => {
    auth.value = { user: null, client: { id: "c" }, hasClientCookie: true };
    expect((await put("kind=upload&id=u1", 116)).status).toBe(403);
    auth.value = { user: { id: 2, role: "user" }, client: null, hasClientCookie: false };
    expect((await put("kind=upload&id=u1", 116)).status).toBe(403);
    expect(puts).toHaveLength(0);
  });
  it("forwards a correctly sized encrypted document", async () => {
    expect((await put("kind=upload&id=u1", 116)).status).toBe(204);
    expect(puts).toEqual([{ url: "https://storage.test/docs/x.pdf", length: 116 }]);
  });
  it("rejects a wrong size and unknown kinds", async () => {
    expect((await put("kind=upload&id=u1", 115)).status).toBe(400);
    expect((await put("kind=zzz&id=u1", 116)).status).toBe(400);
    expect(puts).toHaveLength(0);
  });
  it("forwards a video part with its derived key", async () => {
    expect((await put("kind=part&id=j1&index=0", 116)).status).toBe(204);
    expect(puts[0]).toEqual({ url: "https://storage.test/src.mov.part-0", length: 116 });
    expect((await put("kind=part&id=j1&index=1", 116)).status).toBe(400);
  });
});
