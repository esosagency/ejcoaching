import { spawn } from "node:child_process";
import { lstat, mkdir, open, rm, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_PHONE_VIDEO_BYTES = 1024 * 1024 * 1024;
export const MAX_PHONE_VIDEO_SECONDS = 1_800;
export const MAX_PHONE_VIDEO_DIMENSION = 4_096;
export const MAX_PHONE_VIDEO_PIXELS = 4_096 * 2_160;
export const MAX_OUTPUT_VIDEO_WIDTH = 1_920;
export const MAX_OUTPUT_VIDEO_HEIGHT = 1_920;

const PROBE_TIMEOUT_MS = 30_000;
const POSTER_TIMEOUT_MS = 120_000;
const MAX_STDERR_BYTES = 24 * 1024;
const MAX_PROBE_STDOUT_BYTES = 512 * 1024;
const VIDEO_CODECS = new Set(["h264", "hevc", "mpeg4", "h263", "vp8", "vp9", "av1"]);
const SOURCE_FORMATS = new Set(["mov", "mp4", "3gp", "3g2", "webm"]);
// The MOV demuxer covers MOV/MP4/M4V/3GP/3G2. Matroska's WebM mode covers
// WebM. Restricting demuxers as well as protocols prevents disguised playlist
// or image-sequence inputs from causing FFmpeg to read other local files.
const PHONE_DEMUXER_WHITELIST = "mov,matroska,webm";

type RawProbeStream = {
  index?: unknown;
  codec_type?: unknown;
  codec_name?: unknown;
  profile?: unknown;
  pix_fmt?: unknown;
  width?: unknown;
  height?: unknown;
  avg_frame_rate?: unknown;
  r_frame_rate?: unknown;
  duration?: unknown;
  channels?: unknown;
  color_space?: unknown;
  color_transfer?: unknown;
  color_primaries?: unknown;
  tags?: { rotate?: unknown };
  side_data_list?: Array<{ rotation?: unknown }>;
};

type RawProbe = {
  format?: { duration?: unknown; format_name?: unknown };
  streams?: RawProbeStream[];
};

export type PhoneVideoProbe = {
  durationSeconds: number;
  /** Display-oriented dimensions. A portrait MOV is reported as portrait. */
  width: number;
  height: number;
  hasAudio: boolean;
  videoCodec: string;
  audioCodec?: string;
  audioChannels?: number;
  pixelFormat: string;
  frameRate: number;
  rotation: 0 | 90 | 180 | 270;
  isHdr: boolean;
};

export type ConvertedPhoneVideo = {
  videoPath: string;
  posterPath: string;
  durationSeconds: number;
  width: number;
  height: number;
  hasAudio: boolean;
};

export type ConvertPhoneVideoOptions = {
  inputPath: string;
  outputDirectory: string;
  signal?: AbortSignal;
  onProgress?: (progress: number) => void;
};

/** Safe French errors suitable for a job error field or an administrator UI. */
export class MediaProcessorError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MediaProcessorError";
  }
}

function fail(message: string): never {
  throw new MediaProcessorError(message);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}

function assertNotAborted(signal?: AbortSignal): void {
  if (signal?.aborted) fail("Le traitement vidéo a été annulé.");
}

function appendTail(current: string, next: string, limit: number): string {
  const combined = current + next;
  return combined.length > limit ? combined.slice(-limit) : combined;
}

function localFileUrl(filePath: string): string {
  return pathToFileURL(filePath).href;
}

async function assertInputFile(inputPath: string): Promise<number> {
  if (!path.isAbsolute(inputPath) || inputPath.includes("\0")) {
    fail("Le fichier vidéo source est invalide.");
  }

  let input;
  try {
    input = await lstat(inputPath);
  } catch {
    fail("Le fichier vidéo source est introuvable.");
  }
  if (!input.isFile() || input.isSymbolicLink()) {
    fail("Le fichier vidéo source est invalide.");
  }
  if (
    !Number.isSafeInteger(input.size) ||
    input.size <= 0 ||
    input.size > MAX_PHONE_VIDEO_BYTES
  ) {
    fail("Le fichier vidéo dépasse la taille maximale permise de 1 Go.");
  }
  return input.size;
}

async function prepareOutputDirectory(outputDirectory: string): Promise<void> {
  if (!path.isAbsolute(outputDirectory) || outputDirectory.includes("\0")) {
    fail("Le dossier temporaire vidéo est invalide.");
  }
  try {
    await mkdir(outputDirectory, { recursive: true, mode: 0o700 });
    const info = await lstat(outputDirectory);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("invalid directory");
  } catch {
    fail("Impossible de préparer le dossier temporaire vidéo.");
  }
}

function parseFiniteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  const result = Number(value);
  return Number.isFinite(result) ? result : null;
}

function parsePositiveInteger(value: unknown): number | null {
  const result = parseFiniteNumber(value);
  return result !== null && Number.isSafeInteger(result) && result > 0 ? result : null;
}

function parseFrameRate(value: unknown): number {
  if (typeof value !== "string") return 0;
  const [numeratorText, denominatorText] = value.split("/", 2);
  const numerator = Number(numeratorText);
  const denominator = Number(denominatorText);
  if (!Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator <= 0) {
    return 0;
  }
  return numerator / denominator;
}

function normalizeRotation(value: unknown): 0 | 90 | 180 | 270 {
  const raw = parseFiniteNumber(value);
  if (raw === null) return 0;
  const normalized = ((Math.round(raw) % 360) + 360) % 360;
  if (normalized === 90 || normalized === 180 || normalized === 270) return normalized;
  return 0;
}

function getRotation(stream: RawProbeStream): 0 | 90 | 180 | 270 {
  const sideDataRotation = stream.side_data_list?.find(item => item.rotation !== undefined)?.rotation;
  return normalizeRotation(sideDataRotation ?? stream.tags?.rotate);
}

function displayDimensions(
  width: number,
  height: number,
  rotation: 0 | 90 | 180 | 270,
): { width: number; height: number } {
  return rotation === 90 || rotation === 270
    ? { width: height, height: width }
    : { width, height };
}

function detectHdr(stream: RawProbeStream): boolean {
  const transfer = typeof stream.color_transfer === "string" ? stream.color_transfer.toLowerCase() : "";
  return (
    transfer === "smpte2084" ||
    transfer === "arib-std-b67" ||
    transfer === "hlg" ||
    transfer === "pq"
  );
}

function boundedDuration(value: number): number {
  // Stable millisecond precision prevents DB/UI noise while retaining enough
  // accuracy for progress and poster seeking.
  return Math.round(value * 1_000) / 1_000;
}

function parseProbe(stdout: string): PhoneVideoProbe {
  let parsed: RawProbe;
  try {
    parsed = JSON.parse(stdout) as RawProbe;
  } catch {
    fail("Cette vidéo est corrompue ou n’est pas prise en charge.");
  }

  const formatName = typeof parsed.format?.format_name === "string" ? parsed.format.format_name : "";
  const formatNames = formatName.split(",").map(name => name.trim().toLowerCase());
  if (!formatNames.some(name => SOURCE_FORMATS.has(name))) {
    fail("Le format de cette vidéo n’est pas pris en charge.");
  }

  const video = parsed.streams?.find(stream => stream.codec_type === "video");
  if (!video || typeof video.codec_name !== "string" || !VIDEO_CODECS.has(video.codec_name)) {
    fail("Cette vidéo est corrompue, non prise en charge ou ne contient pas d’image.");
  }

  const codedWidth = parsePositiveInteger(video.width);
  const codedHeight = parsePositiveInteger(video.height);
  if (
    !codedWidth ||
    !codedHeight ||
    codedWidth > MAX_PHONE_VIDEO_DIMENSION ||
    codedHeight > MAX_PHONE_VIDEO_DIMENSION ||
    codedWidth * codedHeight > MAX_PHONE_VIDEO_PIXELS
  ) {
    fail("La résolution de cette vidéo dépasse la limite 4K permise.");
  }

  const duration = parseFiniteNumber(parsed.format?.duration) ?? parseFiniteNumber(video.duration);
  if (!duration || duration <= 0 || duration > MAX_PHONE_VIDEO_SECONDS) {
    fail("La durée de cette vidéo doit être de 30 minutes ou moins.");
  }

  const rotation = getRotation(video);
  const dimensions = displayDimensions(codedWidth, codedHeight, rotation);
  const audio = parsed.streams?.find(stream => stream.codec_type === "audio");
  const frameRate = parseFrameRate(video.avg_frame_rate) || parseFrameRate(video.r_frame_rate);
  if (!Number.isFinite(frameRate) || frameRate <= 0 || frameRate > 240) {
    fail("La cadence de cette vidéo n’est pas prise en charge.");
  }

  return {
    durationSeconds: boundedDuration(duration),
    width: dimensions.width,
    height: dimensions.height,
    hasAudio: Boolean(audio),
    videoCodec: video.codec_name,
    audioCodec: typeof audio?.codec_name === "string" ? audio.codec_name : undefined,
    audioChannels: parsePositiveInteger(audio?.channels) ?? undefined,
    pixelFormat: typeof video.pix_fmt === "string" ? video.pix_fmt : "",
    frameRate,
    rotation,
    isHdr: detectHdr(video),
  };
}

type RunToolOptions = {
  signal?: AbortSignal;
  timeoutMs: number;
  failureMessage: string;
  captureStdout?: boolean;
  onStdout?: (chunk: string) => void;
};

/**
 * Runs FFmpeg tools with an argv array only. `file,pipe` protocol whitelisting
 * and absolute local file URLs prevent user supplied input from becoming a
 * network fetch. stderr is consumed but never logged and kept bounded.
 */
async function runTool(
  executable: "ffprobe" | "ffmpeg",
  args: string[],
  options: RunToolOptions,
): Promise<string> {
  assertNotAborted(options.signal);

  return new Promise<string>((resolve, reject) => {
    let child;
    try {
      child = spawn(executable, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch {
      reject(new MediaProcessorError(options.failureMessage));
      return;
    }

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    let aborted = false;
    let stdoutTooLarge = false;
    let forceKill: ReturnType<typeof setTimeout> | undefined;
    const cleanup = () => {
      clearTimeout(timeout);
      clearTimeout(forceKill);
      options.signal?.removeEventListener("abort", abortProcess);
    };
    const settle = (error?: Error) => {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(stdout);
    };
    const stop = () => {
      if (!child.killed) child.kill("SIGTERM");
      if (!forceKill) {
        forceKill = setTimeout(() => {
          if (!finished) child.kill("SIGKILL");
        }, 5_000);
        forceKill.unref?.();
      }
    };
    const abortProcess = () => {
      aborted = true;
      stop();
    };
    const timeout = setTimeout(() => {
      timedOut = true;
      stop();
    }, options.timeoutMs);
    timeout.unref?.();

    options.signal?.addEventListener("abort", abortProcess, { once: true });
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      options.onStdout?.(chunk);
      if (options.captureStdout) {
        stdout += chunk;
        if (stdout.length > MAX_PROBE_STDOUT_BYTES) {
          stdoutTooLarge = true;
          stop();
        }
      } else {
        // Keep a tiny bounded tail only to make pipe draining explicit. It is
        // intentionally never put in an error message or a log.
        stdout = appendTail(stdout, chunk, 8 * 1024);
      }
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendTail(stderr, chunk, MAX_STDERR_BYTES);
    });
    child.once("error", () => settle(new MediaProcessorError(options.failureMessage)));
    child.once("close", code => {
      // Deliberately do not include `stderr`: it can expose source paths and
      // FFmpeg internals and is not safe for a user-facing job error.
      void stderr;
      if (options.signal?.aborted || aborted) {
        settle(new MediaProcessorError("Le traitement vidéo a été annulé."));
        return;
      }
      if (timedOut) {
        settle(new MediaProcessorError("Le traitement vidéo a dépassé le délai permis."));
        return;
      }
      if (stdoutTooLarge || code !== 0) {
        settle(new MediaProcessorError(options.failureMessage));
        return;
      }
      settle();
    });
  });
}

/**
 * Reads validated media metadata using the local FFprobe executable. It does
 * not trust caller metadata, extensions, or presentation rotation tags alone.
 */
export async function probePhoneVideo(
  inputPath: string,
  signal?: AbortSignal,
): Promise<PhoneVideoProbe> {
  await assertInputFile(inputPath);
  assertNotAborted(signal);
  const stdout = await runTool(
    "ffprobe",
    [
      "-hide_banner",
      "-v",
      "error",
      "-protocol_whitelist",
      "file,pipe",
      "-format_whitelist",
      PHONE_DEMUXER_WHITELIST,
      "-show_entries",
      "format=duration,format_name:stream=index,codec_type,codec_name,profile,pix_fmt,width,height,avg_frame_rate,r_frame_rate,duration,channels,color_space,color_transfer,color_primaries:stream_tags=rotate:stream_side_data=rotation",
      "-of",
      "json",
      "-i",
      localFileUrl(inputPath),
    ],
    {
      signal,
      timeoutMs: PROBE_TIMEOUT_MS,
      captureStdout: true,
      failureMessage: "Cette vidéo est corrompue ou n’est pas prise en charge.",
    },
  );
  return parseProbe(stdout);
}

function targetBox(probe: PhoneVideoProbe): { width: number; height: number } {
  return probe.width >= probe.height
    ? { width: MAX_OUTPUT_VIDEO_WIDTH, height: 1_080 }
    : { width: 1_080, height: MAX_OUTPUT_VIDEO_HEIGHT };
}

function rotateFilter(rotation: PhoneVideoProbe["rotation"]): string | null {
  // FFprobe's display-matrix values follow FFmpeg's counter-clockwise display
  // convention. This mapping was verified against FFmpeg auto-rotation pixels.
  if (rotation === 90) return "transpose=cclock";
  if (rotation === 180) return "hflip,vflip";
  if (rotation === 270) return "transpose=clock";
  return null;
}

function videoFilter(probe: PhoneVideoProbe): string {
  const filters: string[] = [];
  const rotation = rotateFilter(probe.rotation);
  if (rotation) filters.push(rotation);

  const box = targetBox(probe);
  // Reduce spatial/temporal work before HDR's float conversion to bound the
  // transient memory and CPU required by a 4K iPhone recording.
  filters.push(
    `scale=w='min(${box.width},iw)':h='min(${box.height},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2:flags=lanczos`,
  );
  filters.push("fps=30");

  if (probe.isHdr) {
    filters.push(
      "zscale=transfer=linear:npl=100,format=gbrpf32le,tonemap=tonemap=hable:desat=0,zscale=primaries=bt709:transfer=bt709:matrix=bt709:range=tv,format=yuv420p",
    );
  } else {
    filters.push("format=yuv420p");
  }
  return filters.join(",");
}

function conversionTimeoutMs(durationSeconds: number): number {
  const configured = Number(process.env.PHONE_VIDEO_FFMPEG_TIMEOUT_MS);
  if (Number.isSafeInteger(configured) && configured >= 30_000 && configured <= 2 * 60 * 60_000) {
    return configured;
  }
  // Four times the source duration plus setup time, constrained to 5–95 min.
  return Math.max(5 * 60_000, Math.min(95 * 60_000, Math.ceil((durationSeconds * 4 + 180) * 1_000)));
}

function reportProgress(callback: ConvertPhoneVideoOptions["onProgress"], progress: number): void {
  if (!callback) return;
  try {
    callback(Math.max(0, Math.min(99, Math.floor(progress))));
  } catch {
    // Job progress persistence must not make a successfully encoded media file
    // look like a failed conversion.
  }
}

function progressReader(
  durationSeconds: number,
  onProgress: ConvertPhoneVideoOptions["onProgress"],
): (chunk: string) => void {
  let pending = "";
  let latest = 0;
  return chunk => {
    pending += chunk;
    const lines = pending.split(/\r?\n/);
    pending = lines.pop() ?? "";
    for (const line of lines) {
      const equals = line.indexOf("=");
      if (equals < 1) continue;
      const key = line.slice(0, equals);
      if (key !== "out_time_us" && key !== "out_time_ms") continue;
      const parsed = Number(line.slice(equals + 1));
      if (!Number.isFinite(parsed) || parsed < 0) continue;
      // FFmpeg historically labels this microseconds value `out_time_ms`; both
      // keys are therefore interpreted as microseconds.
      const seconds = parsed / 1_000_000;
      const next = Math.min(90, Math.max(1, Math.floor((seconds / durationSeconds) * 90)));
      if (next > latest) {
        latest = next;
        reportProgress(onProgress, next);
      }
    }
  };
}

async function assertOutputVideo(
  videoPath: string,
  expectedAudio: boolean,
  signal?: AbortSignal,
): Promise<PhoneVideoProbe> {
  let info;
  try {
    info = await stat(videoPath);
  } catch {
    fail("La conversion vidéo n’a pas produit de fichier valide.");
  }
  if (
    !info.isFile() ||
    info.size <= 0 ||
    info.size > MAX_PHONE_VIDEO_BYTES
  ) {
    fail("La conversion vidéo dépasse la taille maximale permise.");
  }

  const probe = await probePhoneVideo(videoPath, signal);
  const allowedLandscape = probe.width <= MAX_OUTPUT_VIDEO_WIDTH && probe.height <= 1_080;
  const allowedPortrait = probe.width <= 1_080 && probe.height <= MAX_OUTPUT_VIDEO_HEIGHT;
  if (
    probe.videoCodec !== "h264" ||
    probe.pixelFormat !== "yuv420p" ||
    probe.rotation !== 0 ||
    probe.frameRate > 30.001 ||
    (!allowedLandscape && !allowedPortrait) ||
    (expectedAudio && (!probe.hasAudio || probe.audioCodec !== "aac" || (probe.audioChannels ?? 0) > 2))
  ) {
    fail("La conversion vidéo n’a pas produit un fichier compatible.");
  }
  return probe;
}

async function assertPoster(posterPath: string): Promise<void> {
  let info;
  try {
    info = await stat(posterPath);
  } catch {
    fail("La conversion vidéo n’a pas produit d’image d’aperçu valide.");
  }
  if (!info.isFile() || info.size <= 0 || info.size > 20 * 1024 * 1024) {
    fail("La conversion vidéo n’a pas produit d’image d’aperçu valide.");
  }

  let handle;
  try {
    handle = await open(posterPath, "r");
    const bytes = Buffer.alloc(3);
    await handle.read(bytes, 0, bytes.length, 0);
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
      fail("La conversion vidéo n’a pas produit d’image d’aperçu valide.");
    }
  } catch (error) {
    if (error instanceof MediaProcessorError) throw error;
    fail("La conversion vidéo n’a pas produit d’image d’aperçu valide.");
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * Converts a validated local phone recording to browser-compatible H.264/AAC
 * MP4 and a JPEG poster. The caller owns the job temp directory and removes it
 * after uploading the returned artifacts. Partial outputs are removed on every
 * failed or cancelled attempt.
 */
export async function convertPhoneVideo({
  inputPath,
  outputDirectory,
  signal,
  onProgress,
}: ConvertPhoneVideoOptions): Promise<ConvertedPhoneVideo> {
  reportProgress(onProgress, 0);
  await assertInputFile(inputPath);
  await prepareOutputDirectory(outputDirectory);
  assertNotAborted(signal);

  const videoPath = path.join(outputDirectory, "video.mp4");
  const posterPath = path.join(outputDirectory, "poster.jpg");
  let completed = false;
  try {
    await rm(videoPath, { force: true });
    await rm(posterPath, { force: true });
    const source = await probePhoneVideo(inputPath, signal);
    reportProgress(onProgress, 1);

    await runTool(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-filter_threads",
        "1",
        "-filter_complex_threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        PHONE_DEMUXER_WHITELIST,
        "-noautorotate",
        // The source rotation is applied explicitly in videoFilter(). Reset
        // input display side data before decode so FFmpeg cannot copy the old
        // MOV display matrix onto an already physically rotated MP4.
        "-display_rotation:v:0",
        "0",
        "-i",
        localFileUrl(inputPath),
        "-map",
        "0:v:0",
        "-map",
        "0:a:0?",
        "-map_metadata",
        "-1",
        "-map_chapters",
        "-1",
        "-vf",
        videoFilter(source),
        "-c:v",
        "libx264",
        "-preset",
        "medium",
        "-crf",
        "23",
        "-maxrate",
        "4000k",
        "-bufsize",
        "8000k",
        "-x264-params",
        "threads=1",
        "-pix_fmt",
        "yuv420p",
        "-profile:v",
        "high",
        "-level:v",
        "4.1",
        "-c:a",
        "aac",
        "-ac",
        "2",
        "-b:a",
        "128k",
        "-color_primaries",
        "bt709",
        "-color_trc",
        "bt709",
        "-colorspace",
        "bt709",
        "-movflags",
        "+faststart",
        "-fps_mode",
        "cfr",
        "-progress",
        "pipe:1",
        "-nostats",
        "-y",
        localFileUrl(videoPath),
      ],
      {
        signal,
        timeoutMs: conversionTimeoutMs(source.durationSeconds),
        failureMessage: "La conversion vidéo a échoué. Réessayez avec un autre enregistrement.",
        onStdout: progressReader(source.durationSeconds, onProgress),
      },
    );
    reportProgress(onProgress, 92);

    const output = await assertOutputVideo(videoPath, source.hasAudio, signal);
    reportProgress(onProgress, 95);

    const posterOffset = Math.max(0, Math.min(output.durationSeconds / 2, 1));
    await runTool(
      "ffmpeg",
      [
        "-hide_banner",
        "-nostdin",
        "-v",
        "error",
        "-threads",
        "1",
        "-protocol_whitelist",
        "file,pipe",
        "-format_whitelist",
        "mov",
        "-ss",
        posterOffset.toFixed(3),
        "-i",
        localFileUrl(videoPath),
        "-map",
        "0:v:0",
        "-frames:v",
        "1",
        "-q:v",
        "2",
        "-y",
        localFileUrl(posterPath),
      ],
      {
        signal,
        timeoutMs: POSTER_TIMEOUT_MS,
        failureMessage: "La conversion vidéo n’a pas produit d’image d’aperçu valide.",
      },
    );
    await assertPoster(posterPath);
    reportProgress(onProgress, 99);
    completed = true;

    return {
      videoPath,
      posterPath,
      durationSeconds: output.durationSeconds,
      width: output.width,
      height: output.height,
      hasAudio: output.hasAudio,
    };
  } catch (error) {
    if (error instanceof MediaProcessorError) throw error;
    if (signal?.aborted || isAbort(error)) {
      return fail("Le traitement vidéo a été annulé.");
    }
    return fail("La conversion vidéo a échoué. Réessayez avec un autre enregistrement.");
  } finally {
    if (!completed) {
      await Promise.all([
        rm(videoPath, { force: true }).catch(() => undefined),
        rm(posterPath, { force: true }).catch(() => undefined),
      ]);
    }
  }
}
