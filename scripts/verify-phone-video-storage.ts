import "dotenv/config";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, mkdir, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import { storageGetSignedUrl } from "../server/storage";
import { convertPhoneVideo, probePhoneVideo } from "../server/video/mediaProcessor";
import {
  downloadStoredVideo,
  prepareStoredPut,
  uploadStoredFile,
  verifyStoredSource,
} from "../server/video/mediaStorage";

// Operator diagnostic: real codec/storage round-trip, no MySQL mutations.
// The three tiny synthetic diagnostic objects remain in object storage because
// the runtime storage API does not offer deletion. No course references them.
function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timeout = setTimeout(() => {
      child.kill("SIGKILL");
      reject(new Error("Diagnostic process exceeded its time limit."));
    }, 60_000);
    child.stdout.on("data", data => { stdout = (stdout + data).slice(-1_000_000); });
    child.stderr.on("data", data => { stderr = (stderr + data).slice(-4000); });
    child.on("error", error => { clearTimeout(timeout); reject(error); });
    child.on("close", code => {
      clearTimeout(timeout);
      if (code === 0) resolve(stdout);
      else reject(new Error(`Diagnostic process failed (${code}): ${stderr}`));
    });
  });
}

async function main() {
  const directory = await mkdtemp(join(tmpdir(), "ej-video-storage-check-"));
  const source = join(directory, "encoded.mov");
  const rotated = join(directory, "phone-source.mov");
  const downloaded = join(directory, "downloaded-source.mov");
  const outputDirectory = join(directory, "converted");
  const roundTrip = join(directory, "roundtrip.mp4");
  const objectPrefix = `diagnostics/phone-video/${randomUUID()}`;
  try {
    await mkdir(outputDirectory);
    console.log("Generating a tiny HEVC/HDR/audio technical fixture...");
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-f", "lavfi", "-i", "testsrc2=size=240x136:rate=24:duration=2",
      "-f", "lavfi", "-i", "sine=frequency=440:sample_rate=48000:duration=2",
      "-c:v", "libx265", "-preset", "ultrafast",
      "-x265-params", "pools=1:frame-threads=1:log-level=error",
      "-pix_fmt", "yuv420p10le", "-tag:v", "hvc1",
      "-color_primaries", "bt2020", "-color_trc", "smpte2084",
      "-colorspace", "bt2020nc", "-c:a", "aac", "-shortest", source,
    ]);
    await run("ffmpeg", [
      "-hide_banner", "-loglevel", "error", "-y",
      "-display_rotation:v:0", "90", "-i", source, "-c", "copy", rotated,
    ]);
    const fixtureMetadata = await probePhoneVideo(rotated);
    if (fixtureMetadata.rotation !== 90 || !fixtureMetadata.isHdr || !fixtureMetadata.hasAudio) {
      throw new Error("The technical fixture did not contain the requested rotation/HDR/audio combination.");
    }
    const sourceSize = (await stat(rotated)).size;
    console.log("Uploading and re-downloading the source through managed storage...");
    const sourceKey = `${objectPrefix}/source.mov`;
    const sourceUpload = await fetch(await prepareStoredPut(sourceKey), {
      method: "PUT",
      headers: { "Content-Type": "video/quicktime", "Content-Length": String(sourceSize) },
      body: Readable.toWeb(createReadStream(rotated)) as unknown as BodyInit,
      duplex: "half",
      signal: AbortSignal.timeout(60_000),
    } as RequestInit & { duplex: "half" });
    if (!sourceUpload.ok) throw new Error(`Source transfer failed (${sourceUpload.status}).`);
    await verifyStoredSource({
      objectKey: sourceKey, size: sourceSize, contentType: "video/quicktime",
    });
    await downloadStoredVideo(sourceKey, downloaded, sourceSize);

    console.log("Converting the downloaded source with the real application processor...");
    const result = await convertPhoneVideo({ inputPath: downloaded, outputDirectory });
    console.log("Uploading the compatible MP4 and its poster...");
    const video = await uploadStoredFile(`${objectPrefix}/converted.mp4`, result.videoPath, "video/mp4");
    const poster = await uploadStoredFile(`${objectPrefix}/poster.jpg`, result.posterPath, "image/jpeg");
    await verifyStoredSource({ objectKey: video.key, size: video.size, contentType: "video/mp4" });
    const posterHead = await fetch(await storageGetSignedUrl(poster.key), { method: "HEAD" });
    if (!posterHead.ok || posterHead.headers.get("content-type")?.split(";", 1)[0] !== "image/jpeg" ||
        Number(posterHead.headers.get("content-length")) !== poster.size) {
      throw new Error("Stored poster metadata did not match the JPEG output.");
    }
    await downloadStoredVideo(video.key, roundTrip, video.size);

    const probe = JSON.parse(await run("ffprobe", [
      "-v", "error", "-show_streams", "-show_format", "-of", "json", roundTrip,
    ])) as { streams: Array<{ codec_type: string; codec_name: string; width?: number; height?: number; pix_fmt?: string; color_transfer?: string }> };
    const picture = probe.streams.find(stream => stream.codec_type === "video");
    const audio = probe.streams.find(stream => stream.codec_type === "audio");
    if (!picture || picture.codec_name !== "h264" || picture.pix_fmt !== "yuv420p") {
      throw new Error("Round-trip video was not browser-compatible H.264/yuv420p.");
    }
    if (!audio || audio.codec_name !== "aac") throw new Error("Speech/audio stream was not retained as AAC.");
    if ((picture.width || 0) >= (picture.height || 0)) throw new Error("Phone rotation was not preserved.");
    if (["smpte2084", "arib-std-b67"].includes(picture.color_transfer || "")) {
      throw new Error("The output still advertises HDR instead of SDR playback.");
    }
    console.log(JSON.stringify({
      storageRoundTrip: true,
      databaseWrites: false,
      sourceBytes: sourceSize,
      outputBytes: video.size,
      posterBytes: poster.size,
      durationSeconds: result.durationSeconds,
      width: picture.width,
      height: picture.height,
      videoCodec: picture.codec_name,
      audioCodec: audio.codec_name,
      pixelFormat: picture.pix_fmt,
      outputTransfer: picture.color_transfer || "unspecified",
    }, null, 2));
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

main().catch(error => {
  console.error(error instanceof Error ? error.message : "Video storage diagnostic failed.");
  process.exitCode = 1;
});
