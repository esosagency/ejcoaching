import { describe, expect, it, vi, afterEach } from "vitest";
import {
  PRIVATE_CHUNK_SIZE,
  PRIVATE_TAG_SIZE,
  encryptPrivateFileChunk,
  privateCipherSize,
} from "../shared/privateMedia";
import {
  decryptPrivateChunk,
  encryptPrivateChunk,
  newPrivateDescriptor,
  parsePrivateRange,
  privateCipherRange,
} from "./privateMediaCrypto";
import {
  accountStorageKey,
  readAccountStorage,
} from "../client/src/lib/accountStorage";

describe("private media authenticated format", () => {
  it("decrypts browser AES-GCM chunks on the server without plaintext storage", async () => {
    const plain = Buffer.alloc(PRIVATE_CHUNK_SIZE + 23, 19);
    const media = newPrivateDescriptor(
      "test-file-interop",
      plain.length,
      "video/quicktime"
    );
    const file = new Blob([new Uint8Array(plain)]);
    const first = Buffer.from(
      await (await encryptPrivateFileChunk(file, media, 0)).arrayBuffer()
    );
    const last = Buffer.from(
      await (await encryptPrivateFileChunk(file, media, 1)).arrayBuffer()
    );
    expect(
      Buffer.concat([
        decryptPrivateChunk(first, media, 0),
        decryptPrivateChunk(last, media, 1),
      ]).equals(plain)
    ).toBe(true);
    expect(first.subarray(0, 32).equals(plain.subarray(0, 32))).toBe(false);
    expect(first.length + last.length).toBe(privateCipherSize(media));
  });
  it("rejects modified ciphertext, altered metadata and invalid tags", () => {
    const plain = Buffer.from("synthetic private lesson bytes");
    const media = newPrivateDescriptor(
      "test-file-tamper",
      plain.length,
      "video/mp4"
    );
    const encrypted = encryptPrivateChunk(plain, media, 0);
    const corrupted = Buffer.from(encrypted);
    corrupted[0] ^= 1;
    expect(() => decryptPrivateChunk(corrupted, media, 0)).toThrow();
    expect(() =>
      decryptPrivateChunk(encrypted, { ...media, contentType: "image/jpeg" }, 0)
    ).toThrow();
    expect(() =>
      decryptPrivateChunk(encrypted.subarray(0, -1), media, 0)
    ).toThrow();
  });
  it("supports whole, bounded, suffix and open-ended browser range requests", () => {
    expect(parsePrivateRange(undefined, 100)).toEqual({
      start: 0,
      end: 99,
      partial: false,
    });
    expect(parsePrivateRange("bytes=0-1", 100)).toEqual({
      start: 0,
      end: 1,
      partial: true,
    });
    expect(parsePrivateRange("bytes=20-", 100)).toEqual({
      start: 20,
      end: 99,
      partial: true,
    });
    expect(parsePrivateRange("bytes=-5", 100)).toEqual({
      start: 95,
      end: 99,
      partial: true,
    });
    expect(parsePrivateRange("bytes=100-101", 100)).toBeNull();
    expect(parsePrivateRange("bytes=0-1,4-8", 100)).toBeNull();
    expect(parsePrivateRange("bytes=-0", 100)).toBeNull();
  });
  it("maps a late plaintext range to the authenticated ciphertext chunk", () => {
    const media = newPrivateDescriptor(
      "test-file-range",
      PRIVATE_CHUNK_SIZE + 23,
      "video/mp4"
    );
    const range = privateCipherRange(media, {
      start: PRIVATE_CHUNK_SIZE + 3,
      end: PRIVATE_CHUNK_SIZE + 5,
      partial: true,
    });
    expect(range.first).toBe(1);
    expect(range.last).toBe(1);
    expect(range.start).toBe(PRIVATE_CHUNK_SIZE + PRIVATE_TAG_SIZE);
    expect(range.end).toBe(
      PRIVATE_CHUNK_SIZE + PRIVATE_TAG_SIZE + 23 + PRIVATE_TAG_SIZE - 1
    );
  });
});
describe("account browser storage", () => {
  afterEach(() => vi.unstubAllGlobals());
  it("never imports the owner demo notes for another client account", () => {
    const data = new Map<string, string>([
      ["ej-demo-notes-lesson", "Owner example notes"],
    ]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => data.set(key, value),
    });
    const owner = accountStorageKey(1, "notes-lesson");
    const client = accountStorageKey(2, "notes-lesson");
    expect(owner).not.toBe(client);
    expect(
      readAccountStorage(client, "ej-demo-notes-lesson", false)
    ).toBeNull();
    expect(readAccountStorage(owner, "ej-demo-notes-lesson", true)).toBe(
      "Owner example notes"
    );
    expect(
      readAccountStorage(client, "ej-demo-notes-lesson", false)
    ).toBeNull();
  });
});
