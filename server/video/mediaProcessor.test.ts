import { execFile as execFileCallback } from "node:child_process";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, describe, expect, it } from "vitest";

import {
  convertPhoneVideo,
  probePhoneVideo,
} from "./mediaProcessor";

const execFile = promisify(execFileCallback);
const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function ffmpeg(args: string[]): Promise<void> {
  await execFile("ffmpeg", ["-hide_banner", "-loglevel", "error", "-y", ...args], {
    timeout: 60_000,
    maxBuffer: 256 * 1024,
  });
}

async function streamMetadata(filePath: string): Promise<Record<string, string>> {
  const { stdout } = await execFile(
    "ffprobe",
    [
      "-v",
      "error",
      "-select_streams",
      "v:0",
      "-show_entries",
      "stream=color_space,color_transfer,color_primaries",
      "-of",
      "default=noprint_wrappers=1",
      filePath,
    ],
    { timeout: 30_000 },
  );
  return Object.fromEntries(
    stdout
      .trim()
      .split("\n")
      .filter(Boolean)
      .map(line => {
        const [key, ...value] = line.split("=");
        return [key, value.join("=")];
      }),
  );
}

async function expectCommonOutput(result: Awaited<ReturnType<typeof convertPhoneVideo>>) {
  const [videoInfo, poster, videoFile] = await Promise.all([
    probePhoneVideo(result.videoPath),
    readFile(result.posterPath),
    stat(result.videoPath),
  ]);
  expect(videoFile.size).toBeGreaterThan(0);
  expect(videoInfo.videoCodec).toBe("h264");
  expect(videoInfo.pixelFormat).toBe("yuv420p");
  expect(videoInfo.frameRate).toBeLessThanOrEqual(30.001);
  expect(videoInfo.rotation).toBe(0);
  expect(
    (videoInfo.width <= 1920 && videoInfo.height <= 1080) ||
      (videoInfo.width <= 1080 && videoInfo.height <= 1920),
  ).toBe(true);
  expect(poster.subarray(0, 3)).toEqual(Buffer.from([0xff, 0xd8, 0xff]));
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map(directory => rm(directory, { recursive: true, force: true })),
  );
});

// Serial execution keeps the real HEVC fixture encoder and single-threaded
// production converter from competing for CPU in CI.
describe.sequential("conversion vidéo téléphone FFmpeg", () => {
  it(
    "convertit une source silencieuse et produit une affiche JPEG",
    async () => {
      const directory = await temporaryDirectory("ej-phone-silent-");
      const inputPath = path.join(directory, "silent.mp4");
      const outputDirectory = path.join(directory, "output");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24",
        "-t",
        "1.1",
        "-an",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        inputPath,
      ]);

      const progress: number[] = [];
      const result = await convertPhoneVideo({
        inputPath,
        outputDirectory,
        onProgress: value => progress.push(value),
      });

      await expectCommonOutput(result);
      expect(result.hasAudio).toBe(false);
      expect((await probePhoneVideo(result.videoPath)).hasAudio).toBe(false);
      expect(progress[0]).toBe(0);
      expect(progress.at(-1)).toBe(99);
      expect(progress.every(value => value >= 0 && value <= 99)).toBe(true);
    },
    120_000,
  );

  it(
    "préserve la parole en AAC stéréo et réduit une source portrait 60 fps à 30 fps",
    async () => {
      const directory = await temporaryDirectory("ej-phone-audio-");
      const inputPath = path.join(directory, "audio.mp4");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=360x640:rate=60",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "1.2",
        "-c:v",
        "libx264",
        "-pix_fmt",
        "yuv420p",
        "-c:a",
        "aac",
        "-shortest",
        inputPath,
      ]);

      const result = await convertPhoneVideo({
        inputPath,
        outputDirectory: path.join(directory, "output"),
      });
      const output = await probePhoneVideo(result.videoPath);

      await expectCommonOutput(result);
      expect(result.hasAudio).toBe(true);
      expect(output.hasAudio).toBe(true);
      expect(output.audioCodec).toBe("aac");
      expect(output.audioChannels).toBe(2);
      expect(output.width).toBeLessThanOrEqual(1080);
      expect(output.height).toBeLessThanOrEqual(1920);
    },
    120_000,
  );

  it(
    "applique une matrice d’affichage portrait HEVC Main 10 sans conserver sa rotation",
    async () => {
      const directory = await temporaryDirectory("ej-phone-rotated-hevc-");
      const basePath = path.join(directory, "base.mov");
      const inputPath = path.join(directory, "rotated.mov");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24",
        "-f",
        "lavfi",
        "-i",
        "sine=frequency=440:sample_rate=48000",
        "-t",
        "1.2",
        "-c:v",
        "libx265",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=error",
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
        "-c:a",
        "aac",
        "-shortest",
        basePath,
      ]);
      // -display_rotation is an input option in FFmpeg 6; remuxing writes the
      // resulting QuickTime display matrix that iPhone portrait MOVs use.
      await ffmpeg([
        "-display_rotation:v:0",
        "90",
        "-i",
        basePath,
        "-c",
        "copy",
        inputPath,
      ]);

      const source = await probePhoneVideo(inputPath);
      expect(source.videoCodec).toBe("hevc");
      expect(source.pixelFormat).toBe("yuv420p10le");
      expect(source.rotation).toBe(90);
      expect(source.width).toBe(360);
      expect(source.height).toBe(640);

      const result = await convertPhoneVideo({
        inputPath,
        outputDirectory: path.join(directory, "output"),
      });
      const output = await probePhoneVideo(result.videoPath);

      await expectCommonOutput(result);
      expect(output.width).toBe(360);
      expect(output.height).toBe(640);
      expect(output.rotation).toBe(0);
      expect(output.hasAudio).toBe(true);
    },
    120_000,
  );

  it(
    "tonemap une source HEVC Main 10 HLG déclarée vers des tags BT.709 SDR",
    async () => {
      const directory = await temporaryDirectory("ej-phone-hdr-");
      const inputPath = path.join(directory, "hdr.mov");
      await ffmpeg([
        "-f",
        "lavfi",
        "-i",
        "testsrc2=size=640x360:rate=24",
        "-t",
        "1.2",
        "-vf",
        "format=yuv420p10le",
        "-c:v",
        "libx265",
        "-x265-params",
        "pools=1:frame-threads=1:log-level=error",
        "-pix_fmt",
        "yuv420p10le",
        "-tag:v",
        "hvc1",
        "-color_primaries",
        "bt2020",
        "-color_trc",
        "arib-std-b67",
        "-colorspace",
        "bt2020nc",
        inputPath,
      ]);

      const source = await probePhoneVideo(inputPath);
      expect(source.videoCodec).toBe("hevc");
      expect(source.pixelFormat).toBe("yuv420p10le");
      expect(source.isHdr).toBe(true);

      const result = await convertPhoneVideo({
        inputPath,
        outputDirectory: path.join(directory, "output"),
      });

      await expectCommonOutput(result);
      expect((await probePhoneVideo(result.videoPath)).isHdr).toBe(false);
      expect(await streamMetadata(result.videoPath)).toEqual({
        color_space: "bt709",
        color_transfer: "bt709",
        color_primaries: "bt709",
      });
    },
    120_000,
  );

  it("rejette un faux MOV corrompu et supprime les sorties partielles", async () => {
    const directory = await temporaryDirectory("ej-phone-corrupt-");
    const inputPath = path.join(directory, "corrupt.mov");
    await writeFile(inputPath, "ceci n’est pas un fichier vidéo");

    await expect(
      convertPhoneVideo({
        inputPath,
        outputDirectory: path.join(directory, "output"),
      }),
    ).rejects.toThrow("Cette vidéo est corrompue ou n’est pas prise en charge.");

    await expect(stat(path.join(directory, "output", "video.mp4"))).rejects.toThrow();
    await expect(stat(path.join(directory, "output", "poster.jpg"))).rejects.toThrow();
  });
});
